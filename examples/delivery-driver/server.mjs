// Node.js 22+. Loopback-only example server; not a production deployment template.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {journey} from './public/delivery-demo-data.mjs';
const files={'/':['index.html','text/html; charset=utf-8'],'/delivery-demo.mjs':['delivery-demo.mjs','application/javascript'],'/delivery-demo.css':['delivery-demo.css','text/css'],'/delivery-demo-data.mjs':['delivery-demo-data.mjs','application/javascript']};
export function createDemoServer({apiKey=process.env.QRS_API_KEY,fetcher=fetch,maxAttempts=3}={}){
 const requests=new Map();let attempts=0,inflight=false;
 const server=http.createServer(async(req,res)=>{
  const origin='http://127.0.0.1:'+server.address().port;
  const send=(status,value,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});res.end(typeof value==='string'?value:JSON.stringify(value));};
  try{
   if(req.headers.host!=='127.0.0.1:'+server.address().port)return send(403,{error:'invalid_host'});
   if(req.method==='GET'&&Object.hasOwn(files,req.url)){const [file,type]=files[req.url];let body=await readFile(new URL('./public/'+file,import.meta.url),'utf8');if(file==='index.html'&&apiKey)body=body.replace('data-live-enabled="false"','data-live-enabled="true"');return send(200,body,type);}
   if(req.method!=='POST'||req.url!=='/api/demo/route')return send(404,{error:'not_found'});
   if(req.headers.origin!==origin)return send(403,{error:'invalid_origin'});
   if(!apiKey)return send(503,{error:'server_key_not_configured'});
   if(req.headers['content-type']!=='application/json')return send(415,{error:'json_required'});
   let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>512)return send(413,{error:'body_too_large'});chunks.push(chunk);}
   let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{error:'invalid_json'});}
   if(!data||Array.isArray(data)||Object.keys(data).join(',')!=='idempotency_key'||typeof data.idempotency_key!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(data.idempotency_key))return send(400,{error:'invalid_request'});
   if(requests.has(data.idempotency_key)){const saved=requests.get(data.idempotency_key);return saved?send(saved.status,saved.body):send(409,{error:'processing'});}
   if(inflight||attempts>=maxAttempts)return send(429,{error:'local_demo_attempt_limit'});
   attempts++;inflight=true;requests.set(data.idempotency_key,null);
   try{
    const response=await fetcher('https://ride.qroadscan.com/api/v1/routes',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':data.idempotency_key},body:JSON.stringify(journey),redirect:'error',signal:AbortSignal.timeout(240000)});
    const reader=response.body.getReader();let received=0,parts=[];while(true){const {value,done}=await reader.read();if(done)break;received+=value.length;if(received>1048576){await reader.cancel();throw Error('response_too_large');}parts.push(value);}
    const body=JSON.parse(Buffer.concat(parts).toString('utf8'));if(response.ok){requests.set(data.idempotency_key,{status:200,body});return send(200,body);}
    // Return only fixed error codes, never provider bodies or credentials.
    const error={error:'qrs_request_failed',status:response.status};requests.delete(data.idempotency_key);return send(response.status,error);
   }catch{requests.delete(data.idempotency_key);return send(502,{error:'request_unavailable_retry_same_key'});}finally{inflight=false;}
  }catch{return send(500,{error:'demo_server_error'});}
 });return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const server=createDemoServer();server.listen(8899,'127.0.0.1',()=>console.log('Delivery demo: http://127.0.0.1:8899 (server key stays private)'));}
