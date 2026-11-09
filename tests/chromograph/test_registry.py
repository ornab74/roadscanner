import base64
import json
import hashlib
import threading
from datetime import datetime,timezone
import pytest

CID='bafy'+'a'*50


def body(envelope,rid='record-001',expected=0,rgb='#3366aa'):
    return {'record_id':rid,'expected_version':expected,'kind':'hazard',
            'public_context':{'rgb':rgb,'tags':['wet']},'public_index_ack':True,'envelope':envelope}


def test_save_idempotent_cas_and_version_chain(registry,native_stub):
    a,created=registry._cx5_create('owner-a',body(native_stub()),'write-0001')
    assert created and a['version']==1 and a['pin_state']=='pending'
    repeated,created=registry._cx5_create('owner-a',body(native_stub()),'write-0001')
    assert not created and a==repeated
    with pytest.raises(registry._CX5Error,match='idempotency_key_reused'):
        registry._cx5_create('owner-a',body(native_stub('b')),'write-0001')
    with pytest.raises(registry._CX5Error,match='version_conflict'):
        registry._cx5_create('owner-a',body(native_stub('b')),'write-0002')
    b,created=registry._cx5_create('owner-a',body(native_stub('b'),expected=1),'write-0002')
    assert b['version']==2 and b['previous_hash']==a['chain_hash']
    assert b['chain_hash']!=a['chain_hash']
    assert 'envelope_qrs2' not in a and 'owner_id' not in a


def test_no_plaintext_or_untrusted_signer_accepted(registry,native_stub):
    with pytest.raises(registry._CX5Error):registry._cx5_create('owner',body('plaintext'),'request01')
    env=native_stub()
    decoded=json.loads(base64.urlsafe_b64decode(env[4:]))
    decoded['sig']['pub']=base64.b64encode(b'another-key').decode()
    bad='PQ2.'+base64.urlsafe_b64encode(json.dumps(decoded).encode()).decode()
    with pytest.raises(registry._CX5Error,match='untrusted_qrs2_signer'):registry._cx5_envelope(bad)
    decoded=json.loads(base64.urlsafe_b64decode(env[4:]));decoded['data_ct']=base64.b64encode(b'tampered-contents-1234').decode()
    bad='PQ2.'+base64.urlsafe_b64encode(json.dumps(decoded).encode()).decode()
    with pytest.raises(registry._CX5Error,match='signature_verification_failed'):registry._cx5_envelope(bad)
    assert registry._cx5_rows('SELECT * FROM cx5_versions')==[]


def test_missing_native_verifier_fails_closed(registry,native_stub):
    good=native_stub()
    registry.key_manager=None
    with pytest.raises(RuntimeError,match='native_ml_dsa_verifier_unavailable'):registry._cx5_envelope(good)


def test_private_context_and_absent_consent_rejected(registry,native_stub):
    data=body(native_stub());data['public_context']['latitude']=33.5
    with pytest.raises(ValueError):registry._cx5_create('owner',data,'request01')
    data=body(native_stub());data['public_index_ack']=False
    with pytest.raises(registry._CX5Error,match='consent_required'):registry._cx5_create('owner',data,'request01')


def test_saved_search_owner_isolation_latest_versions(registry,native_stub):
    registry._cx5_create('alice',body(native_stub(),rgb='#ff0000'),'request-a1')
    registry._cx5_create('bob',body(native_stub(),rid='secret-bob',rgb='#0000ff'),'request-b1')
    registry._cx5_create('alice',body(native_stub('b'),expected=1,rgb='#0000ff'),'request-a2')
    result=registry._cx5_search('alice',{'query':{'rgb':'#0000ff'}})
    assert [r['record_id'] for r in result['results']]==['record-001']
    assert result['results'][0]['version']==2
    assert result['source']=='owned_registry'
    with pytest.raises(registry._CX5Error,match='record_not_found'):registry._cx5_read('alice','secret-bob')


