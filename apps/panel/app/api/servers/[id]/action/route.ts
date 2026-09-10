import {NextResponse} from 'next/server';
import {requireServer,apiError} from '@/lib/server-access';
import {nodeFetchForServer} from '@/lib/node';
import {db} from '@/lib/db';
import {audit} from '@/lib/audit';

const allowed=new Set(['start','stop','restart','kill']);

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  try{
    const {server,user}=await requireServer(id,'console');
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||'').toLowerCase();
    if(!allowed.has(action))return NextResponse.json({error:'Unsupported action'},{status:400});

    const result=await nodeFetchForServer(id,`/v1/servers/${encodeURIComponent(id)}/action`,{method:'POST',body:JSON.stringify({action})});
    const desired=['stop','kill'].includes(action)?'stopped':'running';
    await db.query(`
      update servers
      set desired_state=$2,
          recovery_failures=case when $2='running' then 0 else recovery_failures end,
          recovery_suppressed_until=case when $2='running' then null else recovery_suppressed_until end,
          updated_at=now()
      where id=$1
    `,[server.id,desired]);
    await db.query("insert into service_events(server_id,type,detail) values($1,'lifecycle.desired_state',$2)",[server.id,`Manual ${action} set desired state to ${desired}`]).catch(()=>{});
    await audit(user.id,'server.action','server',server.id,{action,desiredState:desired}).catch(()=>{});
    return NextResponse.json({ok:true,action,desiredState:desired,...result});
  }catch(e:any){
    const a=apiError(e);const status=a.status===500?503:a.status;
    return NextResponse.json({error:a.error},{status});
  }
}
