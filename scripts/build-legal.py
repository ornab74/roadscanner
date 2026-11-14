"""Build both public Terms mirrors and exact document acceptance metadata."""
from pathlib import Path
import hashlib,json,base64,html,re
import markdown
ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'legal/terms.md').read_text()
version=re.search(r'\*\*Document version:\*\*\s*([0-9][A-Za-z0-9.-]+)',source).group(1)
metadata={'version':version,'sha256':hashlib.sha256(source.encode()).hexdigest(),'url':'https://qroadscan.com/terms/'}
(ROOT/'cloudflare/legal-version.mjs').write_text('export const TERMS_DOCUMENT='+json.dumps(metadata)+';\n')
engine=markdown.Markdown(extensions=['toc'])
body=engine.convert(source)
css=(ROOT/'legal/terms.css').read_bytes()
sri='sha384-'+base64.b64encode(hashlib.sha384(css).digest()).decode()
for target,csspath in [(ROOT/'cloudflare/public/pages/terms.html','/pages/terms.css'),(ROOT/'website/public/terms/index.html','/terms.css')]:
 target.parent.mkdir(parents=True,exist_ok=True)
 (ROOT/'cloudflare/public/pages/terms.css' if 'cloudflare' in target.parts else ROOT/'website/public/terms.css').write_bytes(css)
 output='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#09111b"><title>Terms of Service · QRoadScan</title><meta name="description" content="Terms governing QRS simulations, errors, human oversight, responsible use and limitations of liability, subject to applicable law."><link rel="canonical" href="https://qroadscan.com/terms/"><link rel="stylesheet" href="@@CSS_PATH@@" integrity="@@CSS_SRI@@" crossorigin="anonymous"></head><body><a class="legal-skip" href="#terms-content">Skip to Terms</a><header class="legal-nav"><a class="legal-brand" href="https://qroadscan.com">QROADSCAN.</a><nav aria-label="Main navigation"><a href="https://ride.qroadscan.com/home">App home</a><a href="https://ride.qroadscan.com/docs">Docs</a><a href="https://ride.qroadscan.com/blog">Blog</a><a href="https://ride.qroadscan.com/settings/user#legal">Review account acceptance</a></nav></header><div class="legal-layout"><aside class="legal-toc" aria-label="Contents"><strong>CONTENTS</strong>@@LEGAL_TOC@@</aside><main class="legal-content" id="terms-content">@@LEGAL_BODY@@</main></div><footer class="legal-footer"><p>Document version @@VERSION@@ · SHA-256 <code>@@FINGERPRINT@@</code></p><p>QRS branding only. This page does not guarantee that any disclaimer or liability exclusion is enforceable in a particular jurisdiction.</p><nav><a href="https://qroadscan.com">Website</a><a href="https://ride.qroadscan.com/settings/user#legal">Account acceptance</a><a href="https://ride.qroadscan.com/docs">Documentation</a></nav></footer></body></html>'''
 for a,b in [('@@CSS_PATH@@',csspath),('@@CSS_SRI@@',sri),('@@LEGAL_TOC@@',engine.toc),('@@LEGAL_BODY@@',body),('@@VERSION@@',html.escape(version)),('@@FINGERPRINT@@',metadata['sha256'])]:output=output.replace(a,b)
 target.write_text(output)
print('Built public Terms mirrors and version metadata.')
