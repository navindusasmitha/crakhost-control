import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser,isStaff} from '@/lib/auth';
import {db} from '@/lib/db';
import {provisionServer} from '@/lib/provision';
import {audit} from '@/lib/audit';

export async function POST(_req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const admin=await getCurrentUser();
  if(!isStaff(admin))return NextResponse.json({error:'Forbidden'},{status:403});
  const {id}=await params;
  const claim=await db.query(`
    update orders o set status='PROVISIONING',failure_reason='',updated_at=now()
    where o.id=$1 and o.server_id is null and o.status in ('FAILED','PAID')
      and exists(select 1 from invoices i where i.order_id=o.id and i.status='PAID')
    returning o.*
  `,[id]);
  const order=claim.rows[0];
  if(!order){
    const q=await db.query(`select o.status,o.server_id,coalesce(i.status,'NONE') invoice_status from orders o left join lateral(select status from invoices where order_id=o.id order by created_at desc limit 1)i on true where o.id=$1`,[id]);
    if(!q.rowCount)return NextResponse.json({error:'Order not found'},{status:404});
    const x=q.rows[0];
    if(x.server_id)return NextResponse.json({error:'Order already has a provisioned server.'},{status:409});
    if(x.invoice_status!=='PAID')return NextResponse.json({error:'Retry blocked because this order does not have a paid invoice.'},{status:409});
    return NextResponse.json({error:`Order is ${x.status}; another provisioning attempt may already be running.`},{status:409});
  }
  try{
    const pq=await db.query('select * from plans where id=$1 limit 1',[order.plan_id]);
    const plan=pq.rows[0];
    if(!plan)throw new Error('Plan no longer exists.');
    const meta=order.metadata||{};
    const env:any={};
    if(meta.game)env.CRAKHOST_GAME=String(meta.game);
    if(meta.software){env.CRAKHOST_SOFTWARE=String(meta.software);if(meta.game==='minecraft'&&meta.software!=='default')env.TYPE=String(meta.software).toUpperCase()}
    const server=await provisionServer({ownerId:order.user_id,name:order.server_name,templateSlug:order.template_slug||plan.template_slug||'minecraft',memoryMb:Number(plan.memory_mb),cpu:Number(plan.cpu_limit),diskMb:Number(plan.disk_mb),planId:plan.id,location:meta.location||null,environment:env});
    await db.query("update orders set status='ACTIVE',server_id=$2,node_id=$3,primary_port=$4,provisioned_at=coalesce(provisioned_at,now()),updated_at=now() where id=$1",[id,server.id,server.node_id,server.primary_port]);
    await audit(admin!.id,'order.retry.success','order',id,{server:server.identifier});
    return NextResponse.json({ok:true,identifier:server.identifier,node:server.node_name});
  }catch(e:any){
    const msg=String(e?.message||e).slice(0,800);
    await db.query("update orders set status='FAILED',failure_reason=$2,updated_at=now() where id=$1 and server_id is null",[id,msg]);
    await audit(admin!.id,'order.retry.failed','order',id,{error:msg}).catch(()=>null);
    return NextResponse.json({error:msg},{status:502});
  }
}
