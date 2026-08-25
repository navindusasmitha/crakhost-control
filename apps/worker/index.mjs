import pg from 'pg';
const {Pool}=pg;const db=new Pool({connectionString:process.env.DATABASE_URL});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function fieldMatch(v,s,min,max){if(s==='*')return true;for(const part of s.split(',')){if(part.startsWith('*/')){const n=Number(part.slice(2));if(n>0&&(v-min)%n===0)return true}else if(/^\d+$/.test(part)&&Number(part)===v)return true}return false}
function cronMatch(expr,d){const p=expr.trim().split(/\s+/);if(p.length!==5)return false;return fieldMatch(d.getUTCMinutes(),p[0],0,59)&&fieldMatch(d.getUTCHours(),p[1],0,23)&&fieldMatch(d.getUTCDate(),p[2],1,31)&&fieldMatch(d.getUTCMonth()+1,p[3],1,12)&&fieldMatch(d.getUTCDay(),p[4],0,6)}
function nextRun(expr,from=new Date()){const d=new Date(from);d.setUTCSeconds(0,0);d.setUTCMinutes(d.getUTCMinutes()+1);for(let i=0;i<525600;i++){if(cronMatch(expr,d))return d;d.setUTCMinutes(d.getUTCMinutes()+1)}throw new Error('Cron did not produce a run within one year')}
async function callNode(row,path,body){const base=(row.base_url||process.env.CRAKNODE_URL||'http://localhost:8088').replace(/\/$/,'');const token=row.api_token||process.env.CRAKNODE_TOKEN||'';const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${token}`},body:JSON.stringify(body||{})});const text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch{}if(!r.ok)throw new Error(data.error||`CrakNode ${r.status}`);return data}
async function runSchedule(s){const id=s.identifier;switch(s.action){case'start':case'stop':case'restart':await callNode(s,`/v1/servers/${id}/action`,{action:s.action});break;case'command':if(!s.payload)throw new Error('Command schedule has no payload');await callNode(s,`/v1/servers/${id}/command`,{command:s.payload});break;case'backup':{const b=await db.query("insert into backups(server_id,name,status) values($1,$2,'CREATING') returning id",[s.server_id,`Scheduled ${new Date().toISOString()}`]);try{const n=await callNode(s,`/v1/servers/${id}/backup`,{backupId:b.rows[0].id});await db.query("update backups set status='READY',size_bytes=$2,remote_path=$3 where id=$1",[b.rows[0].id,n.size||0,n.path||''])}catch(e){await db.query("update backups set status='FAILED' where id=$1",[b.rows[0].id]);throw e}break}default:throw new Error('Unsupported schedule action')}}
async function tick(){const now=new Date();const {rows}=await db.query(`select sc.*,s.identifier,s.owner_id,n.base_url,n.api_token from schedules sc join servers s on s.id=sc.server_id left join nodes n on n.id=s.node_id where sc.enabled=true order by sc.created_at limit 200`);for(const s of rows){try{if(!s.next_run_at){await db.query('update schedules set next_run_at=$2 where id=$1',[s.id,nextRun(s.cron,now)]);continue}if(new Date(s.next_run_at)>now)continue;await runSchedule(s);const nr=nextRun(s.cron,now);await db.query("update schedules set last_run_at=now(),next_run_at=$2,run_count=run_count+1,failure_count=0,last_error='' where id=$1",[s.id,nr]);await db.query("insert into audit_events(event,subject_type,subject_id,metadata) values('schedule.run','server',$1,$2::jsonb)",[s.server_id,JSON.stringify({schedule:s.id,action:s.action})]);await db.query("insert into notifications(user_id,title,body,kind) values($1,$2,$3,'success')",[s.owner_id,`Schedule completed: ${s.name}`,`${s.action} ran on ${s.identifier}`])}catch(e){const msg=String(e?.message||e).slice(0,800);await db.query('update schedules set failure_count=failure_count+1,last_error=$2,next_run_at=$3 where id=$1',[s.id,msg,nextRun(s.cron,now)]).catch(()=>{});await db.query("insert into notifications(user_id,title,body,kind) values($1,$2,$3,'error')",[s.owner_id,`Schedule failed: ${s.name}`,msg]).catch(()=>{});console.error('[schedule]',s.name,msg)}}}

async function billingTick(){
  const {rows}=await db.query(`select s.id from servers s where s.next_due_at is not null and s.next_due_at<=now() and s.billing_status in ('ACTIVE','SUSPENDED') order by s.next_due_at limit 50`);
  for(const candidate of rows){
    let runtime=null,action='',notify='',notifyKind='info';
    try{
      const c=await db.connect();
      try{
        await c.query('begin');
        await c.query('select pg_advisory_xact_lock(hashtext($1))',[`crakhost:billing:${candidate.id}`]);
        const sq=await c.query(`select s.*,p.price_monthly,p.currency,p.name plan_name,n.base_url,n.api_token
          from servers s join plans p on p.id=s.plan_id left join nodes n on n.id=s.node_id
          where s.id=$1 for update of s`,[candidate.id]);
        const s=sq.rows[0];
        if(!s||!s.next_due_at||new Date(s.next_due_at)>new Date()||!['ACTIVE','SUSPENDED'].includes(s.billing_status)){await c.query('commit');continue}
        runtime=s;const price=Number(s.price_monthly);
        const uq=await c.query('select credits from users where id=$1 for update',[s.owner_id]);
        const credits=Number(uq.rows[0]?.credits||0);
        const iq=await c.query(`select id,number from invoices where server_id=$1 and kind='RENEWAL' and status='DUE' order by created_at desc limit 1 for update`,[s.id]);
        const dueInvoice=iq.rows[0];

        if(credits>=price){
          await c.query('update users set credits=credits-$2 where id=$1',[s.owner_id,price]);
          await c.query(`insert into wallet_transactions(user_id,amount,type,description,reference_type,reference_id) values($1,$2,'DEBIT',$3,'server',$4)`,[s.owner_id,-price,`Renewal: ${s.name}`,s.id]);
          const next=await c.query(`update servers set next_due_at=greatest(next_due_at,now())+interval '30 days',billing_status='ACTIVE',suspended=false,suspended_at=null,updated_at=now() where id=$1 returning next_due_at`,[s.id]);
          const nextDue=next.rows[0].next_due_at;
          if(dueInvoice){
            await c.query(`update invoices set amount=$2,currency=$3,status='PAID',paid_at=now(),period_start=coalesce(period_start,$4::timestamptz),period_end=$5::timestamptz,description=$6 where id=$1`,[dueInvoice.id,price,s.currency,s.next_due_at,nextDue,`${s.plan_name} renewal - ${s.name}`]);
          }else{
            const num=`INV-${Date.now().toString(36).toUpperCase()}-${s.id.slice(0,6).toUpperCase()}`;
            await c.query(`insert into invoices(user_id,server_id,number,amount,currency,status,due_at,paid_at,description,kind,period_start,period_end) values($1,$2,$3,$4,$5,'PAID',now(),now(),$6,'RENEWAL',$7::timestamptz,$8::timestamptz)`,[s.owner_id,s.id,num,price,s.currency,`${s.plan_name} renewal - ${s.name}`,s.next_due_at,nextDue]);
          }
          await c.query("insert into service_events(server_id,type,detail) values($1,'billing.renewed',$2)",[s.id,`${s.currency} ${price} charged; next due ${new Date(nextDue).toISOString()}`]);
          await c.query('commit');
          action=s.suspended?'start':'';notify=`${s.name} renewed for ${s.currency} ${price}`;notifyKind='success';
        }else{
          if(dueInvoice){
            await c.query(`update invoices set amount=$2,currency=$3,due_at=coalesce(due_at,now()),period_start=coalesce(period_start,$4::timestamptz),period_end=coalesce(period_end,$4::timestamptz+interval '30 days'),description=$5 where id=$1`,[dueInvoice.id,price,s.currency,s.next_due_at,`${s.plan_name} renewal - ${s.name}`]);
          }else{
            const num=`INV-${Date.now().toString(36).toUpperCase()}-${s.id.slice(0,6).toUpperCase()}`;
            await c.query(`insert into invoices(user_id,server_id,number,amount,currency,status,due_at,description,kind,period_start,period_end) values($1,$2,$3,$4,$5,'DUE',now(),$6,'RENEWAL',$7::timestamptz,$7::timestamptz+interval '30 days')`,[s.owner_id,s.id,num,price,s.currency,`${s.plan_name} renewal - ${s.name}`,s.next_due_at]);
          }
          const wasSuspended=!!s.suspended;
          await c.query(`update servers set suspended=true,suspended_at=coalesce(suspended_at,now()),billing_status='SUSPENDED',updated_at=now() where id=$1`,[s.id]);
          if(!wasSuspended)await c.query("insert into service_events(server_id,type,detail) values($1,'billing.suspended',$2)",[s.id,`Wallet credits below ${s.currency} ${price}`]);
          await c.query('commit');
          action=(!wasSuspended||String(s.status).toLowerCase()!=='offline')?'stop':'';
          if(!wasSuspended){notify=`${s.name} was suspended because wallet credits are insufficient.`;notifyKind='error'}
        }
      }catch(e){await c.query('rollback').catch(()=>{});throw e}finally{c.release()}

      if(action&&runtime){
        try{
          await callNode(runtime,`/v1/servers/${runtime.identifier}/action`,{action});
          await db.query("update servers set status=$2,updated_at=now() where id=$1",[runtime.id,action==='start'?'running':'offline']);
          await db.query("insert into service_events(server_id,type,detail) values($1,$2,$3)",[runtime.id,action==='start'?'billing.runtime_resumed':'billing.runtime_stopped',`CrakNode ${action} completed after billing transition`]).catch(()=>{});
        }catch(e){const msg=String(e?.message||e).slice(0,500);await db.query("insert into service_events(server_id,type,detail) values($1,'billing.runtime_action_failed',$2)",[runtime.id,`${action}: ${msg}`]).catch(()=>{});if(action==='start')await db.query("update servers set status='error',updated_at=now() where id=$1",[runtime.id]).catch(()=>{});console.error('[billing-runtime]',runtime.identifier,msg)}
      }
      if(notify&&runtime)await db.query('insert into notifications(user_id,title,body,kind) values($1,$2,$3,$4)',[runtime.owner_id,notifyKind==='success'?'Service renewed':'Service suspended',notify,notifyKind]).catch(()=>{});
    }catch(e){console.error('[billing]',candidate.id,String(e?.message||e))}
  }
}
async function main(){console.log('CrakHost Worker v0.50 started');for(;;){try{await tick();await billingTick()}catch(e){console.error('[worker]',e)}await sleep(30000)}}
main().catch(e=>{console.error(e);process.exit(1)});
