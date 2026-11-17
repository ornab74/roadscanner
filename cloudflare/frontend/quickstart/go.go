// Requires Go 1.22+. Save as route.go; run: go run route.go
// Set QRS_API_KEY securely in your server environment first.
package main
import (
 "bytes"; "crypto/rand"; "encoding/hex"; "encoding/json"; "fmt"; "io"; "net/http"; "os"; "time"
)
type State struct { Key string `json:"idempotency_key"`; Journey json.RawMessage `json:"journey"` }
func main() {
 key := os.Getenv("QRS_API_KEY"); if key == "" { panic("Set QRS_API_KEY") }
 var state State
 data, err := os.ReadFile("qrs-operation.json")
 if os.IsNotExist(err) {
  random := make([]byte, 16); if _,err = rand.Read(random); err != nil { panic(err) }
  state = State{Key:hex.EncodeToString(random), Journey:json.RawMessage(`{
   "start":{"latitude":40.75854190779626,"longitude":-73.97720754146576},
   "destination":{"latitude":40.753478752021245,"longitude":-73.98087680339813},
   "mode":"driving","objective":"balanced",
   "notes":"Public road journey southbound on Fifth Avenue. Review junctions."
  }`)} // Optional: add vehicle_id for an owned garage vehicle.
  data,err = json.MarshalIndent(state,"","  "); if err != nil { panic(err) }
  f,e := os.OpenFile("qrs-operation.json",os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600); if e != nil { panic(e) }
  if _,e=f.Write(data); e != nil { f.Close(); panic(e) }; f.Close()
 } else if err != nil { panic(err) } else if err=json.Unmarshal(data,&state); err != nil { panic(err) }
 client := &http.Client{Timeout:240*time.Second, CheckRedirect:func(*http.Request,[]*http.Request)error{return http.ErrUseLastResponse}}
 api := func(method,path string,body []byte,idem string) map[string]any {
  req,e:=http.NewRequest(method,"https://ride.qroadscan.com"+path,bytes.NewReader(body));if e!=nil{panic(e)}
  req.Header.Set("Authorization","Bearer "+key)
  if body!=nil{req.Header.Set("Content-Type","application/json")};if idem!=""{req.Header.Set("Idempotency-Key",idem)}
  res,e:=client.Do(req);if e!=nil{panic(e)};defer res.Body.Close()
  if res.StatusCode<200||res.StatusCode>=300{panic(fmt.Sprintf("HTTP %d; request ID: %s",res.StatusCode,res.Header.Get("X-Request-ID")))}
  var out map[string]any;if e=json.NewDecoder(io.LimitReader(res.Body,1048576)).Decode(&out);e!=nil{panic(e)};return out
 }
 fmt.Println("Account:",api("GET","/api/v1/account",nil,""))
 route:=api("POST","/api/v1/routes",state.Journey,state.Key)
 save:=func(name string,v any){b,e:=json.MarshalIndent(v,"","  ");if e!=nil{panic(e)};if e=os.WriteFile(name,b,0600);e!=nil{panic(e)}}
 save("route-response.json",route)
 alignment,_:=route["geometry_alignment"].(map[string]any)
 if route["status"]!="proposal"||alignment["status"]!="matched"{os.Remove("route.geojson");os.Remove("saved-report.json");fmt.Println("No accepted route:",route["summary"]);return}
 save("route.geojson",route["route_geojson"])
 fmt.Println("Modeled caution, not accident probability:",route["risk_summary"])
 for _,step:=range route["steps"].([]any){fmt.Println(step)}
 report:=fmt.Sprintf("%.0f",route["report_id"].(float64))
 save("saved-report.json",api("GET","/api/v1/reports/"+report,nil,""))
}
// Timeout? Rerun with the saved state; do not change request or key.
// 409? Wait if processing. Poll /api/v1/operations/{operation_id} when known.
// Remove state only to deliberately start a NEW analysis attempt.
