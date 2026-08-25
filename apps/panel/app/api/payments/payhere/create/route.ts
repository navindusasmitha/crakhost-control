import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {preflightProvisioning} from '@/lib/provision';
import {checkoutHash,money,payhereConfig} from '@/lib/payhere';

function baseUrl(){
  const raw=String(process.env.APP_URL||process.env.PANEL_URL||(process.env.PANEL_DOMAIN?`https://${process.env.PANEL_DOMAIN}`:'')).trim().replace(/\/$/,'');
  if(!/^https?:\/\//i.test(raw)||/localhost|127\.0\.0\.1/i.test(raw))throw new Error('APP_URL must be a publicly reachable panel URL for PayHere callbacks');
  return raw;
}
function requestKey(req:NextRequest,b:any){return String(b.requestKey||req.headers.get('idempotency-key')||'').trim().slice(0,160)}
function splitName(v:string){const p=String(v||'Customer').trim().split(/\s+/).filter(Boolean);return {first:p[0]||'Customer',last:p.slice(1).join(' ')||'-'}}
function clean(v:any,n:number){return String(v||'').trim().slice(0,n)}

export async function POST(req:NextRequest){
  const user=await getCurrentUser();if(!user)return NextResponse.json({error:'Sign in required'},{status:401});
  let cfg;try{cfg=payhereConfig()}catch(e:any){return NextResponse.json({error:e.message},{status:503})}
  let app;try{app=baseUrl()}catch(e:any){return NextResponse.json({error:e.message},{status:503})}
  const b=await req.json().catch(()=>({}));
  const key=requestKey(req,b);if(!key)return NextResponse.json({error:'Checkout request key is required'},{status:400});
  const planSlug=clean(b.plan,100),serverName=clean(b.serverName,120);
  const phone=clean(b.phone,30),address=clean(b.address,180),city=clean(b.city,80),country=clean(b.country||'Sri Lanka',80);
  const game=clean(b.game||'game',30),location=clean(b.location||'auto',100),software=clean(b.software||'default',80);
  if(!serverName)return NextResponse.json({error:'Server name is required'},{status:400});
  if(!/^[+0-9][0-9+\s()-]{6,29}$/.test(phone)||!address||!city)return NextResponse.json({error:'Phone, address and city are required for PayHere checkout'},{status:400});

  const pq=await db.query('select * from plans where slug=$1 and enabled=true limit 1',[planSlug]);const plan=pq.rows[0];
  if(!plan)return NextResponse.json({error:'Plan not found'},{status:404});
  const currency=String(plan.currency||'LKR').toUpperCase();if(!['LKR','USD'].includes(currency))return NextResponse.json({error:`PayHere checkout is not enabled for ${currency}`},{status:400});
  const amount=Number(plan.price_monthly),templateSlug=String(plan.template_slug||game||'minecraft');
  try{await preflightProvisioning({templateSlug,memoryMb:Number(plan.memory_mb),cpu:Number(plan.cpu_limit),diskMb:Number(plan.disk_mb),location})}
  catch(e:any){return NextResponse.json({error:`Provisioning unavailable: ${String(e?.message||e)}`},{status:409})}

  let order:any=null;
  const existing=await db.query(`select o.*,p.name plan_name from orders o left join plans p on p.id=o.plan_id where o.user_id=$1 and o.idempotency_key=$2 limit 1`,[user.id,key]);
  if(existing.rows[0]){
    order=existing.rows[0];
    if(order.payment_method!=='payhere')return NextResponse.json({error:'This checkout key is already used by another payment method'},{status:409});
    if(['PAID','PROVISIONING','ACTIVE'].includes(String(order.status)))return NextResponse.json({ok:true,alreadyPaid:true,orderId:order.id,status:order.status,billingUrl:`${app}/billing?payhere=${encodeURIComponent(order.id)}`});
    if(order.status!=='PENDING')return NextResponse.json({error:`Existing PayHere order is ${order.status}. Start a new checkout attempt.`},{status:409});
  }else{
    const c=await db.connect();
    try{
      await c.query('begin');
      const metadata={checkout:'payhere',game,location,software,payhere:{sandbox:cfg.sandbox}};
      const oq=await c.query(`insert into orders(user_id,plan_id,status,amount,currency,template_slug,server_name,payment_method,metadata,idempotency_key) values($1,$2,'PENDING',$3,$4,$5,$6,'payhere',$7::jsonb,$8) returning *`,[user.id,plan.id,amount,currency,templateSlug,serverName,JSON.stringify(metadata),key]);
      order=oq.rows[0];
      const number=`INV-${Date.now().toString(36).toUpperCase()}-${String(order.id).slice(0,6).toUpperCase()}`;
      await c.query(`insert into invoices(user_id,order_id,number,amount,currency,status,due_at,description,kind) values($1,$2,$3,$4,$5,'DUE',now()+interval '1 day',$6,'ORDER')`,[user.id,order.id,number,amount,currency,`${plan.name} - ${serverName}`]);
      await c.query("insert into notifications(user_id,title,body,kind) values($1,'PayHere checkout created',$2,'info')",[user.id,`${plan.name} payment is waiting for PayHere confirmation.`]).catch(()=>{});
      await c.query('commit');
    }catch(e:any){
      await c.query('rollback').catch(()=>{});
      if(e?.code==='23505'){
        const x=await db.query('select * from orders where user_id=$1 and idempotency_key=$2 limit 1',[user.id,key]);order=x.rows[0];
        if(!order||order.payment_method!=='payhere'||order.status!=='PENDING')return NextResponse.json({error:'Checkout attempt already exists in another state'},{status:409});
      }else return NextResponse.json({error:e.message||'Unable to create PayHere order'},{status:500});
    }finally{c.release()}
  }

  const amountText=money(order.amount),names=splitName(user.name||'Customer');
  const fields={
    merchant_id:cfg.merchantId,
    return_url:`${app}/billing?payhere=${encodeURIComponent(order.id)}`,
    cancel_url:`${app}/checkout?payment=cancelled`,
    notify_url:`${app}/api/payments/payhere/notify`,
    first_name:names.first,last_name:names.last,email:user.email,phone,address,city,country,
    order_id:order.id,items:`${plan.name} - ${serverName}`,currency,amount:amountText,
    hash:checkoutHash(cfg.merchantId,order.id,amountText,currency,cfg.merchantSecret),
    custom_1:'crakhost',custom_2:String(user.id),
  };
  return NextResponse.json({ok:true,orderId:order.id,sandbox:cfg.sandbox,action:cfg.checkoutUrl,fields});
}
