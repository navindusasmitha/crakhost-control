import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {audit} from '@/lib/audit';
import {emitWebhookEvent} from '@/lib/webhooks';
import {sendTemplateEmail} from '@/lib/mail';

function appBase(){const raw=process.env.APP_URL||process.env.PANEL_URL||(process.env.PANEL_DOMAIN?`https://${process.env.PANEL_DOMAIN}`:'');return raw.replace(/\/$/,'')}

export async function POST(_req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const user=await getCurrentUser();
  if(!user)return NextResponse.json({error:'Sign in required'},{status:401});
  const {id}=await params;
  if(!id)return NextResponse.json({error:'Order id is required.'},{status:400});

  const c=await db.connect();
  let paid:any=null;
  try{
    await c.query('begin');
    const oq=await c.query(`select o.*,p.name plan_name from orders o join plans p on p.id=o.plan_id where o.id=$1 and o.user_id=$2 limit 1 for update of o`,[id,user.id]);
    const order=oq.rows[0];
    if(!order){await c.query('rollback');return NextResponse.json({error:'Order not found.'},{status:404})}

    if(['PAID','PROVISIONING','ACTIVE'].includes(String(order.status))){
      await c.query('commit');
      return NextResponse.json({ok:true,alreadyPaid:true,orderId:id,status:order.status,resumable:order.status!=='ACTIVE'},{status:200});
    }
    if(order.status!=='PENDING'){await c.query('rollback');return NextResponse.json({error:`Order state ${order.status} cannot be paid.`,code:'ORDER_NOT_PAYABLE'},{status:409})}
    if(order.payment_method!=='wallet'){await c.query('rollback');return NextResponse.json({error:'This pending order is not configured for wallet payment.',code:'PAYMENT_METHOD_REVIEW'},{status:409})}

    const iq=await c.query(`select * from invoices where order_id=$1 and user_id=$2 and kind='ORDER' and status='DUE' order by created_at desc limit 1 for update`,[id,user.id]);
    const invoice=iq.rows[0];
    if(!invoice){await c.query('rollback');return NextResponse.json({error:'No payable due invoice is attached to this order. Contact support before retrying.',code:'INVOICE_NOT_DUE'},{status:409})}

    const amount=Number(order.amount);
    if(!Number.isFinite(amount)||amount<0){await c.query('rollback');return NextResponse.json({error:'Order amount is invalid.',code:'ORDER_AMOUNT_INVALID'},{status:409})}
    if(Number(invoice.amount)!==amount||String(invoice.currency)!==String(order.currency)){
      await c.query('rollback');
      return NextResponse.json({error:'Order and invoice totals do not match. Payment was not taken.',code:'BILLING_MISMATCH'},{status:409});
    }

    const uq=await c.query('select credits from users where id=$1 for update',[user.id]);
    const credits=Number(uq.rows[0]?.credits||0);
    if(credits<amount){
      await c.query('rollback');
      return NextResponse.json({error:`Insufficient wallet balance. Need ${order.currency} ${amount.toFixed(2)}; available ${order.currency} ${credits.toFixed(2)}.`,code:'INSUFFICIENT_WALLET',required:amount,available:credits},{status:402});
    }

    await c.query('update users set credits=credits-$2 where id=$1',[user.id,amount]);
    await c.query(`insert into wallet_transactions(user_id,amount,type,description,reference_type,reference_id) values($1,$2,'DEBIT',$3,'order',$4)`,[user.id,-amount,`Payment: ${order.plan_name} pending order`,id]);
    await c.query("update orders set status='PAID',paid_at=coalesce(paid_at,now()),failure_reason=null,updated_at=now() where id=$1",[id]);
    await c.query("update invoices set status='PAID',paid_at=coalesce(paid_at,now()) where id=$1",[invoice.id]);
    await c.query("insert into notifications(user_id,title,body,kind) values($1,'Order paid',$2,'success')",[user.id,`${order.server_name} is paid and ready for provisioning.`]);
    await c.query('commit');
    paid={order,invoice,amount};
  }catch(e:any){
    await c.query('rollback').catch(()=>{});
    return NextResponse.json({error:e?.message||'Unable to pay pending order.'},{status:500});
  }finally{c.release()}

  await audit(user.id,'order.payment.wallet','order',id,{invoice:paid.invoice.number,amount:paid.amount,currency:paid.order.currency,source:'pending-order'}).catch(()=>{});
  await emitWebhookEvent(user.id,'invoice.paid',{invoice_number:paid.invoice.number,order_id:id,amount:paid.amount,currency:paid.order.currency,payment_method:'wallet'}).catch(()=>null);
  const base=appBase();
  await sendTemplateEmail('invoice_paid',user.email,{name:user.name,invoice_number:paid.invoice.number,currency:paid.order.currency,amount:paid.amount.toFixed(2),billing_url:base?`${base}/billing`:''}).catch(e=>console.warn('[mail] pending invoice paid delivery failed',e?.message||e));
  return NextResponse.json({ok:true,paid:true,resumable:true,orderId:id,invoice:paid.invoice.number,status:'PAID'},{status:200});
}
