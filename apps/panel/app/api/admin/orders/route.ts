import {NextResponse} from 'next/server';
import {getCurrentUser,isStaff} from '@/lib/auth';
import {db} from '@/lib/db';

export const dynamic='force-dynamic';

export async function GET(){
  const user=await getCurrentUser();
  if(!isStaff(user))return NextResponse.json({error:'Forbidden'},{status:403});
  const {rows}=await db.query(`
    select o.id,o.status,o.amount,o.currency,o.server_name,o.template_slug,o.failure_reason,o.created_at,o.updated_at,
           u.name customer_name,u.email customer_email,p.name plan_name,p.slug plan_slug,
           s.identifier,s.status server_status,n.name node_name,
           coalesce(i.status,'NONE') invoice_status,i.id invoice_id,i.number invoice_number,i.due_at invoice_due_at,i.paid_at invoice_paid_at,i.kind invoice_kind,
           coalesce(o.payment_method,'') payment_method,o.paid_at order_paid_at
    from orders o
    join users u on u.id=o.user_id
    left join plans p on p.id=o.plan_id
    left join servers s on s.id=o.server_id
    left join nodes n on n.id=coalesce(o.node_id,s.node_id)
    left join lateral (
      select id,status,number,due_at,paid_at,kind from invoices where order_id=o.id order by created_at desc limit 1
    ) i on true
    order by o.created_at desc
    limit 200
  `);
  const summary={
    total:rows.length,
    pending:rows.filter((x:any)=>x.status==='PENDING').length,
    active:rows.filter((x:any)=>x.status==='ACTIVE').length,
    provisioning:rows.filter((x:any)=>x.status==='PROVISIONING').length,
    failed:rows.filter((x:any)=>x.status==='FAILED').length,
    dueInvoices:rows.filter((x:any)=>x.invoice_status==='DUE').length,
    refundedInvoices:rows.filter((x:any)=>x.invoice_status==='REFUNDED').length,
    revenue:rows.filter((x:any)=>x.invoice_status==='PAID').reduce((a:number,x:any)=>a+Number(x.amount||0),0)
  };
  return NextResponse.json({orders:rows,summary},{headers:{'cache-control':'no-store'}});
}
