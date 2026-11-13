// An unprotected first-party landing establishes same-site navigation before
// loading the protected settings page. Keep session cookies SameSite=Strict.
const status=new URLSearchParams(location.search).get('status');
location.replace('/settings/user'+(status==='success'?'?billing=success':status==='cancelled'?'?billing=cancelled':'')+'#billing');
