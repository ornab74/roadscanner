import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { boundedBody, classifyWithScanner, signScannerRequest,
  verifyScannerResponse } from '../cloudflare/internal-auth.mjs';

const secret = 'test-only-secret-with-at-least-32-bytes';
const nonce = 'test_nonce_0123456789';
const body = new TextEncoder().encode('{"scene":{"weather":"rain"}}');
const mac = (value) => createHmac('sha256', secret).update(value).digest('hex');

test('Worker request and response signatures interoperate with Python', async () => {
  const headers = await signScannerRequest(secret, body, { timestamp: 123456, nonce });
  const result = JSON.parse(execFileSync(process.env.QRS_TEST_PYTHON || 'python3', ['-c',
    `import json,sys; from qrs_internal_auth import verify_request,sign_response
p=json.load(sys.stdin)
valid,n=verify_request(p['secret'],p['body'].encode(),p['headers'],now=123456)
print(json.dumps({'valid':valid,'nonce':n,'signature':sign_response(p['secret'],n,b'{}')}))`],
  { cwd: new URL('..', import.meta.url), input: JSON.stringify({ secret,
    body: new TextDecoder().decode(body), headers }), encoding: 'utf8' }));
  assert.equal(result.valid, true);
  assert.equal(result.nonce, nonce);
  assert.equal(await verifyScannerResponse(secret, nonce,
    new TextEncoder().encode('{}'), result.signature), true);
  assert.equal(await verifyScannerResponse(secret, nonce, body, result.signature), false);
  assert.equal(await verifyScannerResponse(secret, nonce + 'x',
    new TextEncoder().encode('{}'), result.signature), false);
});

test('request signing rejects missing secrets and invalid metadata', async () => {
  await assert.rejects(signScannerRequest('', body), /32 bytes/);
  await assert.rejects(signScannerRequest(secret, body, { nonce: '\ninvalid' }), /metadata/);
  await assert.rejects(signScannerRequest(secret, body, { timestamp: NaN }), /metadata/);
});

test('body limits count streamed bytes and cancel oversized streams', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(5)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(boundedBody(stream, 8), /limit/);
  assert.equal(cancelled, true);
  assert.deepEqual(await boundedBody(new Response('abc').body, 3),
    new TextEncoder().encode('abc'));
});

test('scanner call signs only its own headers and verifies the response', async () => {
  const port = { async fetch(url, options) {
    assert.equal(url, 'http://container/v1/classify');
    const h = options.headers;
    assert.equal(h['X-QRS-Signature'], mac(Buffer.concat([
      Buffer.from(`qrs-internal-v1\nrequest\n${h['X-QRS-Timestamp']}\n${h['X-QRS-Nonce']}\n`), body])));
    const reply = '{"label":"High","schema":"qrs-risk-v1"}';
    return new Response(reply, { headers: { 'X-QRS-Response-Signature':
      mac(`qrs-internal-v1\nresponse\n${h['X-QRS-Nonce']}\n${reply}`) } });
  } };
  const response = await classifyWithScanner(port, secret, body);
  assert.equal((await response.json()).label, 'High');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  await assert.rejects(classifyWithScanner({ fetch: async () => new Response('{}') },
    secret, body), /authentication/);
  await assert.rejects(classifyWithScanner(port, secret, new Uint8Array(16385)), /size/);
});
