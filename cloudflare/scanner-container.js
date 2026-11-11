// Private Durable Object bridge. No public route forwards arbitrary requests.
import { DurableObject } from 'cloudflare:workers';
import { boundedBody, classifyWithScanner } from './internal-auth.mjs';

export class ScannerContainer extends DurableObject {
  starting;
  async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/v1/classify') {
      return new Response('Not found', { status: 404 });
    }
    if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
      return new Response('JSON required', { status: 415 });
    }
    let body;
    try { body = await boundedBody(request.body, 16 * 1024); }
    catch { return new Response('Request too large', { status: 413 }); }
    this.starting ??= this.start().finally(() => { this.starting = undefined; });
    await this.starting;
    return classifyWithScanner(this.ctx.container.getTcpPort(8080),
      this.env.QRS_LLAMA_API_TOKEN, body);
  }
  async start() {
    const container = this.ctx.container;
    if (!container.running) {
      container.start({ image: container.images.base, instance: 'standard-1', enableInternet: false,
        env: { QRS_LLAMA_API_TOKEN: this.env.QRS_LLAMA_API_TOKEN } });
    }
    await container.setInactivityTimeout(300000);
    const port = container.getTcpPort(8080);
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        const response = await port.fetch('http://container/readyz', { signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        if (response.ok) return;
      } catch { /* Startup is asynchronous. */ }
      await scheduler.wait(200);
    }
    throw new Error('Scanner container failed readiness');
  }
}
