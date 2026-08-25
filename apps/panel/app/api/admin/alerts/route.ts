import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {getCurrentUser,isStaff,isAdmin} from '@/lib/auth';
import {audit} from '@/lib/audit';
import {updaterAgentRequest} from '@/lib/updater-agent';

export const dynamic='force-dynamic';
export const runtime='nodejs';

const ACK_TTL_HOURS=12;
type Severity='critical'|'warning'|'info';
type AlertItem={key:string;severity:Severity;category:string;title:string;detail:string;createdAt:string;href:string};

function sameOrigin(req:Request){
  const origin=req.headers.get('origin');
  if(!origin)return true;
  try{return new URL(origin).host===req.headers.get('host')}catch{return false}
}
function iso(value:any){const d=new Date(value||Date.now());return Number.isFinite(d.getTime())?d.toISOString():new Date().toISOString()}
function severityRank(value:Severity){return value==='critical'?0:value==='warning'?1:2}
function number(value:any){const n=Number(value);return Number.isFinite(n)?n:0}

export async function GET(){
  const user=await getCurrentUser();
  if(!isStaff(user))return NextResponse.json({error:'Forbidden'},{status:403});

  const [nodesQ,failedQ,stuckQ,ticketsQ,backupsQ,operationsQ,stateQ]=await Promise.all([
    db.query(`select id,name,location,enabled,last_seen_at from nodes where enabled=true order by name`),
    db.query(`select count(*)::int count,max(updated_at) latest from orders where status='FAILED' and updated_at>=now()-interval '24 hours'`),
    db.query(`select count(*)::int count,min(updated_at) oldest from orders where status in ('PAID','PROVISIONING') and updated_at<now()-interval '30 minutes'`),
    db.query(`select count(*)::int count,count(*) filter(where priority='URGENT')::int urgent,max(updated_at) latest from support_tickets where status<>'CLOSED' and priority in ('HIGH','URGENT')`),
    db.query(`select count(*)::int count,max(created_at) latest from backups where status='FAILED' and created_at>=now()-interval '24 hours'`),
    db.query(`select value from system_settings where key='operations'`),
    db.query(`select value from system_settings where key='alert_center'`)
  ]);

  const alerts:AlertItem[]=[];
  const now=Date.now();
  for(const node of nodesQ.rows){
    const last=node.last_seen_at?new Date(node.last_seen_at).getTime():0;
    const age=last?Math.max(0,(now-last)/1000):Number.POSITIVE_INFINITY;
    if(!last||age>180){
      alerts.push({key:`node:${node.id}:offline`,severity:'critical',category:'node',title:`${node.name} is offline`,detail:last?`No heartbeat for ${Math.floor(age/60)} minutes · ${node.location||'Unknown location'}`:`No heartbeat has been recorded · ${node.location||'Unknown location'}`,createdAt:last?iso(node.last_seen_at):new Date().toISOString(),href:'/nodes'});
    }else if(age>90){
      alerts.push({key:`node:${node.id}:degraded`,severity:'warning',category:'node',title:`${node.name} heartbeat is delayed`,detail:`Last heartbeat ${Math.floor(age)} seconds ago · ${node.location||'Unknown location'}`,createdAt:iso(node.last_seen_at),href:'/nodes'});
    }
  }

  const failed=failedQ.rows[0]||{};
  if(number(failed.count)>0)alerts.push({key:'orders:failed24',severity:'critical',category:'provisioning',title:`${number(failed.count)} provisioning failure${number(failed.count)===1?'':'s'} in 24h`,detail:'Failed orders need review before retrying or refunding customer credit.',createdAt:iso(failed.latest),href:'/admin/orders'});

  const stuck=stuckQ.rows[0]||{};
  if(number(stuck.count)>0)alerts.push({key:'orders:stuck',severity:'warning',category:'provisioning',title:`${number(stuck.count)} order${number(stuck.count)===1?'':'s'} stalled in provisioning`,detail:'Paid or provisioning orders have not changed state for more than 30 minutes.',createdAt:iso(stuck.oldest),href:'/admin/orders'});

  const tickets=ticketsQ.rows[0]||{};
  if(number(tickets.count)>0)alerts.push({key:'support:priority',severity:number(tickets.urgent)>0?'critical':'warning',category:'support',title:`${number(tickets.count)} high-priority support ticket${number(tickets.count)===1?'':'s'} open`,detail:number(tickets.urgent)>0?`${number(tickets.urgent)} marked URGENT.`:'HIGH priority tickets are waiting for staff attention.',createdAt:iso(tickets.latest),href:'/support'});

  const backups=backupsQ.rows[0]||{};
  if(number(backups.count)>0)alerts.push({key:'backups:failed24',severity:'warning',category:'backup',title:`${number(backups.count)} backup failure${number(backups.count)===1?'':'s'} in 24h`,detail:'Review failed backup jobs before the next retention window.',createdAt:iso(backups.latest),href:'/backups'});

  const operations=operationsQ.rows[0]?.value||{};
  if(operations?.maintenanceMode===true)alerts.push({key:'maintenance:enabled',severity:'info',category:'maintenance',title:'Maintenance mode is enabled',detail:String(operations.maintenanceMessage||'Scheduled maintenance in progress.').slice(0,240),createdAt:new Date().toISOString(),href:'/operations'});

  if(isAdmin(user)){
    try{
      const result=await updaterAgentRequest('/metrics');
      const host:any=result.data||{};
      const disk=number(host.disk?.percent),memory=number(host.memory?.percent),cpu=number(host.cpu_percent);
      if(disk>=90)alerts.push({key:'host:disk:critical',severity:'critical',category:'host',title:`Root disk is ${disk.toFixed(1)}% used`,detail:'Free storage is critically low. Run safe cleanup or expand the VPS disk.',createdAt:new Date().toISOString(),href:'/deployment'});
      else if(disk>=80)alerts.push({key:'host:disk:warning',severity:'warning',category:'host',title:`Root disk is ${disk.toFixed(1)}% used`,detail:'Disk pressure is elevated. Review Docker cache and backup retention.',createdAt:new Date().toISOString(),href:'/deployment'});
      if(memory>=90)alerts.push({key:'host:memory:critical',severity:'critical',category:'host',title:`Memory usage is ${memory.toFixed(1)}%`,detail:'Host memory pressure is critical and may affect workloads.',createdAt:new Date().toISOString(),href:'/operations'});
      else if(memory>=80)alerts.push({key:'host:memory:warning',severity:'warning',category:'host',title:`Memory usage is ${memory.toFixed(1)}%`,detail:'Host memory pressure is elevated.',createdAt:new Date().toISOString(),href:'/operations'});
      if(cpu>=95)alerts.push({key:'host:cpu:critical',severity:'critical',category:'host',title:`CPU usage is ${cpu.toFixed(1)}%`,detail:'Sustained CPU saturation can delay control-plane and customer workloads.',createdAt:new Date().toISOString(),href:'/operations'});
    }catch(error){
      alerts.push({key:'host:agent:unavailable',severity:'warning',category:'host',title:'Host telemetry agent is unavailable',detail:error instanceof Error?error.message:'The privileged updater agent could not be reached.',createdAt:new Date().toISOString(),href:'/deployment'});
    }
  }

  alerts.sort((a,b)=>severityRank(a.severity)-severityRank(b.severity)||new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  const state=stateQ.rows[0]?.value||{};
  const stored=state?.acknowledged&&typeof state.acknowledged==='object'?state.acknowledged:{};
  const cutoff=Date.now()-ACK_TTL_HOURS*60*60*1000;
  const acknowledged:Record<string,string>={};
  for(const [key,value] of Object.entries(stored)){
    const ts=new Date(String(value)).getTime();
    if(Number.isFinite(ts)&&ts>=cutoff)acknowledged[String(key)]=new Date(ts).toISOString();
  }
  const items=alerts.map(a=>({...a,acknowledgedAt:acknowledged[a.key]||null}));
  const unacked=items.filter(a=>!a.acknowledgedAt);
  return NextResponse.json({
    alerts:items,
    summary:{total:items.length,unacknowledged:unacked.length,critical:unacked.filter(a=>a.severity==='critical').length,warning:unacked.filter(a=>a.severity==='warning').length,info:unacked.filter(a=>a.severity==='info').length,acknowledged:items.length-unacked.length},
    canAcknowledge:isAdmin(user),
    acknowledgementTtlHours:ACK_TTL_HOURS,
    generatedAt:new Date().toISOString()
  },{headers:{'cache-control':'no-store'}});
}

export async function POST(req:Request){
  const user=await getCurrentUser();
  if(!isAdmin(user))return NextResponse.json({error:'Admin required'},{status:403});
  if(!sameOrigin(req))return NextResponse.json({error:'Cross-origin alert action blocked.'},{status:403});
  if(req.headers.get('x-crakhost-action')!=='alert-ack')return NextResponse.json({error:'Missing alert action confirmation.'},{status:400});
  const body=await req.json().catch(()=>({}));
  const action=String(body.action||'');
  const {rows}=await db.query(`select value from system_settings where key='alert_center'`);
  const current=rows[0]?.value||{};
  const acknowledged:Record<string,string>={...(current?.acknowledged&&typeof current.acknowledged==='object'?current.acknowledged:{})};
  const now=new Date().toISOString();
  if(action==='acknowledge'){
    const key=String(body.key||'').trim();
    if(!key||key.length>180)return NextResponse.json({error:'Invalid alert key.'},{status:400});
    acknowledged[key]=now;
  }else if(action==='unacknowledge'){
    const key=String(body.key||'').trim();
    if(!key||key.length>180)return NextResponse.json({error:'Invalid alert key.'},{status:400});
    delete acknowledged[key];
  }else if(action==='acknowledge_all'){
    const keys=Array.isArray(body.keys)?body.keys.map((x:any)=>String(x).trim()).filter((x:string)=>x&&x.length<=180).slice(0,100):[];
    for(const key of keys)acknowledged[key]=now;
  }else{
    return NextResponse.json({error:'Unsupported alert action.'},{status:400});
  }
  const value={acknowledged};
  await db.query(`insert into system_settings(key,value,updated_by,updated_at) values('alert_center',$1,$2,now()) on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`,[JSON.stringify(value),user.id]);
  await audit(user.id,`alerts.${action}`,'system','alert_center',{key:body.key||null,count:Array.isArray(body.keys)?body.keys.length:null});
  return NextResponse.json({ok:true,action},{headers:{'cache-control':'no-store'}});
}