def test_publish_verified_ciphertext_then_drop_spool(registry,native_stub,monkeypatch):
    envelope=native_stub()
    registry._cx5_create('owner',body(envelope),'request01')
    pins=[]
    monkeypatch.setattr(registry,'_cx5_pin',lambda e:(pins.append(e),CID)[1])
    monkeypatch.setattr(registry,'_cx5_download',lambda c:envelope)
    result=registry._cx5_publish_one()
    assert result['state']=='pinned' and pins==[envelope]
    stored=registry._cx5_one('SELECT * FROM cx5_versions')
    assert stored['envelope_qrs2'] is None and stored['cid']==CID
    assert registry._cx5_read('owner','record-001',True)['envelope']==envelope
    assert not registry._cx5_publish_one()['claimed']


def test_failed_publish_backoff_reuses_candidate_cid(registry,native_stub,monkeypatch):
    envelope=native_stub();registry._cx5_create('owner',body(envelope),'request01')
    pins=[]
    monkeypatch.setattr(registry,'_cx5_pin',lambda e:(pins.append(e),CID)[1])
    def unavailable(cid):raise RuntimeError('gateway unavailable')
    monkeypatch.setattr(registry,'_cx5_download',unavailable)
    failed=registry._cx5_publish_one()
    assert failed['state']=='pending' and failed['error']=='RuntimeError'
    row=registry._cx5_one('SELECT * FROM cx5_versions')
    assert row['cid']==CID and row['attempts']==1 and row['envelope_qrs2']==envelope
    assert row['retry_after']>int(registry._cx_time.time())
    assert not registry._cx5_publish_one()['claimed']
    registry._cx5_db().query('UPDATE cx5_versions SET retry_after=0')
    monkeypatch.setattr(registry,'_cx5_download',lambda c:envelope)
    assert registry._cx5_publish_one()['state']=='pinned'
    assert len(pins)==1


def test_tampered_gateway_data_not_committed(registry,native_stub,monkeypatch):
    registry._cx5_create('owner',body(native_stub()),'request01')
    monkeypatch.setattr(registry,'_cx5_pin',lambda e:CID)
    monkeypatch.setattr(registry,'_cx5_download',lambda c:'PQ2.tampered')
    assert registry._cx5_publish_one()['state']=='pending'
    assert registry._cx5_one('SELECT pin_state FROM cx5_versions')['pin_state']!='pinned'


def test_queue_lease_fencing_after_expiry(registry,native_stub,monkeypatch):
    envelope=native_stub();registry._cx5_create('owner',body(envelope),'request01')
    def lose_lease(e):
        registry._cx5_db().query("UPDATE cx5_versions SET lease_token='other-worker'")
        return CID
    monkeypatch.setattr(registry,'_cx5_pin',lose_lease)
    result=registry._cx5_publish_one()
    assert result['state']=='lease_lost'
    assert registry._cx5_one('SELECT envelope_qrs2 FROM cx5_versions')['envelope_qrs2']==envelope


def test_concurrent_compare_and_swap_one_winner(registry,native_stub):
    envelope=native_stub();start=threading.Barrier(2);outcomes=[]
    def write(key):
        start.wait()
        try:
            registry._cx5_create('owner',body(envelope),key)
            outcomes.append('created')
        except registry._CX5Error as e:outcomes.append(e.code)
    threads=[threading.Thread(target=write,args=(f'request0{i}',)) for i in (1,2)]
    for thread in threads:thread.start()
    for thread in threads:thread.join(3);assert not thread.is_alive()
    assert sorted(outcomes)==['created','version_conflict']
    assert len(registry._cx5_rows('SELECT * FROM cx5_versions'))==1


def test_checkpoint_domain_separation_and_pinned_key(registry,native_stub):
    registry._cx5_create('owner',body(native_stub()),'request01')
    anchor=registry._cx5_anchor('owner','record-001')
    payload=anchor['payload'];sig=base64.b64decode(anchor['signature']['value'])
    pub=base64.b64decode(anchor['signature']['public_key'])
    message=b'Roadscanner|CX5|index-anchor|v1\0'+registry._cx4_canonical(payload).encode()
    assert registry.key_manager.verify_blob(pub,sig,message)
    assert not registry.key_manager.verify_blob(pub,sig,registry._cx4_canonical(payload).encode())
    assert anchor['verification_requires_previously_trusted_key']


