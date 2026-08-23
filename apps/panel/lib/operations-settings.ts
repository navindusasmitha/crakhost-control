import {db} from './db';

export async function setNodeDrain(nodeId:string,draining:boolean,userId:string){
  const client=await db.connect();
  try{
    await client.query('begin');
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`,[`crakhost:node:${nodeId}`]);
    const node=await client.query('select id from nodes where id=$1 for update',[nodeId]);
    if(!node.rowCount)throw new Error('Node not found');
    await client.query(`
      insert into system_settings(key,value,updated_by,updated_at)
      values('operations','{}'::jsonb,$1,now())
      on conflict(key) do nothing
    `,[userId]);
    const q=await client.query(`select value from system_settings where key='operations' for update`);
    const current=q.rows[0]?.value||{};
    const nodes=new Set<string>(Array.isArray(current.drainNodes)?current.drainNodes.map(String):[]);
    if(draining)nodes.add(nodeId);else nodes.delete(nodeId);
    const next={...current,drainNodes:[...nodes]};
    await client.query(`
      update system_settings
      set value=$2::jsonb,updated_by=$3,updated_at=now()
      where key=$1
    `,['operations',JSON.stringify(next),userId]);
    await client.query('commit');
    return next;
  }catch(error){
    await client.query('rollback').catch(()=>{});
    throw error;
  }finally{
    client.release();
  }
}
