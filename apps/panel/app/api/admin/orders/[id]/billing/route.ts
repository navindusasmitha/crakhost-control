import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser,isStaff} from '@/lib/auth';
import {db} from '@/lib/db';
import {audit} from '@/lib/audit';

export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const user=await getCurrentUser();if(!isStaff(user))return NextResponse.json({error:'Forbidden'},{status:403});
  const {id}=await params;const b=await req.json().catch(()=>({}));const action=String(b.action||'');
  if(!['cancel_unpaid','void_due_invoice'].includes(action))return NextResponse.json({error:'Unsupported action'},{status:400});
  const c=await db.connect();let result:any=null;
  try{
    await c.query('begin');
    const oq=await c.query('select * from orders where id=$1 for update',[id]);const order=oq.rows[0];
    if(!order){await c.query('rollback');return NextResponse.json({error:'Order not found'},{status:404})}
    const iq=await c.query('select * from invoices where order_id=$1 order by created_at desc limit 1 for update',[id]);const invoice=iq.rows[0];
    if(action==='cancel_unpaid'){
      if(order.status!=='PENDING')throw new Error(`Only PENDING orders can be cancelled safely; current state is ${order.status}`);
      await c.query("update orders set status='CANCELLED',failure_reason='Cancelled by staff before payment',updated_at=now() where id=$1",[id]);
      if(invoice?.status==='DUE')await c.query("update invoices set status='VOID' where id=$1",[invoice.id]);
      await c.query("insert into notifications(user_id,title,body,kind) values($1,'Order cancelled','An unpaid hosting order was cancelled by staff. No payment was captured.','warning')",[order.user_id]).catch(()=>{});
      result={ok:true,status:'CANCELLED',invoiceStatus:invoice?.status==='DUE'?'VOID':invoice?.status||'NONE'};
    }else{
      if(!invoice)throw new Error('No invoice is linked to this order');
      if(invoice.status!=='DUE')throw new Error(`Only DUE invoices can be voided; current state is ${invoice.status}`);
      if(order.status==='PAID'||order.status==='PROVISIONING'||order.status==='ACTIVE')throw new Error('Cannot void an invoice for a paid/provisioned order');
      await c.query("update invoices set status='VOID' where id=$1",[invoice.id]);
      if(order.status==='PENDING')await c.query("update orders set status='CANCELLED',failure_reason='Invoice voided by staff',updated_at=now() where id=$1",[id]);
      result={ok:true,status:order.status==='PENDING'?'CANCELLED':order.status,invoiceStatus:'VOID'};
    }
    await c.query('commit');
    await audit(user!.id,`order.${action}`,'order',id,{previousStatus:order.status,invoice:invoice?.number||null,paymentMethod:order.payment_method||null}).catch(()=>{});
    return NextResponse.json(result);
  }catch(e:any){await c.query('rollback').catch(()=>{});return NextResponse.json({error:e.message||'Billing action failed'},{status:409})}finally{c.release()}
}
