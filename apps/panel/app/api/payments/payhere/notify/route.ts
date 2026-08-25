import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {audit} from '@/lib/audit';
import {emitWebhookEvent} from '@/lib/webhooks';
import {sendTemplateEmail} from '@/lib/mail';
import {nodeFetchForServer} from '@/lib/node';
import {money,notificationHash,payhereConfig,safeSignatureEqual} from '@/lib/payhere';

function value(form:FormData,key:string){return String(form.get(key)||'').trim()}
function baseUrl(){return String(process.env.APP_URL||process.env.PANEL_URL||(process.env.PANEL_DOMAIN?`https://${process.env.PANEL_DOMAIN}`:'')).trim().replace(/\/$/,'')}
function queueProvision(orderId:string){
  const secret=String(process.env.CRAKHOST_CRON_SECRET||'');if(secret.length<16)return;
  const base=String(process.env.PANEL_INTERNAL_URL||'http://127.0.0.1:4310').replace(/\/$/,'');
  setTimeout(()=>{void fetch(`${base}/api/billing/orders/${encodeURIComponent(orderId)}/resume`,{method:'POST',headers:{'x-crakhost-cron-secret':secret}}).then(async r=>{if(!r.ok&&r.status!==202&&r.status!==409)console.error('[payhere] automatic provisioning returned',r.status,await r.text())}).catch(e=>console.error('[payhere] automatic provisioning request failed',e))},0);
}

