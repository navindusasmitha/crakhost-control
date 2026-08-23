import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser,isStaff,isAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
import {nodeFetchFor} from '@/lib/node';
import {checkNodeRuntimeCapacity,nodeDiskPolicy} from '@/lib/node-capacity';
import {audit} from '@/lib/audit';
import {setNodeDrain} from '@/lib/operations-settings';

export const dynamic='force-dynamic';

export async function GET(_:NextRequest,{params}:{params:Promise<{id:string}>}){
  const u=await getCurrentUser();
  if(!isStaff(u))return NextResponse.json({error:'Forbidden'},{status:403});
  const {id}=await params;
  const {rows}=await db.query(`
    select n.id,n.name,n.location,n.base_url,n.enabled,n.capacity_cpu,
      n.capacity_memory_mb,n.capacity_disk_mb,n.last_seen_at,n.agent_version,n.api_token,
      count(s.id) filter(where s.status<>'deleted')::int server_count,
      coalesce(sum(s.memory_mb) filter(where s.status<>'deleted'),0)::int used_memory_mb,
      coalesce(sum(s.disk_mb) filter(where s.status<>'deleted'),0)::int used_disk_mb,
      coalesce(sum(s.cpu_limit) filter(where s.status<>'deleted'),0)::numeric used_cpu
    from nodes n
    left join servers s on s.node_id=n.id
    where n.id=$1
    group by n.id
    limit 1
  `,[id]);
  const n=rows[0];
  if(!n)return NextResponse.json({error:'Node not found'},{status:404});

  let diagnostics:any=null;
  try{
    const d=await nodeFetchFor(n,'/diagnostics');
    diagnostics={
      status:'online',
      version:d.version||n.agent_version||'',
      dockerVersion:d.dockerVersion||'',
      managedContainers:Number(d.managedContainers)||0,
      runningContainers:Number(d.runningContainers)||0,
      diskPath:d.diskPath||'',
      diskFreeBytes:Number.isFinite(Number(d.diskFreeBytes))?Number(d.diskFreeBytes):null,
      diskTotalBytes:Number.isFinite(Number(d.diskTotalBytes))?Number(d.diskTotalBytes):null,
      hostCpus:Number.isFinite(Number(d.hostCpus))?Number(d.hostCpus):null,
      load1:Number.isFinite(Number(d.load1))?Number(d.load1):null,
      memoryTotalMb:Number.isFinite(Number(d.memoryTotalMb))?Number(d.memoryTotalMb):null,
      memoryAvailableMb:Number.isFinite(Number(d.memoryAvailableMb))?Number(d.memoryAvailableMb):null,
      memoryUsedPct:Number.isFinite(Number(d.memoryUsedPct))?Number(d.memoryUsedPct):null,
      pressureLevel:String(d.pressureLevel||'unknown'),
    };
  }catch(e:any){
    diagnostics={status:'offline',error:String(e?.message||'Node unavailable').slice(0,180)};
  }

  const {api_token:_,...safeNode}=n;
  return NextResponse.json({
    node:{
      ...safeNode,
      free_cpu:Math.max(0,Number(n.capacity_cpu)-Number(n.used_cpu)),
      free_memory_mb:Math.max(0,Number(n.capacity_memory_mb)-Number(n.used_memory_mb)),
      free_disk_mb:Math.max(0,Number(n.capacity_disk_mb)-Number(n.used_disk_mb)),
    },
    diagnostics,
    provisioningPolicy:nodeDiskPolicy(),
  },{headers:{'cache-control':'no-store'}});
}

export async function PATCH(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const u=await getCurrentUser();
  if(!isAdmin(u))return NextResponse.json({error:'Admin required'},{status:403});
  const {id}=await params;
  const q=await db.query(`
    select id,name,enabled,base_url,api_token,last_seen_at,
      capacity_cpu,capacity_memory_mb,capacity_disk_mb
    from nodes where id=$1 limit 1
  `,[id]);
  if(!q.rowCount)return NextResponse.json({error:'Node not found'},{status:404});

  const node=q.rows[0];
  const b=await req.json().catch(()=>({}));
  if(typeof b.enabled!=='boolean')return NextResponse.json({error:'enabled must be boolean'},{status:400});
  const enabled=b.enabled;

  if(enabled){
    const age=node.last_seen_at?Date.now()-new Date(node.last_seen_at).getTime():Number.POSITIVE_INFINITY;
    if(!Number.isFinite(age)||age>120000){
      return NextResponse.json({error:'Node must send a fresh heartbeat before it can be enabled'},{status:409});
    }
    if(Number(node.capacity_cpu)<=0||Number(node.capacity_memory_mb)<=0||Number(node.capacity_disk_mb)<=0){
      return NextResponse.json({error:'Node capacity is not valid yet'},{status:409});
    }
    const live=await checkNodeRuntimeCapacity(node,0);
    if(!live.ok){
      return NextResponse.json({error:`Node cannot be enabled for provisioning: ${live.reason}`},{status:409});
    }
    await db.query('update nodes set enabled=true where id=$1',[id]);
  }else{
    // Drain first. This shares the same node lock used by provisioning reservations,
    // so no new workload can slip in while disable safety is being checked.
    await setNodeDrain(id,true,u.id);
    const attached=await db.query(`select count(*)::int c from servers where node_id=$1 and status<>'deleted'`,[id]);
    const count=Number(attached.rows[0]?.c||0);
    if(count>0){
      return NextResponse.json({error:'Node is now drained. Move or delete all attached servers before disabling it.',attachedServers:count,draining:true},{status:409});
    }
    await db.query('update nodes set enabled=false where id=$1',[id]);
  }

  await audit(u.id,enabled?'node.enable':'node.disable','node',id,{name:node.name});
  return NextResponse.json({ok:true,enabled},{headers:{'cache-control':'no-store'}});
}
