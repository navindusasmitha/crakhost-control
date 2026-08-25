import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {audit} from '@/lib/audit';
import {sendTemplateEmail} from '@/lib/mail';
import {emitWebhookEvent} from '@/lib/webhooks';
import {preflightProvisioning,provisionServer} from '@/lib/provision';
import {withOrderProvisionLock} from '@/lib/order-provision-lock';

function appBase(){const raw=process.env.APP_URL||process.env.PANEL_URL||(process.env.PANEL_DOMAIN?`https://${process.env.PANEL_DOMAIN}`:'');return raw.replace(/\/$/,'')}
function validPort(v:any){const n=Number(v);return Number.isInteger(n)&&n>=1&&n<=65535?n:null}
function configFrom(order:any){
  const m=order.metadata&&typeof order.metadata==='object'?order.metadata:{};
  const game=String(m.game||'game').slice(0,30),software=String(m.software||'default').slice(0,80),location=String(m.location||'auto').slice(0,100);
  const nodeId=m.nodeId?String(m.nodeId):null,port=validPort(m.preferredPort);
  const environment:Record<string,string>={CRAKHOST_GAME:game,CRAKHOST_SOFTWARE:software};
  if(game==='minecraft'&&software!=='default')environment.TYPE=software.toUpperCase();
  return {game,software,location,nodeId,port,environment};
}
async function orderRow(id:string,userId:string){
  const {rows}=await db.query(`select o.*,p.slug plan_slug,p.name plan_name,p.memory_mb,p.cpu_limit,p.disk_mb,p.template_slug plan_template_slug,
    s.identifier,s.status server_status,n.name node_name,n.location node_location
    from orders o join plans p on p.id=o.plan_id
    left join servers s on s.id=o.server_id left join nodes n on n.id=s.node_id
    where o.id=$1 and o.user_id=$2 limit 1`,[id,userId]);
  return rows[0]||null;
}
function activeResponse(o:any,recovered=false){return NextResponse.json({ok:true,recovered,orderId:o.id,identifier:o.identifier,node:o.node_name,location:o.node_location,status:'ACTIVE'},{status:200})}

