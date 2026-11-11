"""Render the repository's existing page designs for the Cloudflare adapter.

Read templates with AST instead of importing main.py or opening its database.
Generated HTML/CSS retains the original markup and styles; page modules connect
the supported controls to Worker APIs without inline script execution.
"""
from __future__ import annotations
import ast
import base64
import hashlib
import json
from pathlib import Path
import re
import shutil

from bs4 import BeautifulSoup
from jinja2 import Environment, StrictUndefined
from markupsafe import Markup
from wtforms import Form, PasswordField, StringField, SubmitField

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = Path(__file__).resolve().parent / 'public'
PAGES = PUBLIC / 'pages'
PAGES.mkdir(exist_ok=True)
TREE = ast.parse((ROOT / 'main.py').read_text())
ENV = Environment(autoescape=True, undefined=StrictUndefined)
polish_node = next(n for n in TREE.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='APP_BUTTON_POLISH_CSS' for t in n.targets))
polish = BeautifulSoup(ast.literal_eval(polish_node.value),'html.parser').style.get_text()
(PAGES/'shared.css').write_text(polish)

def template(name: str) -> str:
    function = next(n for n in TREE.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)
    for node in ast.walk(function):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'render_template_string':
            if node.args and isinstance(node.args[0], ast.Constant):
                return node.args[0].value
    raise ValueError('Missing template: ' + name)

def route(name: str, **kwargs: str) -> str:
    if name == 'static': return '/static/' + kwargs['filename']
    return {'home':'/home','login':'/login','register':'/register','dashboard':'/dashboard',
        'logout':'/auth/logout','user_settings':'/settings/user','radar_page':'/dashboard#locationMap',
        'blog_index':'/blog','favicon':'/favicon.svg'}.get(name, '/home')

home_node = next(n for n in TREE.body if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name) and n.target.id == 'HOME_UI_TEXT')
HOME_TEXT = ast.literal_eval(home_node.value)['en'].copy()
HOME_TEXT.update({
    'kicker':'Road intelligence and safety awareness.',
    'live_risk_preview':'Grok guess mode',
    'read_body':'The colorwheel uses Grok guess mode with the original prompt, color mapping, confidence display and breathing animation. Each refresh creates a new simulated reading; no login or location permission is needed.',
    'waiting':'Sign in and run a scan to see your assessment.',
    'watch_wheel':'Explore the colorwheel design, then open your dashboard for an assessment from supplied observations.',
})
BASE = dict(url_for=route,session={'is_admin':False},posts=[],csrf_token=lambda:'',current_language='en',
    language_html_lang=lambda _:'en',language_text_direction=lambda _:'ltr',
    language_label=lambda _:'English',language_locale=lambda _:'en-US',
    home_text=HOME_TEXT,seed_hex='#49c2ff',seed_code='B2',accent='#49c2ff',
    home_url='https://ride.qroadscan.com/home',blog_url='https://ride.qroadscan.com/blog',
    feed_url='/feed.xml',sitemap_url='/sitemap.xml',favicon_svg_url='/favicon.svg',manifest_url='/site.webmanifest',
    home_schema=Markup('{}'),home_blog_schema=Markup('{}'),blog_schema=Markup('{}'),
    og_image_url='https://ride.qroadscan.com/favicon.svg',og_image_alt='QRoadScan',og_locale='en_US',
    seo_description='Road-scene assessments from supplied observations, with weather radar and saved reports.',
    seo_keywords='road scanner, road observations, weather radar',blog_description='QRoadScan traffic safety and product updates.',
    seo_iso_datetime=lambda value:value,
)

class AuthForm(Form):
    username = StringField('Email', render_kw={'type':'email','autocomplete':'username','required':True,'maxlength':254})
    password = PasswordField('Password', render_kw={'autocomplete':'current-password','required':True,'minlength':12,'maxlength':256})
    invite_code = StringField('Invite code')
    submit = SubmitField('Login')
    def hidden_tag(self): return Markup('')

def parse(name: str, **context) -> BeautifulSoup:
    values = {**BASE, **context}
    return BeautifulSoup(ENV.from_string(template(name)).render(**values), 'html.parser')

def fragment(html: str):
    return BeautifulSoup(html, 'html.parser')

