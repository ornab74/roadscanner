import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures/account-worker.mjs';
import {validateSettings,SETTING_SCHEMA} from '../cloudflare/admin-content.mjs';
const origin='https://example.test';
async function client(f,email='owner@example.test'){
 const t=await f.request('/api/home/csrf'),token=await t.json(),cookie=t.headers.get('Set-Cookie').split(';')[0];
 const h={Origin:origin,'Content-Type':'application/json','X-CSRF-Token':token.csrf_token,Cookie:cookie};
 const login=await f.request('/auth/login',{method:'POST',headers:h,body:JSON.stringify({email,password:'test-password-1234'})});assert.equal(login.status,200);h.Cookie+='; '+login.headers.get('Set-Cookie').split(';')[0];
 const request=(path,method='GET',body,extra={})=>f.request(path,{method,headers:{...h,...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 return {request,elevate:()=>request('/api/security/reauth','POST',{password:'test-password-1234'})};
}
const post={title:'A route update',slug:'a-route-update',excerpt:'A short description',body:'First paragraph.\nA second line.\n\nAnother paragraph.',status:'draft'};
test('blog and settings management require an elevated admin cookie session and CSRF',async()=>{
 const f=await fixture();try{
  const c=await client(f);assert.equal((await c.request('/api/admin/posts')).status,403);await f.DB.prepare("INSERT INTO user_roles VALUES ('owner','admin',1)").run();
  assert.equal((await c.request('/api/admin/posts')).status,403);assert.equal((await c.request('/api/admin/settings')).status,403);await c.elevate();
  assert.equal((await c.request('/api/admin/posts')).status,200);assert.equal((await c.request('/api/admin/posts','POST',post,{'X-CSRF-Token':''})).status,403);
  assert.equal((await f.request('/api/admin/posts',{headers:{Authorization:'Bearer '+f.key}})).status,401);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM blog_posts').first()).n,0);
 }finally{f.close();}
});
test('drafts stay private; publishing, conflict checks, unpublishing and archiving are audited',async()=>{
 const f=await fixture();try{await f.DB.prepare("INSERT INTO user_roles VALUES ('owner','admin',1)").run();const c=await client(f);await c.elevate();
  const created=await c.request('/api/admin/posts','POST',post);assert.equal(created.status,201);const p=await created.json();
  assert.equal((await f.request('/blog/'+post.slug)).status,404);assert.ok(!(await(await f.request('/blog')).text()).includes(post.title));
  const other=await client(f,'other@example.test');assert.equal((await other.request('/api/admin/posts/'+p.id)).status,403);
  const published=await c.request('/api/admin/posts/'+p.id,'PUT',{...post,status:'published',version:1});assert.equal(published.status,200);const pub=await published.json();
  const listing=await f.request('/blog');assert.equal(listing.status,200);assert.match(listing.headers.get('Cache-Control'),/no-store/);assert.match(await listing.text(),/a-route-update/);
  const article=await f.request('/blog/'+post.slug),html=await article.text();assert.equal(article.status,200);assert.ok(html.includes('<p>First paragraph.<br>A second line.</p><p>Another paragraph.</p>'));assert.match(html,/integrity="sha384-/);
  assert.equal((await c.request('/api/admin/posts/'+p.id,'PUT',{...post,status:'published',version:1})).status,409);
  assert.equal((await c.request('/api/admin/posts','POST',post)).status,409);
  const draft=await c.request('/api/admin/posts/'+p.id,'PUT',{...post,version:pub.version});assert.equal(draft.status,200);assert.equal((await f.request('/blog/'+post.slug)).status,404);
  const archive=await c.request('/api/admin/posts/'+p.id,'PUT',{...post,status:'archived',version:(await draft.json()).version});assert.equal(archive.status,200);assert.equal((await f.request('/blog/'+post.slug)).status,404);
  const audit=(await f.DB.prepare("SELECT action FROM security_audit WHERE target_id=?").bind(p.id).all()).results.map(r=>r.action);assert.ok(audit.includes('blog.created'));assert.ok(audit.includes('blog.published'));assert.ok(audit.includes('blog.unpublished'));
 }finally{f.close();}
});
test('public rendering treats titles, descriptions and post bodies as untrusted text',async()=>{
 const f=await fixture();try{await f.DB.prepare("INSERT INTO user_roles VALUES ('owner','admin',1)").run();const c=await client(f);await c.elevate();const evil={...post,title:'<script>alert(1)</script>',excerpt:'" onload="alert(2)',body:'<img src=x onerror=alert(3)>\n\n<script>alert(4)</script>',status:'published'};
  assert.equal((await c.request('/api/admin/posts','POST',evil)).status,201);const html=await(await f.request('/blog/'+post.slug)).text();assert.ok(!html.includes('<img src=x'));assert.ok(!html.includes('<script>alert'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&quot; onload=&quot;'));
  assert.equal((await c.request('/api/admin/posts','POST',{...post,slug:'../admin'})).status,400);
 }finally{f.close();}
});
test('settings are bounded, versioned, audited and cannot override payment or secret controls',async()=>{
 assert.ok(Object.keys(SETTING_SCHEMA).length>=20);
 for(const bad of [{STRIPE_ENABLED:true},{OPENAI_API_KEY:'private'},{support_url:'javascript:alert(1)'},{support_url:'https://user:secret@example.test'},{route_user_hour:7},{route_model:'https://attacker.test/model'},{registration_enabled:'true'}])assert.throws(()=>validateSettings(bad));
 const f=await fixture();try{await f.DB.prepare("INSERT INTO user_roles VALUES ('owner','admin',1)").run();const c=await client(f);await c.elevate();const initial=await(await c.request('/api/admin/settings')).json();
  const settings={...initial.settings,registration_enabled:false,pause_new_work:true,announcement:'Maintenance update',route_user_hour:2};
  const saved=await c.request('/api/admin/settings','PUT',{version:initial.version,settings,reason:'Pause analyses during scheduled maintenance'});assert.equal(saved.status,200);
  assert.equal((await c.request('/api/admin/settings','PUT',{version:initial.version,settings,reason:'A stale tab must not overwrite settings'})).status,409);
  assert.equal((await(await f.request('/api/config')).json()).registration_enabled,false);assert.equal((await(await f.request('/api/site')).json()).announcement,'Maintenance update');
  const paused=await c.request('/api/session/scans','POST',{}, {'Idempotency-Key':'settings-paused-fixture-1234'});assert.equal(paused.status,503);assert.equal((await paused.json()).error,'new_work_paused');assert.equal(f.calls(),0);
  assert.equal((await c.request('/api/session')).status,200);assert.equal((await c.request('/api/admin/settings')).status,200);assert.equal((await(await f.request('/api/config')).json()).payments_enabled,false);
  assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM security_audit WHERE action='admin.settings_updated'").first()).n,1);
  const current=await(await c.request('/api/admin/settings')).json();assert.equal((await c.request('/api/admin/settings','PUT',{version:current.version,settings:initial.settings,reason:'Restore initial configuration after maintenance'})).status,200);
  assert.equal((await(await f.request('/api/config')).json()).registration_enabled,true);
 }finally{f.close();}
});
test('feature switches stop provider work without changing account or report access',async()=>{
 const f=await fixture();try{await f.DB.prepare("INSERT INTO user_roles VALUES ('owner','admin',1)").run();const c=await client(f);await c.elevate();const initial=await(await c.request('/api/admin/settings')).json();
  const settings={...initial.settings,routes_enabled:false,voice_enabled:false,images_enabled:false,aviation_ai_enabled:false,public_preview_enabled:false,blog_enabled:false};
  assert.equal((await c.request('/api/admin/settings','PUT',{version:initial.version,settings,reason:'Disable selected optional surfaces for verification'})).status,200);
  for(const path of ['/api/route/analyze','/api/route/atlas','/api/route/voice','/api/home/preview','/api/aviation/briefing','/api/garage/vehicles/11111111-1111-4111-8111-111111111111/image']){const r=await c.request(path,'POST',{});assert.equal(r.status,503,path);assert.equal((await r.json()).error,'feature_disabled');}
  assert.equal((await f.request('/blog')).status,503);assert.equal((await c.request('/api/admin/posts')).status,200);assert.equal((await c.request('/api/session')).status,200);assert.equal(f.calls(),0);
 }finally{f.close();}
});
test('blog formatting supports useful Markdown while keeping HTML and unsafe links inert',async()=>{
 const {renderBlogBody}=await import('../cloudflare/public/pages/blog-format.mjs');const out=renderBlogBody('## Title\n\n**Bold** and *emphasis* with `code`\n\n- One\n- Two\n\n```js\n<script>alert(1)</script>\n```\n\n[Docs](https://ride.qroadscan.com/docs)\n\n[x](javascript:alert(1))');
 assert.ok(out.includes('<h3>Title</h3>'));assert.ok(out.includes('<strong>Bold</strong>'));assert.ok(out.includes('<ul><li>One</li><li>Two</li></ul>'));assert.ok(out.includes('&lt;script&gt;'));assert.ok(!out.includes('<script>'));assert.ok(!out.includes('href="javascript:'));assert.ok(out.includes('rel="noopener noreferrer"'));assert.equal(renderBlogBody('['.repeat(30000)),'<p>'+'['.repeat(30000)+'</p>');assert.equal(renderBlogBody('[x]('.repeat(5000)),'<p>'+'[x]('.repeat(5000)+'</p>');
});
test('admin writes recheck elevation and role at the database write boundary',async()=>{
 for(const mode of ['new','edit','settings']){const f=await fixture();try{
  await f.DB.prepare("INSERT INTO user_roles VALUES ('owner','admin',1)").run();const c=await client(f);await c.elevate();let existing;
  if(mode==='edit')existing=await(await c.request('/api/admin/posts','POST',post)).json();
  const original=f.DB.prepare.bind(f.DB);let injected=false;
  f.DB.prepare=sql=>{const s=original(sql),target=mode==='new'?sql.startsWith('INSERT INTO blog_posts('):mode==='edit'?sql.startsWith('UPDATE blog_posts SET'):sql.startsWith('UPDATE site_settings SET');if(target){const first=s.first;s.first=async function(){injected=true;await original(mode==='edit'?"DELETE FROM user_roles WHERE user_id='owner'":"UPDATE sessions SET elevated_until=0 WHERE user_id='owner'").run();return first.call(this);};}return s;};
  const response=mode==='settings'?await c.request('/api/admin/settings','PUT',{version:1,settings:{announcement:'Must not save'},reason:'Verify write boundary checks'}):mode==='new'?await c.request('/api/admin/posts','POST',post):await c.request('/api/admin/posts/'+existing.id,'PUT',{...post,title:'Must not overwrite',version:1});
  assert.equal(injected,true);assert.equal(response.status,403);assert.equal((await original('SELECT version FROM site_settings WHERE id=1').first()).version,1);
  const rows=(await original('SELECT title FROM blog_posts').all()).results;assert.equal(rows.length,mode==='edit'?1:0);if(mode==='edit')assert.equal(rows[0].title,post.title);
 }finally{f.close();}}
});
