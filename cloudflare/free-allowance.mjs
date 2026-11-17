export async function freeAllowance(env,user){
 const row=await env.DB.prepare(`SELECT p.*,strftime('%Y-%m-%d','now') AS day,
 (SELECT count(*) FROM free_scan_usage WHERE user_id=? AND channel='web' AND day=strftime('%Y-%m-%d','now')) AS web_used,
 (SELECT count(*) FROM free_scan_usage WHERE user_id=? AND channel='api') AS api_used,
 (SELECT count(*) FROM free_scan_usage WHERE day=strftime('%Y-%m-%d','now')) AS daily_used,
 (SELECT count(*) FROM free_scan_usage WHERE month=strftime('%Y-%m','now')) AS monthly_used FROM free_scan_policy p WHERE id=1`).bind(user,user).first();
 const available=row?.enabled===1,shared=available?Math.max(0,Math.min(row.global_daily-row.daily_used,row.global_monthly-row.monthly_used)):0;
 return {enabled:available,day:row?.day??null,reset_timezone:'UTC',browser_daily_limit:row?.web_daily??0,browser_remaining:available?Math.max(0,Math.min(row.web_daily-row.web_used,shared)):0,api_trial_limit:row?.api_lifetime??0,api_trial_remaining:available?Math.max(0,Math.min(row.api_lifetime-row.api_used,shared)):0,shared_daily_limit:row?.global_daily??0,shared_monthly_limit:row?.global_monthly??0,shared_remaining:shared,failed_attempts_count:true};
}
