import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {getCurrentUser,isStaff,isAdmin} from '@/lib/auth';
import {audit} from '@/lib/audit';
import {evaluateAlerts,type Severity} from '@/lib/alert-evaluator';

export const dynamic='force-dynamic';
export const runtime='nodejs';
const ACK_TTL_HOURS=12;
function sameOrigin(req:Request){const origin=req.headers.get('origin');if(!origin)return true;try{return new URL(origin).host===req.headers.get('host')}catch{return false}}
function severityRank(value:Severity){return value==='critical'?0:value==='warning'?1:2}

export async function GET(){
  const user=await getCurrentUser();if(!isStaff(user))return NextResponse.json({error:'Forbidden'},{status:403});
  const [{alerts,settings},stateQ]=await Promise.all([evaluateAlerts(isAdmin(user)),db.query(`select value from system_settings where key='alert_center'`)]);
  alerts.sort((a,b)=>severityRank(a.severity)-severityRank(b.severity)||new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  const state=stateQ.rows[0]?.value||{};const stored=state?.acknowledged&&typeof state.acknowledged==='object'?state.acknowledged:{};const cutoff=Date.now()-ACK_TTL_HOURS*60*60*1000;const acknowledged:Record<string,string>={};
  for(const [key,value] of Object.entries(stored)){const ts=new Date(String(value)).getTime();if(Number.isFinite(ts)&&ts>=cutoff)acknowledged[String(key)]=new Date(ts).toISOString()}
  const items=alerts.map(a=>({...a,acknowledgedAt:acknowledged[a.key]||null}));const unacked=items.filter(a=>!a.acknowledgedAt);
  return NextResponse.json({alerts:items,summary:{total:items.length,unacknowledged:unacked.length,critical:unacked.filter(a=>a.severity==='critical').length,warning:unacked.filter(a=>a.severity==='warning').length,info:unacked.filter(a=>a.severity==='info').length,acknowledged:items.length-unacked.length},canAcknowledge:isAdmin(user),acknowledgementTtlHours:ACK_TTL_HOURS,notificationSettings:isAdmin(user)?settings:undefined,generatedAt:new Date().toISOString()},{headers:{'cache-control':'no-store'}});
}

export async function POST(req:Request){
  const user=await getCurrentUser();if(!isAdmin(user))return NextResponse.json({error:'Admin required'},{status:403});
  if(!sameOrigin(req))return NextResponse.json({error:'Cross-origin alert action blocked.'},{status:403});
  if(req.headers.get('x-crakhost-action')!=='alert-ack')return NextResponse.json({error:'Missing alert action confirmation.'},{status:400});
  const body=await req.json().catch(()=>({}));const action=String(body.action||'');const {rows}=await db.query(`select value from system_settings where key='alert_center'`);const current=rows[0]?.value||{};const acknowledged:Record<string,string>={...(current?.acknowledged&&typeof current.acknowledged==='object'?current.acknowledged:{})};const now=new Date().toISOString();
  if(action==='acknowledge'){const key=String(body.key||'').trim();if(!key||key.length>180)return NextResponse.json({error:'Invalid alert key.'},{status:400});acknowledged[key]=now}
  else if(action==='unacknowledge'){const key=String(body.key||'').trim();if(!key||key.length>180)return NextResponse.json({error:'Invalid alert key.'},{status:400});delete acknowledged[key]}
  else if(action==='acknowledge_all'){const keys=Array.isArray(body.keys)?body.keys.map((x:any)=>String(x).trim()).filter((x:string)=>x&&x.length<=180).slice(0,100):[];for(const key of keys)acknowledged[key]=now}
  else return NextResponse.json({error:'Unsupported alert action.'},{status:400});
  await db.query(`insert into system_settings(key,value,updated_by,updated_at) values('alert_center',$1,$2,now()) on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`,[JSON.stringify({acknowledged}),user.id]);
  await audit(user.id,`alerts.${action}`,'system','alert_center',{key:body.key||null,count:Array.isArray(body.keys)?body.keys.length:null});
  return NextResponse.json({ok:true,action},{headers:{'cache-control':'no-store'}});
}
