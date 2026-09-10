import {db} from './db';
import {nodeFetchFor} from './node';

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

export type RecoveryRunResult={
  checked:number;
  healthy:number;
  recovered:number;
  failed:number;
  suppressed:number;
  skipped:number;
  details:Array<{server:string;action:string;result:string}>;
};

async function event(serverId:string,type:string,detail:string){
  await db.query('insert into service_events(server_id,type,detail) values($1,$2,$3)',[serverId,type,detail.slice(0,1000)]).catch(()=>{});
}

async function notify(ownerId:string,title:string,body:string,kind='info'){
  await db.query('insert into notifications(user_id,title,body,kind) values($1,$2,$3,$4)',[ownerId,title.slice(0,160),body.slice(0,1200),kind]).catch(()=>{});
}

async function suppress(server:any,reason:string){
  await db.query("update servers set recovery_suppressed_until=now()+interval '15 minutes',updated_at=now() where id=$1",[server.id]);
  await event(server.id,'recovery.suppressed',reason);
  await notify(server.owner_id,`Auto recovery paused: ${server.name}`,`${reason} Automatic recovery will retry after the cooldown unless you stop or suspend the server.`,'warning');
}

async function recoverOne(server:any){
  const client=await db.connect();
  let locked=false;
  try{
    const l=await client.query('select pg_try_advisory_lock(hashtext($1)) locked',[`crakhost:recovery:${server.id}`]);
    locked=!!l.rows[0]?.locked;
    if(!locked)return {action:'skip',result:'another recovery worker owns the server'};

    const freshQ=await client.query(`select desired_state,recovery_enabled,recovery_suppressed_until,suspended,billing_status,last_recovery_at from servers where id=$1`,[server.id]);
    const fresh=freshQ.rows[0];
    if(!fresh||!fresh.recovery_enabled||fresh.desired_state!=='running'||fresh.suspended||fresh.billing_status!=='ACTIVE')return {action:'skip',result:'recovery no longer requested'};
    if(fresh.recovery_suppressed_until&&new Date(fresh.recovery_suppressed_until).getTime()>Date.now())return {action:'skip',result:'cooldown active'};

    let runtime:any;
    try{runtime=await nodeFetchFor(server,`/v1/servers/${encodeURIComponent(server.identifier)}/status`)}catch(e:any){return {action:'skip',result:`runtime status unavailable: ${String(e?.message||e).slice(0,160)}`}};
    const state=String(runtime?.status||'unknown').toLowerCase();
    const unhealthy=String(runtime?.health||'').toLowerCase()==='unhealthy'||!!runtime?.oomKilled||!!runtime?.stateError;

    if(state==='running'&&!unhealthy){
      await client.query("update servers set status='running',recovery_failures=0,recovery_suppressed_until=null,updated_at=now() where id=$1",[server.id]);
      return {action:'healthy',result:'running'};
    }

    if(['dead','removing'].includes(state)){
      await suppress(server,`CrakNode reported unrecoverable runtime state: ${state}.`);
      return {action:'suppress',result:state};
    }

    let action='';
    if(['exited','created'].includes(state))action='start';
    else if(state==='running'&&unhealthy)action='restart';
    else return {action:'skip',result:`state ${state} is not safe for automatic recovery`};

    const recent=await client.query("select count(*)::int c from service_events where server_id=$1 and type='recovery.attempt' and created_at>=now()-interval '10 minutes'",[server.id]);
    if(Number(recent.rows[0]?.c||0)>=3){
      await suppress(server,'Three automatic recovery attempts were reached within 10 minutes.');
      return {action:'suppress',result:'rate limit reached'};
    }
    if(fresh.last_recovery_at&&Date.now()-new Date(fresh.last_recovery_at).getTime()<90000)return {action:'skip',result:'90 second retry guard active'};

    await event(server.id,'recovery.attempt',`Automatic ${action} requested from runtime state ${state}${unhealthy?' (unhealthy/OOM signal)':''}.`);
    await client.query('update servers set last_recovery_at=now(),updated_at=now() where id=$1',[server.id]);

    try{
      await nodeFetchFor(server,`/v1/servers/${encodeURIComponent(server.identifier)}/action`,{method:'POST',body:JSON.stringify({action})});
      await sleep(1500);
      const verify=await nodeFetchFor(server,`/v1/servers/${encodeURIComponent(server.identifier)}/status`);
      const verifyState=String(verify?.status||'unknown').toLowerCase();
      const verifyUnhealthy=String(verify?.health||'').toLowerCase()==='unhealthy'||!!verify?.oomKilled||!!verify?.stateError;
      if(verifyState!=='running'||verifyUnhealthy)throw new Error(`verification returned ${verifyState}${verifyUnhealthy?' unhealthy':''}`);
      await client.query("update servers set status='running',recovery_failures=0,recovery_suppressed_until=null,last_recovery_at=now(),updated_at=now() where id=$1",[server.id]);
      await event(server.id,'recovery.success',`Automatic ${action} restored the workload to running state.`);
      await notify(server.owner_id,`Server recovered: ${server.name}`,`CrakHost automatically ${action==='start'?'started':'restarted'} the workload after detecting ${state}${unhealthy?' / unhealthy runtime':''}.`,'success');
      return {action,result:'recovered'};
    }catch(e:any){
      const reason=String(e?.message||e).slice(0,300);
      const f=await client.query('update servers set recovery_failures=recovery_failures+1,last_recovery_at=now(),updated_at=now() where id=$1 returning recovery_failures',[server.id]);
      await event(server.id,'recovery.failed',`Automatic ${action} failed: ${reason}`);
      if(Number(f.rows[0]?.recovery_failures||0)>=3)await suppress(server,`Automatic recovery failed repeatedly. Last error: ${reason}`);
      return {action,result:`failed: ${reason}`};
    }
  }finally{
    if(locked)await client.query('select pg_advisory_unlock(hashtext($1))',[`crakhost:recovery:${server.id}`]).catch(()=>{});
    client.release();
  }
}

export async function runAutoRecovery():Promise<RecoveryRunResult>{
  const q=await db.query(`
    select s.id,s.owner_id,s.name,s.identifier,s.status,s.last_recovery_at,
           n.id node_id,n.name node_name,n.base_url,n.api_token,n.enabled,n.last_seen_at
    from servers s
    join nodes n on n.id=s.node_id
    where s.status<>'deleted'
      and s.status not in ('installing','migrating')
      and s.suspended=false
      and s.billing_status='ACTIVE'
      and s.desired_state='running'
      and s.recovery_enabled=true
      and (s.recovery_suppressed_until is null or s.recovery_suppressed_until<=now())
      and n.enabled=true
      and n.last_seen_at>=now()-interval '120 seconds'
    order by coalesce(s.last_recovery_at,to_timestamp(0)) asc
    limit 50
  `);

  const result:RecoveryRunResult={checked:0,healthy:0,recovered:0,failed:0,suppressed:0,skipped:0,details:[]};
  for(const server of q.rows){
    result.checked++;
    const one=await recoverOne(server);
    if(one.action==='healthy')result.healthy++;
    else if(one.result==='recovered')result.recovered++;
    else if(one.action==='suppress')result.suppressed++;
    else if(one.result.startsWith('failed:'))result.failed++;
    else result.skipped++;
    if(one.action!=='healthy')result.details.push({server:server.identifier,action:one.action,result:one.result});
  }
  return result;
}
