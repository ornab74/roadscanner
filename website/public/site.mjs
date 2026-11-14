const examples={
 python:{comment:'# Server-side Python · pip install httpx',code:`import os
import httpx

response = httpx.get(
    "https://ride.qroadscan.com/api/v1/account",
    headers={
        "Authorization": f"Bearer {os.environ['QRS_API_KEY']}"
    },
    timeout=20,
    follow_redirects=False,
)
response.raise_for_status()
print(response.json())`},
 javascript:{comment:'// Server-side JavaScript · Node.js',code:`const response = await fetch(
  'https://ride.qroadscan.com/api/v1/account',
  {
    headers: {
      Authorization: 'Bearer ' + process.env.QRS_API_KEY
    },
    redirect: 'error',
    signal: AbortSignal.timeout(20000)
  }
);
if (!response.ok) throw new Error('HTTP ' + response.status);
console.log(await response.json());`},
 curl:{comment:'# Terminal · use your secret environment setting',code:`curl --fail-with-body --silent --show-error \\
  --max-time 20 \\
  'https://ride.qroadscan.com/api/v1/account' \\
  -H "Authorization: Bearer $QRS_API_KEY"`}
};
const tabs=[...document.querySelectorAll('[data-language]')];
function selectLanguage(tab){for(const t of tabs){t.setAttribute('aria-selected',String(t===tab));t.tabIndex=t===tab?0:-1;}const example=examples[tab.dataset.language];document.getElementById('api-example').textContent=example.code;document.getElementById('code-comment').textContent=example.comment;document.getElementById('code-panel').setAttribute('aria-labelledby',tab.id);document.getElementById('copy-status').textContent='';}
for(const tab of tabs){tab.addEventListener('click',()=>selectLanguage(tab));tab.addEventListener('keydown',event=>{let n=tabs.indexOf(tab);if(event.key==='ArrowRight')n=(n+1)%tabs.length;else if(event.key==='ArrowLeft')n=(n+tabs.length-1)%tabs.length;else if(event.key==='Home')n=0;else if(event.key==='End')n=tabs.length-1;else return;event.preventDefault();tabs[n].focus();selectLanguage(tabs[n]);});}
document.getElementById('copy-code')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(document.getElementById('api-example').textContent);document.getElementById('copy-status').textContent='API example copied.';}catch{document.getElementById('copy-status').textContent='Copy unavailable. Select the code to copy it manually.';}});
for(const button of document.querySelectorAll('[data-preview]'))button.addEventListener('click',()=>{const section=button.dataset.preview==='section';document.querySelector('.route-window').classList.toggle('section-active',section);for(const b of document.querySelectorAll('[data-preview]')){b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));}document.getElementById('insight-kicker').textContent=section?'EXAMPLE / SECTION REVIEW':'THE BIGGER PICTURE';document.getElementById('insight-title').textContent=section?'Maple Avenue · moderate modeled caution':'See where caution changes.';document.getElementById('insight-description').textContent=section?'Illustrative example: review the junction, weather context and uncertainty behind the ribbon. No live conditions are shown.':'Select a section in the app to explore its modeled score and contributing factors.';});
for(const link of document.querySelectorAll('.mobile-menu a'))link.addEventListener('click',()=>{document.querySelector('.mobile-menu').open=false;});
