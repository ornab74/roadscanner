import {createBriefingDemo} from '../shared/briefing-server.mjs';
import {liveRequest} from './public/briefing-demo-data.mjs';
const server=createBriefingDemo({kind:'flight',directory:new URL('./public/',import.meta.url),request:liveRequest,vehicleId:process.env.QRS_DEMO_AIRCRAFT_ID});
server.listen(8901,'127.0.0.1',()=>console.log('Aircraft briefing demo: http://127.0.0.1:8901'));
