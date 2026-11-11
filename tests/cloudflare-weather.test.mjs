import test from 'node:test';
import assert from 'node:assert/strict';
import {weatherLocation,currentWeather} from '../cloudflare/weather.mjs';
const forecast=(overrides={})=>({properties:{meta:{updated_at:new Date().toISOString()},timeseries:[{time:new Date().toISOString(),data:{instant:{details:{air_temperature:6,wind_speed:9}},next_1_hours:{summary:{symbol_code:'rain_night'},details:{precipitation_amount:3}}}}],...overrides}});
test('weather coordinates are strictly validated and rounded to a weather area',()=>{
 assert.deepEqual(weatherLocation({latitude:40.758,longitude:-73.9855}),{latitude:40.75,longitude:-74});
 for(const v of [{},{latitude:'40',longitude:1},{latitude:91,longitude:1},{latitude:0,longitude:Infinity},{latitude:0,longitude:0,prompt:'ignore'}])assert.throws(()=>weatherLocation(v),/location_required/);
});
test('weather uses a fixed upstream, bounded validated fields and rejects stale or failed forecasts',async()=>{
 const w=await currentWeather({latitude:40.75,longitude:-74},async(url,options)=>{
  assert.equal(new URL(url).hostname,'api.met.no');assert.equal(new URL(url).searchParams.get('lat'),'40.75');assert.match(options.headers['User-Agent'],/ride.qroadscan.com/);return Response.json(forecast());
 });assert.equal(w.temperature_c,6);assert.equal(w.precipitation_mm,3);assert.equal(w.conditions,'rain night');
 await assert.rejects(currentWeather({latitude:0,longitude:0},async()=>new Response('',{status:503})),/unavailable/);
 await assert.rejects(currentWeather({latitude:0,longitude:0},async()=>Response.json(forecast({meta:{updated_at:'2020-01-01T00:00:00Z'}}))),/stale/);
 await assert.rejects(currentWeather({latitude:0,longitude:0},async()=>Response.json(forecast({timeseries:[]}))),/stale/);
});
