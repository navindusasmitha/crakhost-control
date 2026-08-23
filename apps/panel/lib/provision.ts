import {randomBytes} from 'node:crypto';
import {audit} from './audit';
import {db} from './db';
import {nodeFetchFor} from './node';
import {checkNodeRuntimeCapacity} from './node-capacity';

type ProvisionInput={
  ownerId:string;
  name:string;
  templateSlug:string;
  memoryMb:number;
  cpu:number;
  diskMb:number;
  nodeId?:string|null;
  location?:string|null;
  port?:number|null;
  planId?:string|null;
  environment?:Record<string,string>;
};

type ProvisionPreflightInput={
  templateSlug:string;
  memoryMb:number;
  cpu:number;
  diskMb:number;
  nodeId?:string|null;
  location?:string|null;
};

type NodeCandidate={
  id:string;
  name:string;
  location:string;
  base_url:string;
  api_token:string;
  capacity_memory_mb:number;
  capacity_disk_mb:number;
  capacity_cpu:number;
  used_memory:number;
  used_disk:number;
  used_cpu:number;
  last_seen_at:string;
};

async function drainSet(){
  const q=await db.query(`select value from system_settings where key='operations' limit 1`);
  const v=q.rows[0]?.value||{};
  return new Set<string>(Array.isArray(v.drainNodes)?v.drainNodes.map(String):[]);
}

async function candidateNodes(nodeId:string|null|undefined,location:string|null|undefined,memory:number,cpu:number,disk:number){
  const drained=await drainSet();
  const params:any[]=[memory,disk,cpu];
  let where='';
  if(nodeId){
    params.push(nodeId);
    where=' and n.id=$4';
  }else if(location&&location!=='auto'){
    params.push(location);
    where=` and (lower(coalesce(n.location,''))=lower($4) or lower(n.name)=lower($4))`;
  }

  const q=await db.query(`
    select n.*,
      coalesce(sum(s.memory_mb) filter(where s.status<>'deleted'),0)::int used_memory,
      coalesce(sum(s.disk_mb) filter(where s.status<>'deleted'),0)::int used_disk,
      coalesce(sum(s.cpu_limit) filter(where s.status<>'deleted'),0)::numeric used_cpu
    from nodes n
    left join servers s on s.node_id=n.id
    where n.enabled=true
      and n.last_seen_at is not null
      and n.last_seen_at>=now()-interval '120 seconds'
      ${where}
    group by n.id
    having n.capacity_memory_mb-coalesce(sum(s.memory_mb) filter(where s.status<>'deleted'),0) >= $1
       and n.capacity_disk_mb-coalesce(sum(s.disk_mb) filter(where s.status<>'deleted'),0) >= $2
       and n.capacity_cpu-coalesce(sum(s.cpu_limit) filter(where s.status<>'deleted'),0) >= $3
    order by (
      n.capacity_memory_mb-coalesce(sum(s.memory_mb) filter(where s.status<>'deleted'),0)
    ) desc,n.created_at asc
  `,params);

  return q.rows.filter((x:any)=>!drained.has(String(x.id))) as NodeCandidate[];
}

async function chooseNode(nodeId:string|null|undefined,location:string|null|undefined,memory:number,cpu:number,disk:number){
  const nodes=await candidateNodes(nodeId,location,memory,cpu,disk);
  if(!nodes.length)return {node:null as NodeCandidate|null,reasons:[] as string[]};

  const reasons:string[]=[];
  for(const node of nodes){
    const check=await checkNodeRuntimeCapacity(node,disk);
    if(check.ok)return {node,reasons,check};
    reasons.push(`${node.name}: ${check.reason}`);
  }
  return {node:null as NodeCandidate|null,reasons,check:null};
}

async function choosePort(client:any,nodeId:string,preferred?:number|null){
  if(preferred){
    const c=await client.query('select 1 from allocations where node_id=$1 and port=$2 limit 1',[nodeId,preferred]);
    if(!c.rowCount)return preferred;
  }
  for(let p=25565;p<=25999;p++){
    const c=await client.query('select 1 from allocations where node_id=$1 and port=$2 limit 1',[nodeId,p]);
    if(!c.rowCount)return p;
  }
  throw new Error('No free port available on selected node');
}

function validateResources(i:{templateSlug:string;memoryMb:number;cpu:number;diskMb:number}){
  if(!i.templateSlug.trim())throw new Error('Server template is required');
  if(!Number.isFinite(i.memoryMb)||i.memoryMb<=0)throw new Error('Invalid server memory allocation');
  if(!Number.isFinite(i.diskMb)||i.diskMb<=0)throw new Error('Invalid server disk allocation');
  if(!Number.isFinite(i.cpu)||i.cpu<=0)throw new Error('Invalid server CPU allocation');
}

