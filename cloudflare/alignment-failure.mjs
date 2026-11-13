// Fixed, non-sensitive diagnostics. Never return provider bodies, coordinates or
// raw exception text. A rejected graph remains rejected; no straight-line fallback.
const failures={
 'Road source unavailable':['source_unavailable','The mapped-road data service could not be reached. Retry the analysis; moving the endpoints is not required for this service error.',true],
 'Road tile unavailable':['tile_unavailable','A required mapped-road tile could not be downloaded. Retry the analysis; no road connection was accepted.',true],
 'Unrecognized road source':['source_changed','The road-data service returned an unsupported tile format. The integration needs updating; changing the endpoints will not fix this.',false],
 'Road trace supports routes under 90 km':['distance_limit','The endpoints exceed the current 90 km road-trace span limit. Split the journey into shorter trips.',false],
 'Road trace area too large':['area_limit','The selected corridor exceeds the bounded map-download area. Split the journey into shorter trips.',false],
 'Endpoint is too far from a mapped public road':['endpoint_distance','A selected endpoint is more than 150 m from the available mapped road geometry. Move the pin to the actual public-road entrance and try again.',false],
 'Mapped roads do not connect this proposal':['no_connection','No directed connection was found between the selected mapped endpoint anchors. Check the road entrances or request a different corridor; the map may have incomplete connections.',false],
 'Incomplete mapped path':['no_connection','The recovered mapped path was incomplete. No continuous road geometry was accepted. Request another proposal.',false],
 'Mapped proposal would make an excessive detour':['excessive_detour','The mapped candidate made an excessive detour and was rejected. Request a different corridor or add a supported via-road preference.',false],
 'Mapped names do not support the LLM corridor':['corridor_mismatch','The recovered mapped path did not sufficiently match the model’s proposed street corridor. Request another proposal or specify a clearer via-road preference.',false],
 'Too many mapped street sections':['section_limit','The mapped candidate exceeded the 60-section review limit. Use a shorter trip or request the simplest-maneuvers objective.',false],
 'Road tile feature limit':['resource_limit','The road-data tile exceeded the bounded feature limit. Try a smaller corridor.',false],
 'Road geometry limit':['resource_limit','The downloaded map exceeded the bounded geometry limit. Try a smaller corridor.',false],
 'Road graph too large':['resource_limit','The mapped graph exceeded the bounded size limit. Try a smaller corridor.',false],
 'Road matching search limit':['resource_limit','The road-alignment search reached its bounded complexity limit. Try a shorter corridor.',false],
};
export function alignmentFailure(error){
 const timeout=['TimeoutError','AbortError'].includes(error?.name),entry=timeout?['source_timeout','The mapped-road download timed out. Retry the analysis; no route geometry was accepted.',true]:Object.hasOwn(failures,error?.message??'')?failures[error.message]:undefined;
 const [code,message,retryable]=entry??['alignment_unavailable','Mapped-road alignment could not finish. No continuous road geometry was accepted. Please retry the analysis.',false];
 return {code,message,retryable};
}
