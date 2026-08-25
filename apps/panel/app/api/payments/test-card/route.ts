import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {sendTemplateEmail} from '@/lib/mail';
import {preflightProvisioning,provisionServer} from '@/lib/provision';
import {withOrderProvisionLock} from '@/lib/order-provision-lock';

const successCards=new Set(['4242424242424242','5555555555554444']);
const declineCards=new Set(['4000000000000002','4000000000009995']);
function appBase(){const raw=process.env.APP_URL||process.env.PANEL_URL||(process.env.PANEL_DOMAIN?`https://${process.env.PANEL_DOMAIN}`:'');return raw.replace(/\/$/,'')}
function requestKey(req:NextRequest,b:any){return String(b.requestKey||req.headers.get('idempotency-key')||'').trim().slice(0,160)}

async function replayPayment(userId:string,key:string){
  if(!key)return null;
  const {rows}=await db.query(`select o.id,o.status,o.failure_reason,s.identifier,n.name node_name,n.location node_location
    from orders o left join servers s on s.id=o.server_id left join nodes n on n.id=o.node_id
    where o.user_id=$1 and o.idempotency_key=$2 limit 1`,[userId,key]);
  const x=rows[0];if(!x)return null;
  if(x.status==='ACTIVE'&&x.identifier)return NextResponse.json({ok:true,replayed:true,orderId:x.id,identifier:x.identifier,node:x.node_name,location:x.node_location},{status:200});
  if(x.status==='FAILED')return NextResponse.json({error:`This test checkout already failed: ${x.failure_reason||'provisioning failed'}`,replayed:true,orderId:x.id},{status:409});
  return NextResponse.json({ok:false,replayed:true,pending:true,resumable:true,orderId:x.id,status:x.status},{status:202});
}

