import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser,isStaff,isAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
import {nodeFetchFor} from '@/lib/node';
import {audit} from '@/lib/audit';
import {setNodeDrain} from '@/lib/operations-settings';

export const dynamic='force-dynamic';

export async function GET(_:NextRequest,{params}:{params:Promise<{id:string}>}){
  const u=await getCurrentUser();
  if(!isStaff(u))return NextResponse.json({error:'Forbidden'},{status:403});
  const {id}=await params;
  const {rows}=await db.query(`
    select n.id,n.name,n.location,n.base_url,n.enabled,n.capacity_cpu,
      n.capacity_memory_mb,n.capacity_disk_mb,n.last_seen_at,n.agent_version,
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
      diskFreeBytes:Number.isFinite(Number(d.diskFreeBytes))?Number(d.diskFreeBytes):null,
    };
  }catch(e:any){
    diagnostics={status:'offline',error:String(e?.message||'Node unavailable').slice(0,180)};
  }

  return NextResponse.json({
    node:{
      ...n,
      free_cpu:Math.max(0,Number(n.capacity_cpu)-Number(n.used_cpu)),
      free_memory_mb:Math.max(0,Number(n.capacity_memory_mb)-Number(n.used_memory_mb)),
      free_disk_mb:Math.max(0,Number(n.capacity_disk_mb)-Number(n.used_disk_mb)),
    },
    diagnostics,
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
    try{await nodeFetchFor(node,'/diagnostics')}
    catch(e:any){
      return NextResponse.json({error:`CrakNode diagnostics failed: ${String(e?.message||'node unavailable').slice(0,160)}`},{status:503});
    }
  }else{
    const attached=await db.query(`select count(*)::int c from servers where node_id=$1 and status<>'deleted'`,[id]);
    const count=Number(attached.rows[0]?.c||0);
    if(count>0){
      return NextResponse.json({error:'Move or delete all attached servers before disabling this node',attachedServers:count},{status:409});
    }
  }

  await db.query('update nodes set enabled=$2 where id=$1',[id,enabled]);
  if(!enabled)await setNodeDrain(id,true,u.id);
  await audit(u.id,enabled?'node.enable':'node.disable','node',id,{name:node.name});
  return NextResponse.json({ok:true,enabled},{headers:{'cache-control':'no-store'}});
}
