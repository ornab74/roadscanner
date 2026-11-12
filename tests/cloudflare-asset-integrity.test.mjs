import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
test('every generated page pins scripts, styles and module preloads to final local SHA-384 bytes',()=>{
 const result=execFileSync(process.env.QRS_TEST_PYTHON||'python3',['-c',String.raw`
from html.parser import HTMLParser
from pathlib import Path
import hashlib,base64,json,re
root=Path('cloudflare/public');count=0
class Check(HTMLParser):
 def handle_starttag(self,tag,attrs):
  global count
  a=dict(attrs)
  if tag=='script':assert 'src' in a,'Inline script found'
  if tag=='script' or tag=='link' and a.get('rel') in ('stylesheet','modulepreload'):
   src=a.get('src') or a['href'];assert src.startswith('/'),src
   data=(root/src.lstrip('/')).read_bytes();wanted='sha384-'+base64.b64encode(hashlib.sha384(data).digest()).decode()
   assert a.get('integrity')==wanted,src
   assert a.get('crossorigin')=='anonymous',src
   count+=1
  assert not any(k.lower().startswith('on') for k in a),'Inline handler'
for p in (root/'pages').glob('*.html'):Check().feed(p.read_text())
manifest=json.loads((root/'asset-integrity.json').read_text())
for path,sri in manifest['assets'].items():assert sri=='sha384-'+base64.b64encode(hashlib.sha384((root/path.lstrip('/')).read_bytes()).digest()).decode(),path
print(count)
`],{cwd:new URL('../',import.meta.url),encoding:'utf8'});assert.ok(Number(result)>100);
});