def account_navigation(active: str):
    nav=fragment('''<nav class="sidebar account-navigation" aria-label="Account navigation"><div class="navbar-brand">QRS</div><a href="/home" aria-label="Home"><i class="fas fa-globe" aria-hidden="true"></i><span>Home</span></a><a href="/dashboard" data-nav="dashboard" aria-label="Dashboard"><i class="fas fa-home" aria-hidden="true"></i><span>Dashboard</span></a><a href="/settings/user" data-nav="settings" aria-label="User Settings"><i class="fas fa-user-cog" aria-hidden="true"></i><span>User Settings</span></a><a href="/dashboard#locationMap" aria-label="Map and radar"><i class="fas fa-map-marked-alt" aria-hidden="true"></i><span>Map &amp; radar</span></a><form method="post" action="/auth/logout" class="qrs-logout-form" data-action="logout"><button type="submit" class="qrs-logout-button" aria-label="Logout"><i class="fas fa-sign-out-alt" aria-hidden="true"></i><span>Logout</span></button></form></nav>''').nav
    nav.select_one('[data-nav="'+active+'"]').attrs.update({'class':'active','aria-current':'page'})
    return nav

def save(page: str, soup: BeautifulSoup, module: str | None = None, extra_css: str = ''):
    css = '\n'.join((str(style.string) if style.string is not None else style.get_text()) for style in soup.find_all('style'))
    for style in soup.find_all('style'): style.decompose()
    (PAGES / (page + '.css')).write_text('\n'.join(line.rstrip() for line in (css+'\n'+extra_css).splitlines()).rstrip()+'\n')
    soup.head.append(soup.new_tag('link', rel='stylesheet', href='/pages/' + page + '.css'))
    soup.head.append(soup.new_tag('link', rel='stylesheet', href='/pages/shared.css'))
    if page in ('dashboard','settings'):
        soup.select_one('.sidebar').replace_with(account_navigation(page))
        soup.head.append(soup.new_tag('link', rel='stylesheet', href='/pages/account-navigation.css'))
    for script in soup.find_all('script'): script.decompose()
    for element in soup.select('[onclick]'):
        action = element.get('onclick','')
        if 'getCoordinates' in action: element['data-action']='geolocate'
        elif 'startScan' in action: element['data-action']='scan'
        elif 'showSection' in action:
            match=re.search(r"showSection\('([^']+)'\)",action)
            if match: element['data-action']=match[1]
        elif 'nextStep' in action:
            element['data-action']='step3' if 'nextStep(2)' in action else 'step2'
        del element['onclick']
    for form in soup.select('.qrs-logout-form'):
        form['data-action']='logout'
        for field in form.select('input[type=hidden]'): field.decompose()
    for link in soup.select('link[rel=stylesheet]'):
        href=link.get('href','')
        if href.startswith('/static/'):
            data=(ROOT / href.lstrip('/')).read_bytes()
            link['integrity']='sha256-'+base64.b64encode(hashlib.sha256(data).digest()).decode()
    for src in ('/static/js/jquery.min.js','/static/js/bootstrap.bundle.min.js'):
        tag=soup.new_tag('script',src=src,defer=True)
        tag['integrity']='sha256-'+base64.b64encode(hashlib.sha256((ROOT/src.lstrip('/')).read_bytes()).digest()).decode()
        tag['crossorigin']='anonymous';soup.body.append(tag)
    if page == 'dashboard':
        soup.body.append(soup.new_tag('script',src='/leaflet.js',defer=True))
    if module:
        soup.body.append(soup.new_tag('script',type='module',src='/pages/'+module))
    soup.html['data-page']=page
    for meta in soup.select('meta[property="og:image:type"]'): meta['content']='image/svg+xml'
    for meta in soup.select('meta[property="og:image:width"],meta[property="og:image:height"]'): meta['content']='64'
    (PAGES / (page + '.html')).write_text(str(soup))

shutil.copytree(ROOT/'static',PUBLIC/'static',dirs_exist_ok=True)
# The legacy tree contains an HTML download-error page with a .ttf suffix.
for font in (PUBLIC/'static/fonts').glob('*'):
    if font.suffix.lower() in ('.ttf','.otf','.woff','.woff2') and font.read_bytes().lstrip().lower().startswith((b'<!doctype',b'<html')):
        font.unlink()

