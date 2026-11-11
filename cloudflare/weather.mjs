import {boundedBody} from './internal-auth.mjs';
export function weatherLocation(body){
 if(!body||Array.isArray(body)||Object.keys(body).sort().join(',')!=='latitude,longitude'||typeof body.latitude!=='number'||!Number.isFinite(body.latitude)||body.latitude< -90||body.latitude>90||typeof body.longitude!=='number'||!Number.isFinite(body.longitude)||body.longitude< -180||body.longitude>180)throw Object.assign(new Error('location_required'),{status:400});
 // About 5 km: weather does not need a precise street address.
 return {latitude:Number((Math.round(body.latitude*20)/20).toFixed(2)),longitude:Number((Math.round(body.longitude*20)/20).toFixed(2))};
}
export async function currentWeather(location,fetcher=fetch){
 const url=new URL('https://api.met.no/weatherapi/locationforecast/2.0/compact');
 url.searchParams.set('lat',location.latitude);url.searchParams.set('lon',location.longitude);
 const r=await fetcher(url.toString(),{redirect:'manual',headers:{'User-Agent':'QRoadScan/1.0 https://ride.qroadscan.com','Accept':'application/json'},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error('Weather provider unavailable');
 const d=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBody(r.body,1048576)));
 const t=Date.now(),updated=Date.parse(d.properties?.meta?.updated_at);
 if(!Number.isFinite(updated)||Math.abs(t-updated)>12*3600000)throw new Error('Weather update is stale');
 const point=(d.properties?.timeseries??[]).filter(p=>Math.abs(Date.parse(p.time)-t)<=90*60000).sort((a,b)=>Math.abs(Date.parse(a.time)-t)-Math.abs(Date.parse(b.time)-t))[0];
 const v=point?.data?.instant?.details;
 if(!v||!Number.isFinite(v.air_temperature)||v.air_temperature< -100||v.air_temperature>70||!Number.isFinite(v.wind_speed)||v.wind_speed<0||v.wind_speed>150)throw new Error('Invalid or stale current weather');
 const period=point.data.next_1_hours??point.data.next_6_hours;
 const rain=period?.details?.precipitation_amount;
 if(!Number.isFinite(rain)||rain<0||rain>500)throw new Error('Weather precipitation is unavailable');
 const symbol=period?.summary?.symbol_code;
 if(typeof symbol!=='string'||!/^[a-z_]{1,80}$/.test(symbol))throw new Error('Weather conditions unavailable');
 return {provider:'MET Norway',attribution_url:'https://www.met.no/en/free-meteorological-data',license:'CC BY 4.0',updated_at:d.properties.meta.updated_at,valid_at:point.time,temperature_c:v.air_temperature,wind_speed_ms:v.wind_speed,precipitation_mm:rain,precipitation_period_hours:point.data.next_1_hours?1:6,conditions:symbol.replaceAll('_',' '),is_daylight:/_day$/.test(symbol)?true:/_night$/.test(symbol)?false:null};
}
