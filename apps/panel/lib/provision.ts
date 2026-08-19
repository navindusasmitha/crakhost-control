import {db} from './db';
import {nodeFetchFor} from './node';
import {randomBytes} from 'node:crypto';

type ProvisionInput={ownerId:string;name:string;templateSlug:string;memoryMb:number;cpu:number;diskMb:number;nodeId?:string|null;port?:number|null;planId?:string|null};

async function chooseNode(nodeId:string|null|undefined,memory:number,cpu:number,disk:number){
  if(nodeId){const q=await db.query(`select n.*,coalesce(sum(s.memory_mb) filter(where s.status<>'deleted'),0)::int used_memory,coalesce(sum(s.disk_mb) filter(where s.status<>'deleted'),0)::int used_disk,coalesce(sum(s.cpu_limit) filter(where s.status<>'deleted'),0)::numeric used_cpu from nodes n left join servers s on s.node_id=n.id where n.id=$1 and n.enabled=true group by n.id limit 1`,[nodeId]);return q.rows[0]||null}
  const q=await db.query(`select n.*,coalesce(sum(s.memory_mb) filter(where s.status<>'deleted'),0)::int used_memory,coalesce(sum(s.disk_mb) filter(where s.status<>'deleted'),0)::int used_disk,coalesce(sum(s.cpu_limit) filter(where s.status<>'deleted'),0)::numeric used_cpu from nodes n left join servers s on s.node_id=n.id where n.enabled=true group by n.id having n.capacity_memory_mb-coalesce(sum(s.memory_mb) filter(where s.status<>'deleted'),0) >= $1 and n.capacity_disk_mb-coalesce(sum(s.disk_mb) filter(where s.status<>'deleted'),0) >= $2 and n.capacity_cpu-coalesce(sum(s.cpu_limit) filter(where s.status<>'deleted'),0) >= $3 order by (n.capacity_memory_mb-coalesce(sum(s.memory_mb),0)) desc,n.created_at asc limit 1`,[memory,disk,cpu]);return q.rows[0]||null
}
async function choosePort(nodeId:string,preferred?:number|null){
  if(preferred){const c=await db.query('select 1 from allocations where node_id=$1 and port=$2 limit 1',[nodeId,preferred]);if(!c.rowCount)return preferred}
  for(let p=25565;p<=25999;p++){const c=await db.query('select 1 from allocations where node_id=$1 and port=$2 limit 1',[nodeId,p]);if(!c.rowCount)return p}
  throw new Error('No free port available on selected node');
}
export async function provisionServer(i:ProvisionInput){
  const tq=await db.query('select * from server_templates where slug=$1 and enabled=true limit 1',[i.templateSlug]);const t=tq.rows[0];if(!t)throw new Error('Unsupported template');
  const node=await chooseNode(i.nodeId,i.memoryMb,i.cpu,i.diskMb);if(!node)throw new Error('No node has enough free capacity');
  const port=await choosePort(node.id,i.port);const identifier=`srv-${randomBytes(4).toString('hex')}`;const container=`crakhost-${identifier}`;
  const {rows}=await db.query(`insert into servers(owner_id,node_id,plan_id,name,identifier,container_name,image,cpu_limit,memory_mb,disk_mb,primary_ip,primary_port,status,billing_status,next_due_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'0.0.0.0',$11,'installing','ACTIVE',now()+interval '30 days') returning *`,[i.ownerId,node.id,i.planId||null,i.name,identifier,container,t.image,i.cpu,i.memoryMb,i.diskMb,port]);
  const s=rows[0];await db.query('insert into allocations(node_id,ip,port,server_id) values($1,$2,$3,$4)',[node.id,'0.0.0.0',port,s.id]);
  try{await nodeFetchFor(node,`/v1/servers/${identifier}/create`,{method:'POST',body:JSON.stringify({image:t.image,memoryMb:i.memoryMb,cpu:i.cpu,hostPort:port,containerPort:t.internal_port,env:t.environment||{}})});await db.query("update servers set status='running' where id=$1",[s.id]);await db.query("insert into service_events(server_id,type,detail) values($1,'provision','Server provisioned successfully')",[s.id]);return {...s,status:'running',primary_port:port,node_name:node.name};}
  catch(e){await db.query("update servers set status='error' where id=$1",[s.id]);await db.query("insert into service_events(server_id,type,detail) values($1,'provision.failed',$2)",[s.id,String((e as any)?.message||e).slice(0,500)]);throw e}
}
