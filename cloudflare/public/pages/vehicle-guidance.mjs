// Shared profile vocabulary for model context and the browser; no provider secrets.
export const VEHICLE_FIELDS={
 car:[['mass_kg','Loaded mass (kg)'],['height_m','Overall height (m)'],['width_m','Overall width (m)'],['length_m','Overall length (m)'],['towing','Towing a trailer','boolean'],['trailer_length_m','Trailer length (m)']],
 motorcycle:[['engine_cc','Engine (cc)'],['mass_kg','Loaded mass (kg)'],['abs','ABS fitted','boolean']],
 truck:[['configuration','Truck configuration','select',['rigid','articulated']],['height_m','Overall loaded height (m)'],['width_m','Overall loaded width (m)'],['length_m','Total combination length (m)'],['trailer_length_m','Trailer length (m)'],['mass_kg','Loaded gross mass (kg)'],['axles','Total combination axles'],['hazmat','Hazmat load','boolean']],
 train:[['length_m','Length (m)'],['mass_kg','Mass (kg)'],['rail_gauge_mm','Rail gauge (mm)'],['traction','Traction','select',['diesel','electric','steam','hybrid']]],
 aircraft:[['airframe','Aircraft category','select',['fixed_wing','helicopter']],['type_designator','ICAO type (e.g. C172 / R44)','text'],['icao24','OpenSky ICAO24 (6 hex digits)','text'],['true_airspeed_kt','Cruise TAS (knots)'],['fuel_burn_per_hour','Cruise fuel burn / hour'],['fuel_capacity','Usable fuel capacity'],['fuel_unit','Fuel unit','select',['gal','l','kg']],['reserve_minutes','Scenario reserve (minutes)'],['rotor_diameter_m','Rotor diameter (helicopter, m)']],
};
export function vehicleNavigationContext(vehicle){
 const kind=vehicle?.kind??'unselected',s=vehicle?.specs??{};
 const helicopter=kind==='aircraft'&&s.airframe==='helicopter';
 const articulated=kind==='truck'&&s.configuration==='articulated';
 const labels={car:s.towing?'Car with trailer':'Car',motorcycle:'Motorcycle',truck:articulated?'Articulated truck / 18-wheeler':'Truck',aircraft:helicopter?'Helicopter':s.airframe==='fixed_wing'?'Fixed-wing aircraft':'Aircraft · category unspecified',train:'Train',unselected:'No vehicle profile selected'};
 const focuses={
  car:['Intersection and entrance visibility, crossing activity and observed lane geometry.','For towing, consider the whole combination length, turning room and stopping-space uncertainty.','Separate posted access facts from unknown restrictions; do not infer traffic or available parking.'],
  motorcycle:['Crosswinds and exposed bridges, precipitation, visibility and cold-weather exposure.','Visible bends, junctions and surface transitions; gravel, paint, metal covers and standing water only when evidenced.','ABS does not establish grip; never prescribe lean angle, traction limits or an unverified safe speed.'],
  truck:['Loaded height/width, gross mass, axles, total combination length, trailer length and hazmat status.','Bridge and tunnel restrictions, truck prohibitions, tight junctions, off-tracking, trailer swing and loading-site entrances.','Do not recommend reversing, certify clearance, or assume a mapped road supports this combination. Missing official restriction data stays unknown.'],
  aircraft:helicopter?['Rotor clearance, wires and obstacles, landing-site dimensions/surface/permission and approach/departure environment require official verification.','Density altitude, hover performance (IGE/OGE), gusts, terrain winds and visibility need aircraft-specific performance data.','Cruise-only direct-corridor fuel omits hover, start, ground running, maneuvering and landing-site allowances; never extrapolate the wind-triangle estimate to hover.']:['Runway length/surface, aircraft performance, crosswind components, terrain and alternate-airport requirements need official verification.','Separate forecast pressure-level winds from measured flight-level winds; review timestamps, coverage and weather changes.','If aircraft category is unspecified, ask whether fixed-wing or helicopter before category-specific conclusions.'],
  train:['Dispatcher authority, signals, track access, gauge and adhesion require railway sources.'],
  unselected:['Do not assume vehicle size, towing status, truck clearance, motorcycle equipment or aircraft performance.'],
 };
 const required=kind==='truck'?['configuration','height_m','width_m','length_m','mass_kg','axles','hazmat',...(articulated?['trailer_length_m']:[])]:kind==='aircraft'?['airframe','true_airspeed_kt','fuel_burn_per_hour','fuel_capacity','fuel_unit','reserve_minutes',...(helicopter?['rotor_diameter_m']:[])]:kind==='car'&&s.towing?['height_m','width_m','length_m','trailer_length_m']:[];
 return {version:1,kind,specifications:{...s},label:labels[kind]??'Unspecified vehicle',focus:focuses[kind]??focuses.unselected,missing_profile_fields:required.filter(k=>s[k]===undefined||s[k]===null||s[k]===''),specification_source:'USER_SUPPLIED',geometry_policy:kind==='aircraft'?'Briefing corridor only; no clearance, separation, flight-path or landing authorization.':'Preserve mapped geometry; do not invent lane, restriction or surface measurements.',instruction_style:kind==='aircraft'?'Evidence-first preflight questions and weather/fuel review; no maneuver commands.':'Concise entry action and supported street name, followed by vehicle-specific checks; GPS distances derive from the existing mapped proposal, not LLM guesses.'};
}
export function mountVehicleGuidance(anchor,vehicle){
 if(!anchor)return;
 const id=anchor.id+'Guidance';let panel=document.getElementById(id);
 if(!panel){panel=document.createElement('details');panel.id=id;panel.className='vehicle-guidance';anchor.after(panel);}
 const context=vehicleNavigationContext(vehicle),summary=document.createElement('summary'),list=document.createElement('ul');
 summary.textContent=context.label+' · guidance focus'+(context.missing_profile_fields.length?' · '+context.missing_profile_fields.length+' missing details':'');
 for(const item of context.focus){const li=document.createElement('li');li.textContent=item;list.append(li);}
 panel.replaceChildren(summary,list);
 if(context.missing_profile_fields.length){const p=document.createElement('p');p.className='vehicle-guidance-missing';const labels=Object.fromEntries((VEHICLE_FIELDS[context.kind]??[]).map(f=>[f[0],f[1]]));p.textContent='Add in Garage: '+context.missing_profile_fields.map(k=>labels[k]??k).join(', ')+'.';panel.append(p);}
}
