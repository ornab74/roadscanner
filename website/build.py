"""Refresh SRI after edits to static site assets; no application secrets required."""
import base64,hashlib,re
from pathlib import Path
root=Path(__file__).resolve().parent/'public'
for page in root.rglob('*.html'):
 text=page.read_text()
 def tag(match):
  value=match.group(0);url=re.search(r'(?:href|src)="(/[^\"]+)"',value)
  if not url:return value
  asset=root/url[1].lstrip('/')
  if not asset.is_file():return value
  digest='sha384-'+base64.b64encode(hashlib.sha384(asset.read_bytes()).digest()).decode()
  value=re.sub(r'\s+(?:integrity|crossorigin)="[^"]*"','',value)
  return value[:-1]+' integrity="'+digest+'" crossorigin="anonymous">'
 text=re.sub(r'<(?:script\b[^>]*\bsrc="[^"]+"|link\b(?=[^>]*\brel="stylesheet")[^>]*)[^>]*>',tag,text)
 page.write_text(text)
print('Updated static-site asset integrity.')
