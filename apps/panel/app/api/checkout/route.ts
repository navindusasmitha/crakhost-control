import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {sendTemplateEmail} from '@/lib/mail';
import {preflightProvisioning,provisionServer} from '@/lib/provision';
import {withOrderProvisionLock} from '@/lib/order-provision-lock';

function appBase(){const raw=process.env.APP_URL||process.env.PANEL_URL||(process.env.PANEL_DOMAIN?`https://${process.env.PANEL_DOMAIN}`:'');return raw.replace(/\/$/,'')}
function requestKey(req:NextRequest,body:any){return String(body.requestKey||req.headers.get('idempotency-key')||'').trim().slice(0,160)}

async function replayCheckout(userId:string,key:string){
  if(!key)return null;
  const {rows}=await db.query(`select o.id,o.status,o.failure_reason,o.server_name,s.identifier,n.name node_name,n.location node_location
    from orders o left join servers s on s.id=o.server_id left join nodes n on n.id=o.node_id
    where o.user_id=$1 and o.idempotency_key=$2 limit 1`,[userId,key]);
  const x=rows[0];if(!x)return null;
  if(x.status==='ACTIVE'&&x.identifier)return NextResponse.json({ok:true,replayed:true,orderId:x.id,identifier:x.identifier,node:x.node_name,location:x.node_location},{status:200});
  if(x.status==='FAILED')return NextResponse.json({error:`This checkout attempt already failed: ${x.failure_reason||'provisioning failed'}`,replayed:true,orderId:x.id},{status:409});
  if(x.status==='CANCELLED')return NextResponse.json({error:'This checkout attempt was cancelled. Start a new checkout attempt.',replayed:true,orderId:x.id},{status:409});
  if(x.status==='PENDING')return NextResponse.json({error:'This checkout attempt already has an unpaid pending order. Add wallet credits and retry with a new checkout attempt.',replayed:true,orderId:x.id,status:x.status},{status:402});
  return NextResponse.json({ok:false,replayed:true,pending:true,orderId:x.id,status:x.status,resumable:true},{status:202});
}

