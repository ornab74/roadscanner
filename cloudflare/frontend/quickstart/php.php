<?php
// Requires PHP 8.1+ with cURL. Save as route.php; run: php route.php
// Set QRS_API_KEY securely in your server environment first.
$key = getenv('QRS_API_KEY');
if (!$key) throw new RuntimeException('Set QRS_API_KEY');
umask(0077);
if (file_exists('qrs-operation.json')) {
    $state = json_decode(file_get_contents('qrs-operation.json'),true,512,JSON_THROW_ON_ERROR);
} else {
    $state = ['idempotency_key'=>bin2hex(random_bytes(16)), 'journey'=>[
        'start'=>['latitude'=>40.75854190779626,'longitude'=>-73.97720754146576],
        'destination'=>['latitude'=>40.753478752021245,'longitude'=>-73.98087680339813],
        'mode'=>'driving','objective'=>'balanced',
        'notes'=>'Public road journey southbound on Fifth Avenue. Review junctions.'
        // Optional: 'vehicle_id'=>'OWNED_GARAGE_VEHICLE_UUID'
    ]];
    $f = fopen('qrs-operation.json','x');
    if ($f === false) throw new RuntimeException('State already exists or is unwritable');
    fwrite($f,json_encode($state,JSON_THROW_ON_ERROR)); fclose($f);
}
function api(string $method,string $path,?array $body=null,?string $idem=null): array {
    global $key;
    $headers = ['Authorization: Bearer '.$key];
    if ($body !== null) $headers[] = 'Content-Type: application/json';
    if ($idem !== null) $headers[] = 'Idempotency-Key: '.$idem;
    $ch = curl_init('https://ride.qroadscan.com'.$path);
    $options = [CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_RETURNTRANSFER=>true,
        CURLOPT_FOLLOWLOCATION=>false,CURLOPT_TIMEOUT=>240,CURLOPT_CONNECTTIMEOUT=>10,
        CURLOPT_HTTPHEADER=>$headers];
    if ($body !== null) $options[CURLOPT_POSTFIELDS] = json_encode($body,JSON_THROW_ON_ERROR);
    curl_setopt_array($ch,$options);$response = curl_exec($ch);
    if ($response === false) { $error=curl_error($ch);curl_close($ch);throw new RuntimeException($error); }
    $status=curl_getinfo($ch,CURLINFO_HTTP_CODE);curl_close($ch);
    if ($status<200||$status>=300) throw new RuntimeException('HTTP '.$status);
    return json_decode($response,true,512,JSON_THROW_ON_ERROR);
}
print_r(api('GET','/api/v1/account'));
$route=api('POST','/api/v1/routes',$state['journey'],$state['idempotency_key']);
file_put_contents('route-response.json',json_encode($route,JSON_PRETTY_PRINT|JSON_THROW_ON_ERROR));
if ($route['status']!=='proposal'||($route['geometry_alignment']['status']??null)!=='matched') {
    if (is_file('route.geojson')) unlink('route.geojson');
    if (is_file('saved-report.json')) unlink('saved-report.json');
    echo 'No accepted route: '.$route['summary'].PHP_EOL;
} else {
    file_put_contents('route.geojson',json_encode($route['route_geojson'],JSON_THROW_ON_ERROR));
    echo 'Modeled caution, not accident probability:'.PHP_EOL; print_r($route['risk_summary']);
    foreach ($route['steps'] as $step) print_r($step);
    $saved=api('GET','/api/v1/reports/'.$route['report_id']);
    file_put_contents('saved-report.json',json_encode($saved,JSON_THROW_ON_ERROR));
}
// Timeout? Rerun the SAME saved state. 409? Wait if processing; don't create a new key.
// Inspect /api/v1/operations/{operation_id} when known. Respect poll_after_seconds.
// Delete state only when intentionally requesting a NEW analysis attempt.