function validateInput(i:ProvisionInput){
  validateResources(i);
  if(!i.ownerId)throw new Error('Provisioning owner is required');
  if(!i.name.trim())throw new Error('Server name is required');
}

async function template(slug:string){
  const tq=await db.query('select * from server_templates where slug=$1 and enabled=true limit 1',[slug]);
  const t=tq.rows[0];
  if(!t)throw new Error(`Unsupported template: ${slug}`);
  return t;
}

function capacityError(i:ProvisionPreflightInput,reasons:string[]){
  const detail=reasons.length?`: ${reasons.join(' | ')}`:'';
  return i.location&&i.location!=='auto'
    ?`No healthy schedulable node in ${i.location} has enough safe capacity${detail}`
    :`No healthy schedulable node has enough safe capacity${detail}`;
}

export async function preflightProvisioning(i:ProvisionPreflightInput){
  validateResources(i);
  const t=await template(i.templateSlug);
  const selected=await chooseNode(i.nodeId,i.location,i.memoryMb,i.cpu,i.diskMb);
  if(!selected.node)throw new Error(capacityError(i,selected.reasons));
  return {
    template:{slug:t.slug,image:t.image,internalPort:Number(t.internal_port)},
    node:{id:selected.node.id,name:selected.node.name,location:selected.node.location},
    backingStorage:{
      freeMb:selected.check?.freeDiskMb??null,
      projectedFreeMb:selected.check?.projectedFreeDiskMb??null,
      reserveMb:selected.check?.requiredReserveMb??null,
    },
    pressureLevel:selected.check?.pressureLevel||'unknown',
  };
}

