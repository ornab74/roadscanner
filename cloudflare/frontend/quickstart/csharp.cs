// Requires .NET 8+. dotnet new console -n QrsRoute; replace Program.cs with this.
// Set QRS_API_KEY in your server environment; run: dotnet run --project QrsRoute
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
var key = Environment.GetEnvironmentVariable("QRS_API_KEY")
    ?? throw new InvalidOperationException("Set QRS_API_KEY");
JsonNode state;
if (File.Exists("qrs-operation.json")) {
    state = JsonNode.Parse(await File.ReadAllTextAsync("qrs-operation.json"))!;
} else {
    state = new JsonObject {
        ["idempotency_key"] = Guid.NewGuid().ToString(),
        ["journey"] = JsonNode.Parse("""
        {"start":{"latitude":40.75854190779626,"longitude":-73.97720754146576},
         "destination":{"latitude":40.753478752021245,"longitude":-73.98087680339813},
         "mode":"driving","objective":"balanced",
         "notes":"Public road journey southbound on Fifth Avenue. Review junctions."}
        """) // Optional: add vehicle_id for an owned garage vehicle.
    };
    await using var file = new FileStream("qrs-operation.json",FileMode.CreateNew);
    await JsonSerializer.SerializeAsync(file,state);
}
using var handler = new HttpClientHandler { AllowAutoRedirect = false };
using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(240) };
async Task<JsonNode> Api(HttpMethod method,string path,JsonNode? body=null,string? idem=null) {
    using var request = new HttpRequestMessage(method,"https://ride.qroadscan.com"+path);
    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer",key);
    if (idem != null) request.Headers.Add("Idempotency-Key",idem);
    if (body != null) request.Content = new StringContent(body.ToJsonString(),Encoding.UTF8,"application/json");
    using var response = await client.SendAsync(request);
    response.EnsureSuccessStatusCode();
    return JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
}
Console.WriteLine("Account: "+await Api(HttpMethod.Get,"/api/v1/account"));
var route = await Api(HttpMethod.Post,"/api/v1/routes",state["journey"],state["idempotency_key"]!.GetValue<string>());
await File.WriteAllTextAsync("route-response.json",route.ToJsonString());
if (route["status"]?.GetValue<string>() != "proposal" || route["geometry_alignment"]?["status"]?.GetValue<string>() != "matched") {
    File.Delete("route.geojson"); File.Delete("saved-report.json");
    Console.WriteLine("No accepted route: "+route["summary"]);
} else {
    await File.WriteAllTextAsync("route.geojson",route["route_geojson"]!.ToJsonString());
    Console.WriteLine("Modeled caution, not accident probability: "+route["risk_summary"]);
    foreach (var step in route["steps"]!.AsArray()) Console.WriteLine(step);
    var saved = await Api(HttpMethod.Get,"/api/v1/reports/"+route["report_id"]!.GetValue<long>());
    await File.WriteAllTextAsync("saved-report.json",saved.ToJsonString());
}
// On a timeout, rerun with the SAME saved state; no automatic new operation.
// On 409, wait if processing; inspect /api/v1/operations/{operation_id} when known.
// Protect local journey/report files; restrict their filesystem permissions.