# The home layout, gradients, cards, typography and wheel renderer come from main.py.
home = parse('home')
home.select_one('#hudNumber').string='--%'
home.select_one('#hudLabel').string='GROK GUESS'
home.select_one('#hudNote').string='Grok is composing context…'
home.select_one('#confidencePill').string='Conf: --%'
home.select_one('#btnRefresh').string='Refresh'
home.select_one('#confidencePill').insert_after(fragment('<span id="homeModel" class="pill ml-2">Grok</span>'))
home.select_one('#reasonsList').clear()
home.select_one('#reasonsList').append(fragment('<li>Grok is composing the simulated scene…</li>'))
home.select_one('#reasonsList').parent.append(fragment('<p class="meta mt-3">Grok guess mode is a simulation, not live sensing or a measured accident probability. Confidence describes model consistency, not verified accuracy. Every refresh calls Grok directly without a cached result.</p>'))
save('home',home,'home.mjs',extra_css='''
[hidden]{display:none!important}
/* Keep the square inside its Bootstrap column, including narrow phones. */
.hero .row > div, .wheel-wrap > div { min-width:0; }
.wheel-panel { width:100%; min-width:0; min-height:0; aspect-ratio:1; }
canvas#wheelCanvas { position:absolute; inset:0; width:100%; height:100%; }
.hud-center .text-center { width:78%; }
.hud-note { margin-inline:auto; font-size:clamp(.7rem, 1.2vw, .95rem); overflow-wrap:anywhere; }
.hud-label { font-size:clamp(.6rem, 1vw, .8rem); }
@media(max-width:575px) { .hud-number { font-size:2rem; } .wheel-hud { inset:8px; } }
''')
source = template('home')
script = next(s for s in re.findall(r'<script(?:\s[^>]*)?>([\s\S]*?)</script>',source) if 'const homeUi =' in s)
script = ENV.from_string(script).render(home_text=HOME_TEXT)
script = re.sub(r'\(async function themeSync\(\)\{[\s\S]*?\}\)\(\);','',script,count=1)
script = script[:script.index('  const wheel = new RiskWheel')]
(PAGES/'wheel-base.mjs').write_text('\n'.join(line.rstrip() for line in script.splitlines()).rstrip() + '\nexport {RiskWheel,breath,current};\n')

for page in ('login','register'):
    form=AuthForm();form.username.name='email'
    form.submit.label.text='Create account' if page=='register' else 'Login'
    if page=='register': form.password.render_kw['autocomplete']='new-password'
    soup=parse(page,form=form,error_message='',passkey_csrf='',registration_enabled=True)
    for element in soup.select('.auth-divider,#passkeyLoginButton,#passkeyStatus'):
        element.decompose()
    form_tag=soup.select_one('form');form_tag['id']='authForm';form_tag['data-mode']=page;form_tag['novalidate']=''
    form_tag.select_one('input[name=email]')['placeholder']='you@example.com'
    error=soup.new_tag('p',id='authError',attrs={'class':'error-message text-center','role':'alert','aria-live':'polite','hidden':True})
    form_tag.insert_before(error)
    if page=='register':
        for element in soup.select('#rule-upper,#rule-lower,#rule-digit,#rule-special'):element.decompose()
        soup.select_one('#rule-len span:last-child').string='At least 12 characters'
    save(page,soup,'auth.mjs')

dashboard=parse('dashboard',username='Your account',reports=[],preferred_model='llama_local',preferred_language='en',
    supported_languages={'en':{'name':'English','native':'English'}},grok_ready=False,llama_ready=True,csrf_token='')
for element in dashboard.select('option[value=openai]'): element.decompose()
dashboard.select_one('.hero-meta .status-pill')['id']='accountName'
dashboard.select('.hero-meta .status-pill')[1]['id']='selectedModelName'
credit=fragment('<span class="metric-pill" id="creditBalance">Loading credits…</span>').span
dashboard.select_one('.hero-meta').append(credit)
status=fragment('<p id="pageStatus" class="status-message" role="status" aria-live="polite"></p>').p
dashboard.select_one('.dashboard-shell').insert(1,status)
for name,low,high in [('latitude',-90,90),('longitude',-180,180)]:
    field=dashboard.select_one('#'+name);field['type']='number';field['min']=str(low);field['max']=str(high);field['step']='any'
