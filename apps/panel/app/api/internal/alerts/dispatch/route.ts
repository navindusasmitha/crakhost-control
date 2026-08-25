import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {evaluateAlerts} from '@/lib/alert-evaluator';
import {sendDirectEmail} from '@/lib/mail';

export const dynamic='force-dynamic';
export const runtime='nodejs';
function authorized(req:Request){const expected=process.env.CRAKHOST_CRON_SECRET||'';const got=req.headers.get('x-crakhost-cron-secret')||'';return !!expected&&got===expected}
function esc(v:any){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c))}

export async function POST(req:Request){
  if(!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
  const {alerts,settings,maintenanceMode}=await evaluateAlerts(true);
  const stateQ=await db.query(`select value from system_settings where key='alert_dispatch_state'`);const previous=stateQ.rows[0]?.value||{};const prevActive=previous?.active&&typeof previous.active==='object'?previous.active:{};const now=Date.now();const repeatMs=settings.repeatHours*3600000;
  const allCurrent:Record<string,any>={};for(const a of alerts)allCurrent[a.key]={title:a.title,severity:a.severity,category:a.category,lastSeen:new Date().toISOString(),lastSent:prevActive[a.key]?.lastSent||null};
  const visible=settings.suppressDuringMaintenance&&maintenanceMode?alerts.filter(a=>a.category==='maintenance'):alerts;
  const eligible=visible.filter(a=>a.severity!=='info'&&(!settings.criticalOnly||a.severity==='critical'));
  const toSend=eligible.filter(a=>{const last=prevActive[a.key]?.lastSent?new Date(prevActive[a.key].lastSent).getTime():0;return !last||now-last>=repeatMs});
  const resolved=Object.keys(prevActive).filter(k=>!allCurrent[k]).map(k=>prevActive[k]).filter(Boolean);
  let recipients=settings.recipients;
  if(!recipients.length){const q=await db.query(`select email from users where role='ADMIN' and banned_at is null order by created_at limit 12`);recipients=q.rows.map((r:any)=>String(r.email||'').trim()).filter(Boolean)}
  const deliveries:any[]=[];
  if(settings.emailEnabled&&recipients.length&&toSend.length){const rows=toSend.map(a=>`<div style="padding:12px 0;border-bottom:1px solid #293044"><b style="color:${a.severity==='critical'?'#fb7185':'#fbbf24'}">${esc(a.severity.toUpperCase())}</b> · <b>${esc(a.title)}</b><div style="color:#9aa3b7">${esc(a.detail)}</div></div>`).join('');const subject=`[CrakHost] ${toSend.length} active production alert${toSend.length===1?'':'s'}`;const text=toSend.map(a=>`${a.severity.toUpperCase()}: ${a.title} - ${a.detail}`).join('\n');for(const recipient of recipients){try{deliveries.push({recipient,...await sendDirectEmail(recipient,subject,`<h2>Production alerts</h2>${rows}<p><a href="${esc((process.env.APP_URL||'').replace(/\/$/,'')+'/alerts')}">Open Alert Center</a></p>`,text)})}catch(e:any){deliveries.push({recipient,sent:false,error:String(e?.message||e)})}}const sentAt=new Date().toISOString();for(const a of toSend)if(allCurrent[a.key])allCurrent[a.key].lastSent=sentAt}
  if(settings.emailEnabled&&settings.sendResolved&&recipients.length&&resolved.length){const subject=`[CrakHost] ${resolved.length} alert${resolved.length===1?'':'s'} resolved`;const text=resolved.map((x:any)=>`RESOLVED: ${x.title||'Production alert'}`).join('\n');const html=`<h2>Production conditions recovered</h2>${resolved.map((x:any)=>`<div style="padding:8px 0"><b>${esc(x.title||'Production alert')}</b> is no longer active.</div>`).join('')}`;for(const recipient of recipients){try{deliveries.push({recipient,resolved:true,...await sendDirectEmail(recipient,subject,html,text)})}catch(e:any){deliveries.push({recipient,resolved:true,sent:false,error:String(e?.message||e)})}}}
  await db.query(`insert into system_settings(key,value,updated_by,updated_at) values('alert_dispatch_state',$1,(select id from users where role='ADMIN' order by created_at limit 1),now()) on conflict(key) do update set value=excluded.value,updated_at=now()`,[JSON.stringify({active:allCurrent,lastRun:new Date().toISOString()})]);
  return NextResponse.json({ok:true,active:alerts.length,eligible:eligible.length,notified:toSend.length,resolved:resolved.length,recipients:recipients.length,deliveries},{headers:{'cache-control':'no-store'}});
}