export async function POST(req:NextRequest){
  const user=await getCurrentUser();
  if(!user)return NextResponse.json({error:'Sign in required'},{status:401});

  const body=await req.json().catch(()=>({}));
  const key=requestKey(req,body);
  const replay=await replayCheckout(user.id,key);if(replay)return replay;
  const slug=String(body.plan||'');
  const serverName=String(body.serverName||'My Server').trim().slice(0,120);
  if(!serverName)return NextResponse.json({error:'Server name is required'},{status:400});
  const config={game:String(body.game||'game').slice(0,30),location:String(body.location||'auto').slice(0,100),software:String(body.software||'default').slice(0,80)};

  const pq=await db.query('select * from plans where slug=$1 and enabled=true limit 1',[slug]);
  const plan=pq.rows[0];
  if(!plan)return NextResponse.json({error:'Plan not found'},{status:404});
  const templateSlug=plan.template_slug||config.game||'minecraft';

  try{await preflightProvisioning({templateSlug,memoryMb:Number(plan.memory_mb),cpu:Number(plan.cpu_limit),diskMb:Number(plan.disk_mb),location:config.location})}
  catch(e:any){return NextResponse.json({error:`Provisioning unavailable: ${String(e?.message||e)}`},{status:409})}

  const price=Number(plan.price_monthly);
  const credits=Number(user.credits||0);
  if(credits<price){
    try{
      const oq=await db.query(`insert into orders(user_id,plan_id,status,amount,currency,template_slug,server_name,payment_method,metadata,idempotency_key) values($1,$2,'PENDING',$3,$4,$5,$6,'wallet',$7::jsonb,$8) returning id`,[user.id,plan.id,price,plan.currency,templateSlug,serverName,JSON.stringify({...config,reason:'INSUFFICIENT_WALLET'}),key||null]);
      const number=`INV-${Date.now().toString(36).toUpperCase()}-${String(oq.rows[0].id).slice(0,6).toUpperCase()}`;
      const description=`${plan.name} - ${serverName}`;const dueDate=new Date(Date.now()+24*60*60*1000);
      await db.query(`insert into invoices(user_id,order_id,number,amount,currency,status,due_at,description,kind) values($1,$2,$3,$4,$5,'DUE',now()+interval '1 day',$6,'ORDER')`,[user.id,oq.rows[0].id,number,price,plan.currency,description]);
      await sendTemplateEmail('invoice_due',user.email,{name:user.name,invoice_number:number,description,currency:plan.currency,amount:price.toFixed(2),due_date:dueDate.toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})+' UTC',billing_url:appBase()?`${appBase()}/billing`:''}).catch(e=>console.warn('[mail] invoice due delivery failed',e?.message||e));
      return NextResponse.json({error:`Wallet balance is ${plan.currency} ${credits.toFixed(2)}. ${plan.currency} ${price.toFixed(2)} is required. Order created as pending.`,orderId:oq.rows[0].id},{status:402});
    }catch(e:any){
      if(e?.code==='23505'&&key){const existing=await replayCheckout(user.id,key);if(existing)return existing;}
      throw e;
    }
  }

  const client=await db.connect();let order:any;let invoiceNumber='';
  try{
    await client.query('begin');
    const locked=await client.query('select credits from users where id=$1 for update',[user.id]);
    if(Number(locked.rows[0]?.credits)<price)throw new Error('Wallet balance changed; retry checkout');
    const oq=await client.query(`insert into orders(user_id,plan_id,status,amount,currency,template_slug,server_name,payment_method,paid_at,metadata,idempotency_key) values($1,$2,'PAID',$3,$4,$5,$6,'wallet',now(),$7::jsonb,$8) returning *`,[user.id,plan.id,price,plan.currency,templateSlug,serverName,JSON.stringify({checkout:'storefront',...config}),key||null]);
    order=oq.rows[0];
    await client.query('update users set credits=credits-$2 where id=$1',[user.id,price]);
    await client.query(`insert into wallet_transactions(user_id,amount,type,description,reference_type,reference_id) values($1,$2,'DEBIT',$3,'order',$4)`,[user.id,-price,`${plan.name} purchase`,order.id]);
    invoiceNumber=`INV-${Date.now().toString(36).toUpperCase()}-${String(order.id).slice(0,6).toUpperCase()}`;
    await client.query(`insert into invoices(user_id,order_id,number,amount,currency,status,due_at,paid_at,description,kind) values($1,$2,$3,$4,$5,'PAID',now(),now(),$6,'ORDER')`,[user.id,order.id,invoiceNumber,price,plan.currency,`${plan.name} - ${serverName}`]);
    await client.query('commit');
  }catch(e:any){
    await client.query('rollback').catch(()=>{});
    if(e?.code==='23505'&&key){const existing=await replayCheckout(user.id,key);if(existing)return existing;}
    return NextResponse.json({error:e.message||'Checkout failed'},{status:409});
  }finally{client.release()}

  const locked=await withOrderProvisionLock(order.id,async()=>{
    try{
      await db.query("update orders set status='PROVISIONING',updated_at=now() where id=$1 and status='PAID'",[order.id]);
      const env:any={CRAKHOST_GAME:config.game,CRAKHOST_SOFTWARE:config.software};if(config.game==='minecraft'&&config.software!=='default')env.TYPE=config.software.toUpperCase();
      const server=await provisionServer({ownerId:user.id,name:serverName,templateSlug,memoryMb:Number(plan.memory_mb),cpu:Number(plan.cpu_limit),diskMb:Number(plan.disk_mb),planId:plan.id,orderId:order.id,location:config.location,environment:env});
      await db.query("update orders set status='ACTIVE',server_id=$2,node_id=$3,primary_port=$4,provisioned_at=now(),failure_reason=null,updated_at=now() where id=$1",[order.id,server.id,server.node_id,server.primary_port]);
      return {ok:true as const,server};
    }catch(e:any){
      const msg=String(e?.message||e).slice(0,700);const c=await db.connect();let refunded=false;
      try{
        await c.query('begin');
        const state=await c.query('select status from orders where id=$1 for update',[order.id]);
        if(state.rows[0]?.status!=='FAILED'&&state.rows[0]?.status!=='ACTIVE'){
          await c.query("update orders set status='FAILED',failure_reason=$2,updated_at=now() where id=$1",[order.id,msg]);
          await c.query('update users set credits=credits+$2 where id=$1',[user.id,price]);
          await c.query(`insert into wallet_transactions(user_id,amount,type,description,reference_type,reference_id) values($1,$2,'REFUND',$3,'order',$4)`,[user.id,price,`Automatic refund: ${plan.name} provisioning failed`,order.id]);
          await c.query("update invoices set status='REFUNDED' where order_id=$1 and status='PAID'",[order.id]);
          await c.query("insert into notifications(user_id,title,body,kind) values($1,'Provisioning failed',$2,'error')",[user.id,`${serverName} could not be provisioned. Your wallet payment was refunded automatically.`]);
          refunded=true;
        }
        await c.query('commit');
      }catch{await c.query('rollback').catch(()=>{})}finally{c.release()}
      return {ok:false as const,msg,refunded};
    }
  });

  if(!locked.acquired)return NextResponse.json({ok:false,pending:true,resumable:true,orderId:order.id,status:'PROVISIONING'},{status:202});
  if(!locked.value.ok){
    if(locked.value.refunded)await sendTemplateEmail('payment_refunded',user.email,{name:user.name,server_name:serverName,currency:plan.currency,amount:price.toFixed(2),reason:locked.value.msg,billing_url:appBase()?`${appBase()}/billing`:''}).catch(e=>console.warn('[mail] refund delivery failed',e?.message||e));
    return NextResponse.json({error:`Provisioning failed and wallet was refunded: ${locked.value.msg}`,orderId:order.id},{status:502});
  }

  const server=locked.value.server;
  await db.query("insert into notifications(user_id,title,body,kind) values($1,'Server ready',$2,'success')",[user.id,`${serverName} has been provisioned on ${server.node_name}${server.node_location?` (${server.node_location})`:''}.`]);
  const base=appBase();
  await Promise.allSettled([
    sendTemplateEmail('invoice_paid',user.email,{name:user.name,invoice_number:invoiceNumber,currency:plan.currency,amount:price.toFixed(2),billing_url:base?`${base}/billing`:''}),
    sendTemplateEmail('server_ready',user.email,{name:user.name,server_name:serverName,node_name:server.node_name||'',server_url:base?`${base}/servers/${server.identifier}`:''}),
  ]);
  return NextResponse.json({ok:true,orderId:order.id,identifier:server.identifier,node:server.node_name,location:server.node_location},{status:201});
}
