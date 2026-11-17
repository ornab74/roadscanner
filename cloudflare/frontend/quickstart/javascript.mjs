// Requires Node.js 22+. Save as route.mjs; run: node route.mjs
// Set QRS_API_KEY in your server's environment. Never embed it in a browser.
import {readFile, writeFile, rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const base = 'https://ride.qroadscan.com';
const key = process.env.QRS_API_KEY;
if (!key) throw new Error('Set QRS_API_KEY first');
let state;
try { state = JSON.parse(await readFile('qrs-operation.json', 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  state = {
    idempotency_key: randomUUID(),
    journey: {
      start: {latitude: 40.75854190779626, longitude: -73.97720754146576},
      destination: {latitude: 40.753478752021245, longitude: -73.98087680339813},
      mode: 'driving', objective: 'balanced',
      notes: 'Public road journey southbound on Fifth Avenue. Review junctions.'
      // Optional: vehicle_id: 'OWNED_GARAGE_VEHICLE_UUID'
    }
  };
  await writeFile('qrs-operation.json', JSON.stringify(state, null, 2), {flag: 'wx', mode: 0o600});
}
async function api(method, path, body, idem) {
  const response = await fetch(base + path, {
    method, redirect: 'error', signal: AbortSignal.timeout(240_000),
    headers: {Authorization: 'Bearer ' + key,
      ...(body ? {'Content-Type': 'application/json'} : {}),
      ...(idem ? {'Idempotency-Key': idem} : {})},
    ...(body ? {body: JSON.stringify(body)} : {})
  });
  if (!response.ok) throw new Error('HTTP ' + response.status + '; request ID: ' + response.headers.get('X-Request-ID'));
  return response.json();
}
console.log('Account:', await api('GET', '/api/v1/account'));
const route = await api('POST', '/api/v1/routes', state.journey, state.idempotency_key);
await writeFile('route-response.json', JSON.stringify(route, null, 2), {mode: 0o600});
if (route.status !== 'proposal' || route.geometry_alignment?.status !== 'matched') {
  await rm('route.geojson', {force: true});
  console.log('No accepted route:', route.summary, route.endpoint_inspections.guidance);
} else {
  await writeFile('route.geojson', JSON.stringify(route.route_geojson), {mode: 0o600});
  console.log('Modeled caution, not accident probability:', route.risk_summary);
  for (const step of route.steps) console.log(step.index, step.instruction, step.distance_m, step.risk_score);
  console.log('Saved report:', await api('GET', '/api/v1/reports/' + route.report_id));
}
// On a timeout, rerun with the saved state; do not change the key or request.
// On 409, wait if processing. Poll /api/v1/operations/{operation_id} when known.
// Only remove qrs-operation.json when deliberately starting a NEW paid/free attempt.
