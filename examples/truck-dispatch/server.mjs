import {createBriefingDemo} from '../shared/briefing-server.mjs';
import {liveRequest} from './public/briefing-demo-data.mjs';
const server=createBriefingDemo({kind:'fleet',directory:new URL('./public/',import.meta.url),request:liveRequest,vehicleId:process.env.QRS_DEMO_TRUCK_ID});
server.listen(8900,'127.0.0.1',()=>console.log('Truck dispatch demo: http://127.0.0.1:8900'));