export async function POST(_req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const user=await getCurrentUser();if(!user)return NextResponse.json({error:'Sign in required'},{status:401});
  const {id}=await params;if(!id)return NextResponse.json({error:'Order id is required.'},{status:400});
  const first=await orderRow(id,user.id);if(!first)return NextResponse.json({error:'Order not found.'},{status:404});
  if(first.status==='ACTIVE'&&first.identifier)return activeResponse(first);
  if(first.status==='PENDING')return NextResponse.json({error:'This order has not been confirmed as paid yet.',code:'ORDER_UNPAID'},{status:409});
  if(['FAILED','CANCELLED'].includes(String(first.status)))return NextResponse.json({error:`This order is ${String(first.status).toLowerCase()} and cannot be resumed.`,code:'ORDER_FINAL'},{status:409});
  if(!['PAID','PROVISIONING'].includes(String(first.status)))return NextResponse.json({error:`Order state ${first.status} cannot be resumed.`,code:'ORDER_NOT_RESUMABLE'},{status:409});
  if(!['wallet','test_card','payhere'].includes(String(first.payment_method)))return NextResponse.json({error:'Automatic recovery is not enabled for this payment method. Contact support so payment settlement can be verified safely.',code:'PAYMENT_REVIEW_REQUIRED'},{status:409});

  const locked=await withOrderProvisionLock(id,async()=>{
    const order=await orderRow(id,user.id);if(!order)return {kind:'missing' as const};
    if(order.status==='ACTIVE'&&order.identifier)return {kind:'active' as const,order};
    if(!['PAID','PROVISIONING'].includes(String(order.status)))return {kind:'state' as const,status:String(order.status)};
    const config=configFrom(order),templateSlug=String(order.template_slug||order.plan_template_slug||'minecraft');

    if(!order.server_id){
      try{
        await preflightProvisioning({templateSlug,memoryMb:Number(order.memory_mb),cpu:Number(order.cpu_limit),diskMb:Number(order.disk_mb),nodeId:config.nodeId,location:config.location});
      }catch(e:any){
        return {kind:'retryable' as const,msg:String(e?.message||e).slice(0,700)};
      }
    }

    try{
      await db.query("update orders set status='PROVISIONING',updated_at=now() where id=$1 and status in ('PAID','PROVISIONING')",[id]);
      const server=await provisionServer({ownerId:user.id,name:String(order.server_name||`${order.plan_name} Server`).slice(0,120),templateSlug,memoryMb:Number(order.memory_mb),cpu:Number(order.cpu_limit),diskMb:Number(order.disk_mb),nodeId:config.nodeId,location:config.location,port:config.port,planId:order.plan_id,orderId:id,environment:config.environment});
      await db.query("update orders set status='ACTIVE',server_id=$2,node_id=$3,primary_port=$4,provisioned_at=coalesce(provisioned_at,now()),failure_reason=null,updated_at=now() where id=$1",[id,server.id,server.node_id,server.primary_port]);
      return {kind:'success' as const,server,order};
    }catch(e:any){
      const msg=String(e?.message||e).slice(0,800);const c=await db.connect();let refunded=false,reviewRequired=false;
      try{
        await c.query('begin');
        const state=await c.query('select status,payment_method,amount,currency from orders where id=$1 for update',[id]);
        const live=state.rows[0];
        if(live&&live.status!=='ACTIVE'&&live.status!=='FAILED'){
          await c.query("update orders set status='FAILED',failure_reason=$2,updated_at=now() where id=$1",[id,msg]);
          if(live.payment_method==='wallet'){
            await c.query('update users set credits=credits+$2 where id=$1',[user.id,Number(live.amount)]);
            await c.query(`insert into wallet_transactions(user_id,amount,type,description,reference_type,reference_id) values($1,$2,'REFUND',$3,'order',$4)`,[user.id,Number(live.amount),`Automatic refund: interrupted ${order.plan_name} provisioning failed`,id]);
            await c.query("update invoices set status='REFUNDED' where order_id=$1 and status='PAID'",[id]);
            refunded=true;
          }else if(live.payment_method==='test_card'){
            await c.query("update invoices set status='REFUNDED' where order_id=$1 and status='PAID'",[id]);
            refunded=true;
          }else if(live.payment_method==='payhere'){
            await c.query(`update orders set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('paymentReviewRequired',true) where id=$1`,[id]);
            reviewRequired=true;
          }
          const body=live.payment_method==='wallet'?`${order.server_name} could not be recovered. Your wallet payment was refunded automatically.`:live.payment_method==='test_card'?`${order.server_name} could not be recovered. The sandbox invoice was marked refunded.`:`${order.server_name} could not be provisioned after PayHere payment. Your payment remains recorded and staff must retry provisioning or process a gateway refund.`;
          await c.query("insert into notifications(user_id,title,body,kind) values($1,'Provisioning recovery failed',$2,'error')",[user.id,body]);
        }
        await c.query('commit');
      }catch{await c.query('rollback').catch(()=>{})}finally{c.release()}
      return {kind:'failed' as const,msg,refunded,reviewRequired,paymentMethod:String(order.payment_method),amount:Number(order.amount),currency:String(order.currency)};
    }
  });

  if(!locked.acquired)return NextResponse.json({ok:false,pending:true,resumable:true,orderId:id,status:'PROVISIONING',message:'Another request is already provisioning this order.'},{status:202});
  const result=locked.value;
  if(result.kind==='missing')return NextResponse.json({error:'Order not found.'},{status:404});
  if(result.kind==='state')return NextResponse.json({error:`Order state ${result.status} cannot be resumed.`},{status:409});
  if(result.kind==='active')return activeResponse(result.order);
  if(result.kind==='retryable')return NextResponse.json({error:`Provisioning is temporarily unavailable: ${result.msg}`,code:'PROVISIONING_RETRYABLE',paid:true,resumable:true,orderId:id},{status:409});
  if(result.kind==='failed'){
    if(result.refunded&&result.paymentMethod==='wallet')await sendTemplateEmail('payment_refunded',user.email,{name:user.name,server_name:first.server_name,currency:result.currency,amount:result.amount.toFixed(2),reason:result.msg,billing_url:appBase()?`${appBase()}/billing`:''}).catch(e=>console.warn('[mail] recovery refund delivery failed',e?.message||e));
    if(result.reviewRequired)await emitWebhookEvent(user.id,'payment.review_required',{order_id:id,payment_method:'payhere',reason:'provisioning_failed_after_payment',error:result.msg}).catch(()=>null);
    return NextResponse.json({error:result.reviewRequired?`PayHere payment remains confirmed, but provisioning failed and staff review is required: ${result.msg}`:`Provisioning recovery failed${result.paymentMethod==='wallet'?' and wallet payment was refunded':''}: ${result.msg}`,code:result.reviewRequired?'PAYMENT_REVIEW_REQUIRED':'PROVISIONING_FAILED',paid:true,reviewRequired:result.reviewRequired,orderId:id},{status:502});
  }

  const server=result.server;
  await db.query("insert into notifications(user_id,title,body,kind) values($1,'Server recovered',$2,'success')",[user.id,`${result.order.server_name} provisioning resumed successfully on ${server.node_name}${server.node_location?` (${server.node_location})`:''}.`]).catch(()=>{});
  await audit(user.id,'order.provision.resume','order',id,{server:server.identifier,nodeId:server.node_id,paymentMethod:result.order.payment_method}).catch(()=>{});
  await emitWebhookEvent(user.id,'server.provisioned',{server:server.identifier,name:server.name,node_id:server.node_id,recovered:true}).catch(()=>null);
  const base=appBase();
  await sendTemplateEmail('server_ready',user.email,{name:user.name,server_name:result.order.server_name,node_name:server.node_name||'',server_url:base?`${base}/servers/${server.identifier}`:''}).catch(e=>console.warn('[mail] recovery server-ready delivery failed',e?.message||e));
  return NextResponse.json({ok:true,recovered:true,orderId:id,identifier:server.identifier,node:server.node_name,location:server.node_location,status:'ACTIVE'},{status:200});
}
