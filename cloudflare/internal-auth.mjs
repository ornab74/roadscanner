// Matches qrs_internal_auth.py. Keep the scanner secret inside Worker bindings.
const encoder = new TextEncoder();
const version = 'qrs-internal-v1';

async function signingKey(secret) {
  if (typeof secret !== 'string' || encoder.encode(secret).length < 32) {
    throw new Error('QRS_LLAMA_API_TOKEN must contain at least 32 bytes');
  }
  return crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function message(prefix, body) {
  const header = encoder.encode(prefix + '\n');
  const result = new Uint8Array(header.length + body.length);
  result.set(header);
  result.set(body, header.length);
  return result;
}

export async function signScannerRequest(secret, body, options = {}) {
  if (!(body instanceof Uint8Array)) throw new TypeError('body must be bytes');
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = options.nonce ?? crypto.randomUUID();
  if (!Number.isSafeInteger(timestamp) || !/^[A-Za-z0-9_-]{16,96}$/.test(nonce)) {
    throw new Error('invalid internal request metadata');
  }
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret),
    message(`${version}\nrequest\n${timestamp}\n${nonce}`, body));
  return {
    'X-QRS-Timestamp': String(timestamp),
    'X-QRS-Nonce': nonce,
    'X-QRS-Signature': hex(signature),
  };
}

export async function verifyScannerResponse(secret, nonce, body, signature) {
  if (!(body instanceof Uint8Array) || !/^[A-Za-z0-9_-]{16,96}$/.test(nonce)
      || typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const bytes = Uint8Array.from(signature.match(/../g), pair => parseInt(pair, 16));
  return crypto.subtle.verify('HMAC', await signingKey(secret), bytes,
    message(`${version}\nresponse\n${nonce}`, body));
}

export async function boundedBody(stream, maximum) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new Error('scanner payload exceeds limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

// Call only after readiness so that a cold start cannot expire the signed request.
export async function classifyWithScanner(port, secret, body) {
  if (!(body instanceof Uint8Array) || body.length > 16 * 1024) {
    throw new Error('invalid scanner request size');
  }
  const headers = await signScannerRequest(secret, body);
  const response = await port.fetch('http://container/v1/classify', {
    method: 'POST', body, headers: { ...headers, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(180000),
  });
  const result = await boundedBody(response.body, 8 * 1024);
  if (!await verifyScannerResponse(secret, headers['X-QRS-Nonce'], result,
    response.headers.get('X-QRS-Response-Signature'))) {
    throw new Error('scanner response authentication failed');
  }
  return new Response(result, {
    status: response.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff' },
  });
}
