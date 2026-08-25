import {db} from '@/lib/db';

export type ProvisionLockResult<T>={acquired:false}|{acquired:true;value:T};

/**
 * Hold a PostgreSQL session advisory lock for the whole provisioning operation.
 *
 * Provisioning includes external CrakNode calls, so a transaction row lock is not a
 * good fit. A session advisory lock is released automatically if the process/DB
 * connection dies and prevents a retry or recovery request from provisioning the
 * same paid order at the same time.
 */
export async function withOrderProvisionLock<T>(orderId:string,work:()=>Promise<T>):Promise<ProvisionLockResult<T>>{
  const client=await db.connect();
  const key=`crakhost:order-provision:${orderId}`;
  let acquired=false;
  try{
    const q=await client.query<{acquired:boolean}>('select pg_try_advisory_lock(hashtext($1)) acquired',[key]);
    acquired=!!q.rows[0]?.acquired;
    if(!acquired)return {acquired:false};
    return {acquired:true,value:await work()};
  }finally{
    if(acquired)await client.query('select pg_advisory_unlock(hashtext($1))',[key]).catch(()=>{});
    client.release();
  }
}
