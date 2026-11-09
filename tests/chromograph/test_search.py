import math
import pytest


def test_descriptor_deterministic_and_palette_permutation(engine):
    ctx={'rgb':'#0033cc','palette':[{'rgb':'#0000ff','weight':4},{'rgb':'#ff0000','weight':1}],
         'timestamp_utc':'2026-11-08T23:00:00-05:00','weather':{'temperature_c':-5.,'wind_gust_kph':33},'tags':['WET','road']}
    a=engine._cx4_descriptor(ctx)
    b=engine._cx4_descriptor({**ctx,'palette':list(reversed(ctx['palette']))})
    assert a==b
    assert len(a['vector'])==256
    assert all(math.isfinite(v) for v in a['vector'])
    assert a['context']['timestamp_utc']=='2026-11-09T04:00:00+00:00'
    assert a['digest_is_entropy'] is False
    assert a['blocks']['phase']==[64,256]


@pytest.mark.parametrize('change',[
    {'palette':[]}, {'palette':[{'rgb':'#fff','weight':1}]},
    {'palette':[{'rgb':'#ffffff','weight':0}]}, {'latitude':35},
    {'weather':{'visibility_km':float('nan')}}, {'weather':{'rain_mm':-1}},
    {'weather':{'wind_gust_kph':True}}, {'timestamp_utc':'2026-11-09T00:00:00'},
    {'tags':['<script>']},{'tags':['x']*17}])
def test_public_context_strict_validation(engine,change):
    with pytest.raises(ValueError):engine._cx4_descriptor({'rgb':'#000000',**change})


def test_achromatic_vector_has_no_hue(engine):
    v=engine._cx4_descriptor({'rgb':'#777777'})['vector']
    assert v[9:11]==[0.,0.]


def test_hybrid_search_semantics_and_explanations(engine):
    body={'query':{'rgb':'#0000ff','tags':['rain']},'query_embedding':{'model':'test-embed','values':[1,0]},
          'candidates':[
          {'record_id':'blue-01','public_context':{'rgb':'#0000ff','tags':['rain']},'public_embedding':{'model':'test-embed','values':[1,0]}},
          {'record_id':'red-001','public_context':{'rgb':'#ff0000','tags':['sun']},'public_embedding':{'model':'test-embed','values':[-1,0]}},
          {'record_id':'green-1','public_context':{'rgb':'#00ff00'},'public_embedding':{'model':'other-model','values':[1,0]}}],
          'diversity':0}
    result=engine._cx4_search(body)
    assert result['results'][0]['record_id']=='blue-01'
    assert result['candidate_count']==3 and not result['approximate']
    green=next(r for r in result['results'] if r['record_id']=='green-1')
    assert not green['explanation']['semantic_comparable']
    assert 'semantic' in green['explanation']['missing_channels']


def test_search_equal_scores_are_ties_and_no_model_inference(engine):
    result=engine._cx4_search({'query':{'rgb':'#ff0000'},'diversity':0,
          'candidates':[{'record_id':name,'public_context':{'rgb':'#ff0000'}} for name in ('bbb1','aaa1')]})
    assert [r['record_id'] for r in result['results']]==['aaa1','bbb1']
    assert result['results'][0]['rank_score']==result['results'][1]['rank_score']


def test_search_missing_weather_never_gives_perfect_weather_score(engine):
    result=engine._cx4_search({'query':{'rgb':'#0000ff','weather':{'rain_mm':1}},'diversity':0,
         'candidates':[{'record_id':'rain1','public_context':{'rgb':'#0000ff','weather':{'rain_mm':1}}},
                       {'record_id':'none1','public_context':{'rgb':'#0000ff'}}]})
    a,b=result['results']
    assert a['record_id']=='rain1' and a['rank_score']>b['rank_score']
    assert 'weather' not in b['explanation']['channels']


def test_palette_knows_secondary_color(engine):
    a=engine._cx4_context({'rgb':'#ff0000','palette':[{'rgb':'#ff0000'},{'rgb':'#0000ff'}]})
    b=engine._cx4_context({'rgb':'#ff0000','palette':[{'rgb':'#ff0000'},{'rgb':'#0000ff'}]})
    c=engine._cx4_context({'rgb':'#ff0000'})
    assert engine._cx4_palette_distance(a['palette'],b['palette'])==0
    assert engine._cx4_palette_distance(a['palette'],c['palette'])>0


def test_duplicate_and_invalid_embeddings(engine):
    row={'record_id':'road1','public_context':{'rgb':'#ff0000'}}
    with pytest.raises(ValueError):engine._cx4_search({'query':{},'candidates':[row,row]})
    for values in ([0,0],[True,0],[float('inf'),1]):
        with pytest.raises(ValueError):engine._cx4_embedding({'model':'test','values':values})


def test_api_descriptor_and_search(client):
    result=client.post('/api/chromograph/v2/descriptor',json={'rgb':'#22aaff'})
    assert result.status_code==200 and len(result.json['vector'])==256
    query={'query':{'rgb':'#22aaff'},'candidates':[{'record_id':'road1','public_context':{'rgb':'#22aaff'}}]}
    assert client.post('/api/chromograph/v2/search',json=query).json['results'][0]['record_id']=='road1'


def test_swapping_color_masses_changes_palette_distance(engine):
    a=engine._cx4_context({'palette':[{'rgb':'#ff0000','weight':9},{'rgb':'#0000ff','weight':1}]})
    b=engine._cx4_context({'palette':[{'rgb':'#ff0000','weight':1},{'rgb':'#0000ff','weight':9}]})
    assert engine._cx4_palette_distance(a['palette'],b['palette'])>0.05