map_tag=fragment('<div id="locationMap" class="qrs-location-map" aria-label="Choose a location"></div>').div
dashboard.select_one('#grabCoordinatesForm .field-grid').insert_after(map_tag)
dashboard.head.append(dashboard.new_tag('link',rel='stylesheet',href='/leaflet.css'))
dashboard.body.append(dashboard.new_tag('script',src='/leaflet.js',defer=True))
step2=dashboard.select_one('#step2')
step2.select_one('.section-head p').string='Confirm the selected location and add street context from your own observations.'
step2.select_one('.street-label').string='Selected coordinates'
step2.select_one('#streetName').string='Waiting for coordinates…'
step2.select_one('.street-card').insert_after(fragment('<div class="form-group mt-3"><label for="streetContext">Nearby street or route context (optional)</label><input id="streetContext" class="form-control" maxlength="256" placeholder="Street or nearby landmark"></div>'))
details=fragment('''<div class="field-grid"><div class="form-group"><label for="weather">Weather observations</label><input id="weather" class="form-control" maxlength="96" placeholder="Rain, fog, clear…"></div><div class="form-group"><label for="traffic">Traffic observations</label><input id="traffic" class="form-control" maxlength="96" placeholder="Slow, heavy, light…"></div><div class="form-group"><label for="road_type">Road type</label><input id="road_type" class="form-control" maxlength="96" placeholder="City street, highway, unpaved…"></div><div class="form-group"><label for="obstacles">Obstacles</label><textarea id="obstacles" class="form-control" maxlength="512" placeholder="Describe observed hazards"></textarea></div></div><div class="form-group"><label for="sensor_notes">Sensor notes</label><textarea id="sensor_notes" class="form-control" maxlength="1000" placeholder="Additional observations and their source"></textarea></div><p class="status-message">Experimental assessment from supplied observations. Follow physical signs, signals, and actual road conditions.</p>''')
dashboard.select_one('#runScanForm .action-row').insert_before(details)
dashboard.select_one('#reportsSection .empty-state')['id']='emptyReports'
dashboard.select_one('#reportsSection').append(fragment('<div id="reportTable" class="table-wrap" hidden><table class="table table-dark table-hover"><thead><tr><th>Date</th><th class="text-right">Actions</th></tr></thead><tbody id="reportRows"></tbody></table></div>'))
dashboard.select_one('.modal-header').insert(0,fragment('<h2 class="h5" id="reportModalLabel">Scan report</h2>'))
for link in dashboard.select('a[href="/dashboard#locationMap"]'): link.clear(); link.append('Map & radar')
dashboard.select_one('#locationMap').insert_after(fragment('<div class="radar-controls"><label><input id="radarToggle" type="checkbox" checked> Show RainViewer radar</label><div id="radarTimeline"><label for="radarFrame">RainViewer precipitation frame</label><input id="radarFrame" type="range" min="0" max="0" value="0"><p id="radarStatus" role="status" aria-live="polite"></p></div><p class="small text-muted mb-0">Radar from RainViewer. Coverage varies; precipitation imagery does not measure road hazards.</p></div>'))
save('dashboard',dashboard,'dashboard.mjs','\n.radar-controls{padding:12px 0}.radar-controls input[type=range]{width:100%}.radar-controls label{display:block}\n.qrs-location-map{height:320px;border-radius:14px;margin:16px 0;border:1px solid var(--line)}\n[hidden]{display:none!important}\n')

# Single-page visual route workspace; account navigation remains shared.
planner=BeautifulSoup((ROOT/'cloudflare/frontend/planner.html').read_text(),'html.parser')
save('dashboard',planner,'planner.mjs')
planner_page=PAGES/'dashboard.html'
planner_page.write_text(planner_page.read_text().replace('/pages/dashboard.css','/pages/planner.css'))