export async function POST(req:NextRequest){
  const user=await getCurrentUser();
  if(!user)return NextResponse.json({error:'Sign in required'},{status:401});
  try{
    const b=await req.json();
    const key=requestKey(req,b);
    const replay=await replayPayment(user.id,key);if(replay)return replay;
    const planSlug=String(b.plan||'');
    const serverName=String(b.serverName||'My Game Server').trim().slice(0,120);
    const card=String(b.cardNumber||'').replace(/\D/g,'');
    const exp=String(b.expiry||'').trim();
    const cvc=String(b.cvc||'').trim();
    const config={game:String(b.game||'game').slice(0,30),location:String(b.location||'auto').slice(0,100),software:String(b.software||'default').slice(0,80)};
    if(!serverName)return NextResponse.json({error:'Server name is required'},{status:400});
    if(!/^\d{16}$/.test(card)||!/^\d{2}\/\d{2}$/.test(exp)||!/^\d{3,4}$/.test(cvc))return NextResponse.json({error:'Enter valid test card details.'},{status:400});
    if(declineCards.has(card))return NextResponse.json({error:'Test card declined.'},{status:402});
    if(!successCards.has(card))return NextResponse.json({error:'Use a supported test card number.'},{status:400});

    const {rows}=await db.query('select * from plans where slug=$1 and enabled=true limit 1',[planSlug]);
    const plan=rows[0];
    if(!plan)return NextResponse.json({error:'Plan not found'},{status:404});
    const templateSlug=plan.template_slug||config.game||'minecraft';

    try{
      await preflightProvisioning({templateSlug,memoryMb:Number(plan.memory_mb),cpu:Number(plan.cpu_limit),diskMb:Number(plan.disk_mb),location:config.location});
    }catch(e:any){
      return NextResponse.json({error:`Provisioning unavailable: ${String(e?.message||e)}`},{status:409});
    }

    const amount=Number(plan.price_monthly);
    const metadata={testCard:`**** **** **** ${card.slice(-4)}`,gateway:'TEST',...config};
    const c=await db.connect();let order:any;let invoice='';
    try{
      await c.query('begin');
      const oq=await c.query(`insert into orders(user_id,plan_id,status,amount,currency,template_slug,server_name,payment_method,paid_at,metadata,idempotency_key) values($1,$2,'PAID',$3,$4,$5,$6,'test_card',now(),$7::jsonb,$8) returning *`,[user.id,plan.id,amount,plan.currency,templateSlug,serverName,JSON.stringify(metadata),key||null]);
      order=oq.rows[0];
      invoice=`INV-${Date.now().toString(36).toUpperCase()}-${String(order.id).slice(0,6).toUpperCase()}`;
      await c.query(`insert into invoices(user_id,order_id,number,amount,currency,status,due_at,paid_at,description,kind) values($1,$2,$3,$4,$5,'PAID',now(),now(),$6,'ORDER')`,[user.id,order.id,invoice,amount,plan.currency,`${plan.name} - ${serverName}`]);
      await c.query('commit');
    }catch(e:any){
      await c.query('rollback').catch(()=>{});
      if(e?.code==='23505'&&key){const existing=await replayPayment(user.id,key);if(existing)return existing;}
      throw e;
    }finally{c.release()}

    try{
      const locked=await withOrderProvisionLock(order.id,async()=>{
        await db.query("update orders set status='PROVISIONING',updated_at=now() where id=$1 and status='PAID'",[order.id]);
        const env:any={CRAKHOST_GAME:config.game,CRAKHOST_SOFTWARE:config.software};
        if(config.game==='minecraft'&&config.software!=='default')env.TYPE=config.software.toUpperCase();
        const server=await provisionServer({ownerId:user.id,name:serverName,templateSlug,memoryMb:Number(plan.memory_mb),cpu:Number(plan.cpu_limit),diskMb:Number(plan.disk_mb),planId:plan.id,location:config.location,environment:env});
        await db.query("update orders set status='ACTIVE',server_id=$2,node_id=$3,primary_port=$4,provisioned_at=now(),failure_reason=null,updated_at=now() where id=$1",[order.id,server.id,server.node_id,server.primary_port]);
        return server;
      });
      if(!locked.acquired)return NextResponse.json({ok:false,pending:true,resumable:true,orderId:order.id,status:'PROVISIONING'},{status:202});
      const server=locked.value;
      const base=appBase();
      await Promise.allSettled([
        sendTemplateEmail('invoice_paid',user.email,{name:user.name,invoice_number:invoice,currency:plan.currency,amount:amount.toFixed(2),billing_url:base?`${base}/billing`:''}),
        sendTemplateEmail('server_ready',user.email,{name:user.name,server_name:serverName,node_name:server.node_name||'',server_url:base?`${base}/servers/${server.identifier}`:''}),
      ]);
      return NextResponse.json({ok:true,orderId:order.id,identifier:server.identifier,node:server.node_name,location:server.node_location},{status:201});
    }catch(e:any){
      const msg=String(e?.message||e).slice(0,700);
      const fail=await db.connect();
      try{
        await fail.query('begin');
        const state=await fail.query('select status from orders where id=$1 for update',[order.id]);
        if(state.rows[0]?.status!=='FAILED'&&state.rows[0]?.status!=='ACTIVE'){
          await fail.query("update orders set status='FAILED',failure_reason=$2,updated_at=now() where id=$1",[order.id,msg]);
          await fail.query("update invoices set status='REFUNDED' where order_id=$1 and status='PAID'",[order.id]);
        }
        await fail.query('commit');
      }catch{
        await fail.query('rollback').catch(()=>{});
      }finally{
        fail.release();
      }
      return NextResponse.json({error:`Test payment succeeded, but provisioning failed and the sandbox invoice was marked refunded: ${msg}`,orderId:order.id},{status:502});
    }
  }catch(e:any){
    console.error(e);
    return NextResponse.json({error:e.message||'Test payment failed'},{status:500});
  }
}