async function reserveServer(node:NodeCandidate,i:ProvisionInput,t:any){
  const client=await db.connect();
  try{
    await client.query('begin');
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`,[`crakhost:node:${node.id}`]);

    const nq=await client.query(`
      select n.*,
        coalesce((select sum(s.memory_mb) from servers s where s.node_id=n.id and s.status<>'deleted'),0)::int used_memory,
        coalesce((select sum(s.disk_mb) from servers s where s.node_id=n.id and s.status<>'deleted'),0)::int used_disk,
        coalesce((select sum(s.cpu_limit) from servers s where s.node_id=n.id and s.status<>'deleted'),0)::numeric used_cpu
      from nodes n
      where n.id=$1
      for update
    `,[node.id]);
    const fresh=nq.rows[0];
    if(!fresh||!fresh.enabled)throw new Error('Selected node is no longer enabled');
    const heartbeat=fresh.last_seen_at?Date.now()-new Date(fresh.last_seen_at).getTime():Number.POSITIVE_INFINITY;
    if(!Number.isFinite(heartbeat)||heartbeat>120000)throw new Error('Selected node heartbeat is stale');

    const oq=await client.query(`select value from system_settings where key='operations' limit 1`);
    const ops=oq.rows[0]?.value||{};
    const drained=new Set<string>(Array.isArray(ops.drainNodes)?ops.drainNodes.map(String):[]);
    if(drained.has(String(node.id)))throw new Error('Selected node entered drain mode before reservation completed');

    const freeMemory=Number(fresh.capacity_memory_mb)-Number(fresh.used_memory||0);
    const freeDisk=Number(fresh.capacity_disk_mb)-Number(fresh.used_disk||0);
    const freeCPU=Number(fresh.capacity_cpu)-Number(fresh.used_cpu||0);
    if(freeMemory<i.memoryMb||freeDisk<i.diskMb||freeCPU<i.cpu){
      throw new Error('Selected node capacity changed before reservation completed');
    }

    const port=await choosePort(client,node.id,i.port);
    const identifier=`srv-${randomBytes(4).toString('hex')}`;
    const container=`crakhost-${identifier}`;
    const {rows}=await client.query(`
      insert into servers(
        owner_id,node_id,plan_id,name,identifier,container_name,image,cpu_limit,memory_mb,disk_mb,
        primary_ip,primary_port,status,billing_status,next_due_at
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'0.0.0.0',$11,'installing','ACTIVE',now()+interval '30 days')
      returning *
    `,[i.ownerId,node.id,i.planId||null,i.name,identifier,container,t.image,i.cpu,i.memoryMb,i.diskMb,port]);
    const server=rows[0];
    await client.query('insert into allocations(node_id,ip,port,server_id) values($1,$2,$3,$4)',[node.id,'0.0.0.0',port,server.id]);
    await client.query("insert into service_events(server_id,type,detail) values($1,'provision.reserved',$2)",[server.id,`Capacity and port ${port} reserved on ${node.name}`]);
    await client.query('commit');
    return {...server,primary_port:port};
  }catch(error){
    await client.query('rollback').catch(()=>{});
    throw error;
  }finally{
    client.release();
  }
}

async function verifyRuntime(node:NodeCandidate,identifier:string){
  let last:any=null;
  let lastError='';
  for(let attempt=0;attempt<10;attempt++){
    try{
      last=await nodeFetchFor(node,`/v1/servers/${encodeURIComponent(identifier)}/status`);
      const state=String(last?.status||'').toLowerCase();
      if(state==='running')return last;
      if(['dead','exited','removing'].includes(state))throw new Error(`container entered ${state} state`);
    }catch(e:any){
      lastError=String(e?.message||e);
      if(/entered (dead|exited|removing) state/i.test(lastError))throw e;
    }
    await new Promise(resolve=>setTimeout(resolve,750));
  }
  const state=String(last?.status||'unknown');
  throw new Error(lastError||`container did not reach running state (last state: ${state})`);
}

async function cleanupFailedProvision(node:NodeCandidate,server:any,reason:string){
  let remoteClean=false;
  let cleanupError='';
  try{
    await nodeFetchFor(node,`/v1/servers/${encodeURIComponent(server.identifier)}/delete`,{method:'POST'});
    remoteClean=true;
  }catch(e:any){
    cleanupError=String(e?.message||e).slice(0,300);
  }

  if(remoteClean){
    await db.query('delete from allocations where server_id=$1',[server.id]).catch(()=>{});
    await db.query("update servers set status='deleted',updated_at=now() where id=$1",[server.id]).catch(()=>{});
    await db.query("insert into service_events(server_id,type,detail) values($1,'provision.failed',$2)",[server.id,`${reason} · runtime cleanup completed`]).catch(()=>{});
  }else{
    await db.query("update servers set status='error',updated_at=now() where id=$1",[server.id]).catch(()=>{});
    await db.query("insert into service_events(server_id,type,detail) values($1,'provision.cleanup_required',$2)",[server.id,`${reason} · cleanup failed: ${cleanupError||'unknown cleanup error'}`]).catch(()=>{});
  }
  return {remoteClean,cleanupError};
}

export async function provisionServer(i:ProvisionInput){
  validateInput(i);
  const t=await template(i.templateSlug);
  const selected=await chooseNode(i.nodeId,i.location,i.memoryMb,i.cpu,i.diskMb);
  const node=selected.node;
  if(!node)throw new Error(capacityError(i,selected.reasons));

  const server=await reserveServer(node,i,t);
  try{
    const finalCheck=await checkNodeRuntimeCapacity(node,i.diskMb);
    if(!finalCheck.ok)throw new Error(`Final node capacity check failed: ${finalCheck.reason}`);

    const env={...(t.environment||{}),...(i.environment||{})};
    await nodeFetchFor(node,`/v1/servers/${encodeURIComponent(server.identifier)}/create`,{
      method:'POST',
      body:JSON.stringify({image:t.image,memoryMb:i.memoryMb,cpu:i.cpu,hostPort:server.primary_port,containerPort:t.internal_port,env}),
    });
    await db.query("insert into service_events(server_id,type,detail) values($1,'provision.runtime_created',$2)",[server.id,`CrakNode created ${server.container_name} on ${node.name}`]);

    const runtime=await verifyRuntime(node,server.identifier);
    await db.query("update servers set status='running',updated_at=now() where id=$1",[server.id]);
    await db.query("insert into service_events(server_id,type,detail) values($1,'provision.ready',$2)",[server.id,`Runtime verified ${String(runtime?.status||'running')} on ${node.name}${node.location?` (${node.location})`:''}`]);
    await audit(i.ownerId,'server.provision.success','server',server.id,{identifier:server.identifier,nodeId:node.id,node:node.name,port:server.primary_port}).catch(()=>{});
    return {...server,status:'running',node_name:node.name,node_location:node.location,runtime};
  }catch(e:any){
    const msg=String(e?.message||e).slice(0,500);
    const cleanup=await cleanupFailedProvision(node,server,msg);
    await audit(i.ownerId,'server.provision.failed','server',server.id,{identifier:server.identifier,nodeId:node.id,node:node.name,error:msg,cleanup:cleanup.remoteClean?'complete':'required'}).catch(()=>{});
    if(!cleanup.remoteClean){
      throw new Error(`Docker provisioning failed on ${node.name}: ${msg}. Runtime cleanup also failed; allocation is retained for safety and administrator cleanup is required.`);
    }
    throw new Error(`Docker provisioning failed on ${node.name}: ${msg}`);
  }
}