blog=parse('blog_index')
save('blog',blog,'navigation.mjs')
radar=BeautifulSoup(template('radar_page'),'html.parser')
save('radar',radar,'radar.mjs')
(PAGES/'radar.mjs').write_text("import './navigation.mjs';\n"+(ROOT/'static/js/radar.js').read_text())
docs=parse('home');docs.title.string='Scan API - QRS'
docs.select_one('main').clear()
docs.select_one('main').append(fragment((ROOT/'cloudflare/frontend/docs-content.html').read_text()))
save('docs',docs,'navigation.mjs')

# Account controls reuse the original settings layout and exact CSS tokens.
settings_source=template('user_settings')
settings_css='\n'.join(re.findall(r'<style>([\s\S]*?)</style>',settings_source))
settings=BeautifulSoup('''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>User Settings - QRS</title><link rel="stylesheet" href="/static/css/roboto.css"><link rel="stylesheet" href="/static/css/orbitron.css"><link rel="stylesheet" href="/static/css/bootstrap.min.css"><link rel="stylesheet" href="/static/css/fontawesome.min.css"></head><body><div class="sidebar"><div class="navbar-brand">QRS</div><a href="/home">Home</a><a href="/dashboard">Dashboard</a><a href="/settings/user" class="active">User Settings</a><a href="/dashboard#locationMap">Map &amp; radar</a><form data-action="logout" class="qrs-logout-form"><button class="qrs-logout-button" type="submit">Logout</button></form></div><main class="content"><div class="settings-shell"><section class="settings-hero"><h2>User Settings</h2><p>Manage your account, password, and API access.</p><p id="accountSummary"></p></section><p id="settingsMessage" role="status" aria-live="polite"></p><section class="settings-card"><h3>Change password</h3><form id="passwordForm"><div class="form-group"><label for="currentPassword">Current password</label><input id="currentPassword" name="current_password" type="password" class="form-control" autocomplete="current-password" required></div><div class="form-group"><label for="newPassword">New password</label><input id="newPassword" name="new_password" type="password" class="form-control" autocomplete="new-password" minlength="12" maxlength="256" required></div><button class="btn btn-primary" type="submit">Update password and sign out</button></form></section><section class="settings-card"><h3>API access</h3><p>Create a key to integrate scans with your own app. Keep it private; it is shown once.</p><button id="createKey" class="btn btn-primary" type="button">Create API key</button><div class="form-group mt-3"><label for="apiKey">New API key</label><input id="apiKey" class="form-control" type="password" autocomplete="off" readonly></div><button id="copyKey" class="btn btn-outline-light" type="button">Copy key</button><div id="keysList" class="mt-3"></div></section><section class="settings-card"><h3>Plan and credits</h3><p id="planDetails"></p><p>Purchases are currently unavailable. Reports use one credit per successful scan.</p></section></div></main></body></html>''','html.parser')
style=settings.new_tag('style');style.string=settings_css;settings.head.append(style)
settings.select_one('#copyKey')['disabled']=True
settings.select_one('#copyKey').insert_after(fragment('<button id="showKey" class="btn btn-outline-light ml-2" type="button" disabled>Show key</button>'))
settings.select_one('#planDetails')['aria-live']='polite'
save('settings',settings,'settings.mjs','''
[hidden]{display:none!important}
#settingsMessage{position:sticky;top:12px;z-index:10;border-radius:12px;background:#111827;padding:12px;color:var(--accent2);}
#settingsMessage:empty{display:none}
#keysList:empty::before{content:"No active API keys.";color:var(--muted)}
#apiKey{font-family:monospace}
@media(max-width:768px){.sidebar{position:static;width:auto;display:flex;flex-wrap:wrap;gap:6px;padding:12px}.sidebar .navbar-brand{margin:0 8px 0 0}.sidebar a{padding:0 10px;margin:0}.content{margin-left:0;padding:16px}.settings-card,.settings-hero{padding:18px}.settings-shell{min-width:0}#accountSummary{overflow-wrap:anywhere}}
''')

manifest={'name':'QRoadScan.com','short_name':'QRS','start_url':'/home','display':'standalone','theme_color':'#0b0f17','background_color':'#0b0f17','icons':[{'src':'/favicon.svg','sizes':'any','type':'image/svg+xml'}]}
(PUBLIC/'site.webmanifest').write_text(json.dumps(manifest))
print('Generated QRS pages and single-page visual route planner.')
