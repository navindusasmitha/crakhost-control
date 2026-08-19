import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {getCurrentUser,isStaff,isAdmin} from '@/lib/auth';
import {nodeFetchFor} from '@/lib/node';
import {audit} from '@/lib/audit';

export async function GET(){
  const user=await getCurrentUser(); if(!isStaff(user)) return NextResponse.json({error:'Forbidden'},{status:403});
  const started=Date.now(); await db.query('select 1'); const databaseMs=Date.now()-started;
  const {rows:nodes}=await db.query(`select id,name,location,base_url,api_token,enabled,last_seen_at,agent_version from nodes order by name`);
  const checks:any[]=[];
  for(const n of nodes){
    const t=Date.now();
    try{
      const d=await nodeFetchFor(n,'/diagnostics'); const latency=Date.now()-t;
      checks.push({id:n.id,name:n.name,location:n.location,enabled:n.enabled,status:'online',latencyMs:latency,...d});
      await db.query(`insert into node_health_snapshots(node_id,status,latency_ms,docker_version,managed_containers,running_containers,disk_free_bytes,detail) values($1,'online',$2,$3,$4,$5,$6,$7)`,[n.id,latency,String(d.dockerVersion||''),Number(d.managedContainers)||0,Number(d.runningContainers)||0,d.diskFreeBytes?Number(d.diskFreeBytes):null,JSON.stringify(d)]);
      await db.query(`update nodes set last_seen_at=now(),agent_version=$2 where id=$1`,[n.id,String(d.version||n.agent_version||'')]);
    }catch(e:any){
      checks.push({id:n.id,name:n.name,location:n.location,enabled:n.enabled,status:'offline',latencyMs:Date.now()-t,error:e.message||'Node unavailable'});
      await db.query(`insert into node_health_snapshots(node_id,status,latency_ms,detail) values($1,'offline',$2,$3)`,[n.id,Date.now()-t,JSON.stringify({error:e.message||'Node unavailable'})]);
    }
  }
  const {rows:s}=await db.query(`select value from system_settings where key='operations'`);
  const {rows:counts}=await db.query(`select (select count(*) from users) users,(select count(*) from servers) servers,(select count(*) from servers where status='running') running,(select count(*) from support_tickets where status<>'CLOSED') open_tickets,(select count(*) from orders where status='FAILED') failed_orders`);
  return NextResponse.json({panel:{status:'online',version:'0.11.0',uptimeSeconds:Math.floor(process.uptime()),databaseMs},nodes:checks,settings:s[0]?.value||{},counts:counts[0]||{}});
}
export async function PATCH(req:NextRequest){
  const user=await getCurrentUser(); if(!isAdmin(user)) return NextResponse.json({error:'Admin required'},{status:403});
  const body=await req.json(); const maintenanceMode=!!body.maintenanceMode; const maintenanceMessage=String(body.maintenanceMessage||'Scheduled maintenance in progress.').slice(0,240);
  const value={maintenanceMode,maintenanceMessage,healthRetentionDays:Math.min(90,Math.max(1,Number(body.healthRetentionDays)||14))};
  await db.query(`insert into system_settings(key,value,updated_by,updated_at) values('operations',$1,$2,now()) on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`,[JSON.stringify(value),user.id]);
  await audit(user.id,'operations.settings.update','system','operations',value);
  return NextResponse.json({ok:true,settings:value});
}
