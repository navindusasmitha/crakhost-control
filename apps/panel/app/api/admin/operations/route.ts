import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {getCurrentUser,isStaff,isAdmin} from '@/lib/auth';
import {nodeFetchFor} from '@/lib/node';
import {audit} from '@/lib/audit';

export const dynamic='force-dynamic';
export async function GET(){
  const user=await getCurrentUser(); if(!isStaff(user)) return NextResponse.json({error:'Forbidden'},{status:403});
  let databaseMs:number|null=null,databaseStatus='online';try{const started=Date.now();await db.query('select 1');databaseMs=Date.now()-started}catch{databaseStatus='offline'}
  const {rows:nodes}=await db.query(`select id,name,location,base_url,api_token,enabled,last_seen_at,agent_version from nodes order by name`);
  const checks:any[]=[];
  for(const n of nodes){
    const t=Date.now();
    if(!n.enabled){checks.push({id:n.id,name:n.name,location:n.location,enabled:false,status:'disabled',latencyMs:null});continue}
    try{
      const d=await nodeFetchFor(n,'/diagnostics'); const latency=Date.now()-t;
      checks.push({id:n.id,name:n.name,location:n.location,enabled:true,status:'online',latencyMs:latency,version:d.version||n.agent_version||'',dockerVersion:d.dockerVersion||'',managedContainers:Number(d.managedContainers)||0,runningContainers:Number(d.runningContainers)||0,diskFreeBytes:d.diskFreeBytes?Number(d.diskFreeBytes):null});
      await db.query(`insert into node_health_snapshots(node_id,status,latency_ms,docker_version,managed_containers,running_containers,disk_free_bytes,detail) values($1,'online',$2,$3,$4,$5,$6,$7)`,[n.id,latency,String(d.dockerVersion||''),Number(d.managedContainers)||0,Number(d.runningContainers)||0,d.diskFreeBytes?Number(d.diskFreeBytes):null,JSON.stringify(d)]).catch(()=>null);
      await db.query(`update nodes set last_seen_at=now(),agent_version=$2 where id=$1`,[n.id,String(d.version||n.agent_version||'')]).catch(()=>null);
    }catch(e:any){
      const latency=Date.now()-t;checks.push({id:n.id,name:n.name,location:n.location,enabled:true,status:'offline',latencyMs:latency,error:String(e?.message||'Node unavailable').slice(0,180)});
      await db.query(`insert into node_health_snapshots(node_id,status,latency_ms,detail) values($1,'offline',$2,$3)`,[n.id,latency,JSON.stringify({error:String(e?.message||'Node unavailable').slice(0,180)})]).catch(()=>null);
    }
  }
  const {rows:s}=await db.query(`select value from system_settings where key='operations'`);
  const {rows:counts}=await db.query(`select (select count(*) from users) users,(select count(*) from servers) servers,(select count(*) from servers where status='running') running,(select count(*) from support_tickets where status<>'CLOSED') open_tickets,(select count(*) from orders where status='FAILED') failed_orders`);
  return NextResponse.json({panel:{status:'online',version:process.env.npm_package_version||'unknown',uptimeSeconds:Math.floor(process.uptime()),databaseStatus,databaseMs},nodes:checks,settings:s[0]?.value||{},counts:counts[0]||{}},{headers:{'cache-control':'no-store'}});
}
export async function PATCH(req:NextRequest){
  const user=await getCurrentUser(); if(!isAdmin(user)) return NextResponse.json({error:'Admin required'},{status:403});
  const body=await req.json().catch(()=>({})); const maintenanceMode=body.maintenanceMode===true; const maintenanceMessage=String(body.maintenanceMessage||'Scheduled maintenance in progress.').trim().slice(0,240)||'Scheduled maintenance in progress.';
  const retention=Number(body.healthRetentionDays);const value={maintenanceMode,maintenanceMessage,healthRetentionDays:Number.isFinite(retention)?Math.min(90,Math.max(1,Math.trunc(retention))):14};
  await db.query(`insert into system_settings(key,value,updated_by,updated_at) values('operations',$1,$2,now()) on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`,[JSON.stringify(value),user.id]);
  await audit(user.id,'operations.settings.update','system','operations',value);
  return NextResponse.json({ok:true,settings:value},{headers:{'cache-control':'no-store'}});
}
