import './navigation.mjs';
const status=document.getElementById('docsCopyStatus');for(const pre of document.querySelectorAll('#docsContent pre')){const b=document.createElement('button');b.type='button';b.className='copy-code';b.textContent='Copy example';b.onclick=async()=>{try{await navigator.clipboard.writeText(pre.querySelector('code')?.textContent??pre.textContent);status.textContent='Example copied.';setTimeout(()=>{status.textContent='';},2200);}catch{const range=document.createRange();range.selectNodeContents(pre.querySelector('code')??pre);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);status.textContent='Example selected. Use your browser’s copy command.';}};pre.append(b);}
const input=document.getElementById('docsSearch'),sections=[...document.querySelectorAll('.doc-section')];input?.addEventListener('input',()=>{const term=input.value.trim().toLowerCase();let visible=0;for(const section of sections){section.hidden=!!term&&!section.textContent.toLowerCase().includes(term);if(!section.hidden)visible++;}for(const a of document.querySelectorAll('#docsTOC a')){const target=document.getElementById(decodeURIComponent(a.hash.slice(1))),section=target?.closest('.doc-section');a.closest('li').hidden=!!section?.hidden;}document.getElementById('docsSearchStatus').textContent=term?visible+' matching sections':'';});if(matchMedia('(max-width:760px)').matches)document.getElementById('docsNav').open=false;
const quickExamples={
 curl:`curl --fail-with-body --max-time 30 \\
  https://ride.qroadscan.com/api/v1/account \\
  -H "Authorization: Bearer $QRS_API_KEY"`,
 httpx:`# pip install httpx
import os
import httpx

with httpx.Client(timeout=30, follow_redirects=False) as client:
    response = client.get(
        "https://ride.qroadscan.com/api/v1/account",
        headers={"Authorization": f"Bearer {os.environ['QRS_API_KEY']}"},
    )
    response.raise_for_status()
    print(response.json())`,
 requests:`# pip install requests
import os
import requests

response = requests.get(
    "https://ride.qroadscan.com/api/v1/account",
    headers={"Authorization": f"Bearer {os.environ['QRS_API_KEY']}"},
    timeout=30,
    allow_redirects=False,
)
response.raise_for_status()
print(response.json())`,
 javascript:`// Node.js server, never a browser bundle
const response = await fetch(
  "https://ride.qroadscan.com/api/v1/account", {
    headers: {Authorization: "Bearer " + process.env.QRS_API_KEY},
    redirect: "error",
    signal: AbortSignal.timeout(30_000)
  }
);
if (!response.ok) throw new Error("HTTP " + response.status);
console.log(await response.json());`,
 go:`package main
import ("fmt"; "io"; "net/http"; "os"; "time")
func main() {
  client := &http.Client{Timeout: 30*time.Second,
    CheckRedirect: func(*http.Request, []*http.Request) error {
      return http.ErrUseLastResponse
    }}
  req, err := http.NewRequest("GET",
    "https://ride.qroadscan.com/api/v1/account", nil)
  if err != nil { panic(err) }
  req.Header.Set("Authorization", "Bearer "+os.Getenv("QRS_API_KEY"))
  res, err := client.Do(req)
  if err != nil { panic(err) }
  defer res.Body.Close()
  if res.StatusCode != 200 { panic(res.Status) }
  body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
  if err != nil { panic(err) }
  fmt.Println(string(body))
}`,
 csharp:`using System.Net.Http.Headers;
using var handler = new HttpClientHandler { AllowAutoRedirect = false };
using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(30) };
client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
    "Bearer", Environment.GetEnvironmentVariable("QRS_API_KEY"));
using var response = await client.GetAsync(
    "https://ride.qroadscan.com/api/v1/account");
response.EnsureSuccessStatusCode();
Console.WriteLine(await response.Content.ReadAsStringAsync());`,
 php:`<?php
$ch = curl_init('https://ride.qroadscan.com/api/v1/account');
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_FOLLOWLOCATION => false,
  CURLOPT_TIMEOUT => 30,
  CURLOPT_HTTPHEADER => ['Authorization: Bearer '.getenv('QRS_API_KEY')],
]);
$body = curl_exec($ch);
if ($body === false) { throw new RuntimeException(curl_error($ch)); }
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
if ($status !== 200) { throw new RuntimeException('HTTP '.$status); }
print_r(json_decode($body, true, 512, JSON_THROW_ON_ERROR));`
};
const tabs=[...document.querySelectorAll('#docsLanguageTabs [role=tab]')],sample=document.getElementById('docsQuickExample'),panel=document.getElementById('docsQuickPanel');
function selectLanguage(tab){for(const b of tabs){b.setAttribute('aria-selected',String(b===tab));b.tabIndex=b===tab?0:-1;}sample.textContent=quickExamples[tab.dataset.lang];panel.setAttribute('aria-labelledby',tab.id);}
for(const tab of tabs){tab.onclick=()=>selectLanguage(tab);tab.onkeydown=e=>{const i=tabs.indexOf(tab);let n;if(e.key==='ArrowRight')n=(i+1)%tabs.length;else if(e.key==='ArrowLeft')n=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=tabs.length-1;else return;e.preventDefault();selectLanguage(tabs[n]);tabs[n].focus();};}if(tabs.length)selectLanguage(tabs[0]);
document.getElementById('docsQuickCopy')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(sample.textContent);status.textContent='Request copied. Set QRS_API_KEY only on your server.';}catch{status.textContent='Select the example and use your browser’s copy command.';}});
const navLinks=[...document.querySelectorAll('#docsTOC a,.docs-core-nav a')];if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{const active=entries.filter(e=>e.isIntersecting&&!e.target.hidden).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top)[0];if(!active)return;for(const a of navLinks){if(a.hash==='#'+active.target.id)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');}},{rootMargin:'-90px 0px -60% 0px',threshold:0});for(const s of sections)observer.observe(s);}
const empty=document.createElement('p');empty.className='docs-empty';empty.hidden=true;empty.textContent='No sections found. Try “authentication”, “route”, “credits”, or a language name.';document.getElementById('docsContent').append(empty);input?.addEventListener('input',()=>{empty.hidden=sections.some(s=>!s.hidden);});