export async function POST(req:NextRequest){
  let cfg;try{cfg=payhereConfig()}catch{return new NextResponse('PayHere unavailable',{status:503})}
  const form=await req.formData().catch(()=>null);if(!form)return new NextResponse('Invalid payload',{status:400});
  const merchantId=value(form,'merchant_id'),orderId=value(form,'order_id'),amount=value(form,'payhere_amount'),currency=value(form,'payhere_currency').toUpperCase();
  const statusCode=value(form,'status_code'),signature=value(form,'md5sig'),paymentId=value(form,'payment_id'),method=value(form,'method'),statusMessage=value(form,'status_message');
  if(!merchantId||merchantId!==cfg.merchantId||!orderId||!amount||!currency||!statusCode||!signature)return new NextResponse('Invalid notification',{status:400});
  const expected=notificationHash(merchantId,orderId,amount,currency,statusCode,cfg.merchantSecret);
  if(!safeSignatureEqual(expected,signature))return new NextResponse('Invalid signature',{status:400});

  const q=await db.query(`select o.*,u.name customer_name,u.email customer_email,p.name plan_name,s.identifier,
    i.id invoice_id,i.number invoice_number,i.status invoice_status
    from orders o join users u on u.id=o.user_id left join plans p on p.id=o.plan_id left join servers s on s.id=o.server_id
    left join lateral(select id,number,status from invoices where order_id=o.id order by created_at desc limit 1)i on true
    where o.id=$1 and o.payment_method='payhere' limit 1`,[orderId]);
  const order=q.rows[0];if(!order)return new NextResponse('Unknown order',{status:404});
  if(money(order.amount)!==money(amount)||String(order.currency).toUpperCase()!==currency)return new NextResponse('Amount mismatch',{status:400});

  const gateway={paymentId,method,statusCode,statusMessage,amount:money(amount),currency,receivedAt:new Date().toISOString()};
  const c=await db.connect();let paidNow=false,latePaid=false,chargeback=false;
  try{
    await c.query('begin');
    const lock=await c.query('select status from orders where id=$1 for update',[orderId]);const current=String(lock.rows[0]?.status||'');
    await c.query(`update orders set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('payhere',$2::jsonb),updated_at=now() where id=$1`,[orderId,JSON.stringify(gateway)]);
    if(statusCode==='2'){
      if(current==='PENDING'){
        await c.query("update orders set status='PAID',paid_at=coalesce(paid_at,now()),updated_at=now() where id=$1",[orderId]);
        await c.query("update invoices set status='PAID',paid_at=coalesce(paid_at,now()) where order_id=$1 and status in ('DUE','VOID')",[orderId]);
        await c.query("insert into notifications(user_id,title,body,kind) values($1,'PayHere payment confirmed',$2,'success')",[order.user_id,`${order.plan_name||'Hosting'} payment is confirmed. Automatic provisioning has been queued.`]).catch(()=>{});
        paidNow=true;
      }else if(current==='CANCELLED'){
        await c.query("update invoices set status='PAID',paid_at=coalesce(paid_at,now()) where order_id=$1 and status in ('DUE','VOID')",[orderId]);
        await c.query("insert into notifications(user_id,title,body,kind) values($1,'Late PayHere payment received',$2,'warning')",[order.user_id,'A payment arrived after this order was cancelled. The order was not provisioned automatically; contact support for review/refund.']).catch(()=>{});
        latePaid=true;
      }
    }else if(statusCode==='0'){
      // Gateway still considers the payment pending; keep the local order/invoice open.
    }else if(statusCode==='-1'||statusCode==='-2'){
      if(current==='PENDING'){
        await c.query("update orders set status='CANCELLED',failure_reason=$2,updated_at=now() where id=$1",[orderId,statusMessage||`PayHere status ${statusCode}`]);
        await c.query("update invoices set status='VOID' where order_id=$1 and status='DUE'",[orderId]);
        await c.query("insert into notifications(user_id,title,body,kind) values($1,'PayHere payment not completed',$2,'warning')",[order.user_id,statusCode==='-1'?'The PayHere checkout was cancelled.':'PayHere reported that the payment failed.']).catch(()=>{});
      }
    }else if(statusCode==='-3'){
      await c.query("update invoices set status='REFUNDED' where order_id=$1 and status='PAID'",[orderId]);
      if(order.server_id)await c.query("update servers set billing_status='SUSPENDED',suspended=true,suspended_at=coalesce(suspended_at,now()),updated_at=now() where id=$1",[order.server_id]);
      await c.query("insert into notifications(user_id,title,body,kind) values($1,'Payment chargeback received',$2,'error')",[order.user_id,'PayHere reported a chargeback. Any linked service has been placed into billing suspension and requires staff review.']).catch(()=>{});
      chargeback=true;
    }
    await c.query('commit');
  }catch(e){await c.query('rollback').catch(()=>{});console.error('[payhere] callback settlement failed',e);return new NextResponse('Settlement failed',{status:500})}finally{c.release()}

  if(paidNow){
    await audit(order.user_id,'payment.payhere.confirmed','order',orderId,{paymentId,method,amount:money(amount),currency}).catch(()=>{});
    await emitWebhookEvent(order.user_id,'invoice.paid',{invoice_number:order.invoice_number,order_id:orderId,amount:Number(order.amount),currency,payment_method:'payhere',payment_id:paymentId}).catch(()=>null);
    const base=baseUrl();
    await sendTemplateEmail('invoice_paid',order.customer_email,{name:order.customer_name,invoice_number:order.invoice_number||'',currency,amount:money(amount),billing_url:base?`${base}/billing?payhere=${encodeURIComponent(orderId)}`:''}).catch(e=>console.warn('[mail] payhere receipt delivery failed',e?.message||e));
    queueProvision(orderId);
  }
  if(latePaid)await emitWebhookEvent(order.user_id,'payment.review_required',{order_id:orderId,payment_id:paymentId,reason:'late_success_after_cancel'}).catch(()=>null);
  if(chargeback){
    if(order.identifier)await nodeFetchForServer(order.identifier,`/v1/servers/${encodeURIComponent(order.identifier)}/action`,{method:'POST',body:JSON.stringify({action:'stop'})}).catch(()=>null);
    await audit(order.user_id,'payment.payhere.chargeback','order',orderId,{paymentId,amount:money(amount),currency}).catch(()=>{});
    await emitWebhookEvent(order.user_id,'payment.chargeback',{order_id:orderId,payment_id:paymentId,server:order.identifier||null}).catch(()=>null);
  }
  return new NextResponse('OK',{status:200});
}