def test_concurrent_identical_retry_resolves_to_one_record(registry,native_stub):
    envelope=native_stub();barrier=threading.Barrier(2);results=[];errors=[]
    def write():
        barrier.wait()
        try:results.append(registry._cx5_create('owner',body(envelope),'same-request'))
        except Exception as exc:errors.append(str(exc))
    threads=[threading.Thread(target=write) for _ in range(2)]
    for thread in threads:thread.start()
    for thread in threads:thread.join(3);assert not thread.is_alive()
    assert not errors
    assert sorted(created for _,created in results)==[False,True]
    assert len(registry._cx5_rows('SELECT * FROM cx5_versions'))==1


def test_uncertain_commit_reconciled_by_idempotency_key(registry,native_stub,monkeypatch):
    db=registry._cx5_db();original=db.query
    raised=[False]
    def query(sql,params=()):
        result=original(sql,params)
        if sql.startswith('INSERT INTO cx5_versions') and not raised[0]:
            raised[0]=True
            raise RuntimeError('simulated transport timeout AFTER commit')
        return result
    monkeypatch.setattr(db,'query',query)
    row,created=registry._cx5_create('owner',body(native_stub()),'request-uncertain')
    assert row['version']==1 and created is False
    assert len(registry._cx5_rows('SELECT * FROM cx5_versions'))==1


def test_retry_ceiling_crashed_lease_becomes_dead(registry,native_stub):
    registry._cx5_create('owner',body(native_stub()),'request01')
    registry._cx5_db().query("UPDATE cx5_versions SET pin_state='leased',attempts=5,lease_until=0,lease_token='stale'")
    assert not registry._cx5_publish_one()['claimed']
    state=registry._cx5_one('SELECT * FROM cx5_versions')
    assert state['pin_state']=='dead' and state['last_error']=='lease_retry_limit'
    assert state['envelope_qrs2'] is not None


def test_ciphertext_read_checks_digest_even_after_remote_pin(registry,native_stub,monkeypatch):
    registry._cx5_create('owner',body(native_stub()),'request01')
    registry._cx5_db().query("UPDATE cx5_versions SET envelope_qrs2=NULL,pin_state='pinned',cid=?",(CID,))
    monkeypatch.setattr(registry,'_cx5_download',lambda cid:'PQ2.corrupt')
    with pytest.raises(registry._CX5Error,match='ciphertext_integrity_mismatch'):
        registry._cx5_read('owner','record-001',True)


def test_publication_final_commit_timeout_reconciles_to_pinned(registry,native_stub,monkeypatch):
    envelope=native_stub();registry._cx5_create('owner',body(envelope),'request01')
    monkeypatch.setattr(registry,'_cx5_pin',lambda e:CID)
    monkeypatch.setattr(registry,'_cx5_download',lambda c:envelope)
    db=registry._cx5_db();original=db.query;thrown=[False]
    def query(sql,params=()):
        result=original(sql,params)
        if "SET pin_state='pinned',envelope_qrs2=NULL" in sql and not thrown[0]:
            thrown[0]=True
            raise RuntimeError('simulated lost commit acknowledgement')
        return result
    monkeypatch.setattr(db,'query',query)
    result=registry._cx5_publish_one()
    assert result['state']=='pinned' and result['commit_reconciled'] is True
    assert registry._cx5_one('SELECT pin_state FROM cx5_versions')['pin_state']=='pinned'


def test_context_corruption_not_returned_ranked_or_signed(registry,native_stub):
    registry._cx5_create('owner',body(native_stub()),'request01')
    registry._cx5_db().query("UPDATE cx5_versions SET context_json='{}'")
    for operation in (lambda:registry._cx5_read('owner','record-001'),
                      lambda:registry._cx5_search('owner',{'query':{}}),
                      lambda:registry._cx5_anchor('owner','record-001')):
        with pytest.raises(registry._CX5Error,match='context_integrity_mismatch'):operation()
