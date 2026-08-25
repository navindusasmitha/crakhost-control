import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {preflightProvisioning,provisionServer} from '@/lib/provision';
import {audit} from '@/lib/audit';
import {emitWebhookEvent} from '@/lib/webhooks';
import {withOrderProvisionLock} from '@/lib/order-provision-lock';

function requestKey(req:NextRequest,b:any){return String(b.requestKey||req.headers.get('idempotency-key')||'').trim().slice(0,160)}
async function replay(userId:string,key:string){
  if(!key)return null;
  const {rows}=await db.query(`select o.id,o.status,o.failure_reason,s.identifier,n.name node_name,n.location node_location
    from orders o left join servers s on s.id=o.server_id left join nodes n on n.id=o.node_id
    where o.user_id=$1 and o.idempotency_key=$2 limit 1`,[userId,key]);
  const x=rows[0];if(!x)return null;
  if(x.status==='ACTIVE'&&x.identifier)return NextResponse.json({ok:true,replayed:true,orderId:x.id,identifier:x.identifier,node:x.node_name,location:x.node_location},{status:200});
  if(x.status==='FAILED')return NextResponse.json({error:`This order attempt already failed: ${x.failure_reason||'provisioning failed'}`,replayed:true,orderId:x.id},{status:409});
  if(x.status==='CANCELLED')return NextResponse.json({error:'This order attempt was cancelled.',replayed:true,orderId:x.id},{status:409});
  return NextResponse.json({ok:false,replayed:true,pending:true,resumable:true,orderId:x.id,status:x.status},{status:202});
}

export async function GET(){
  const u=await getCurrentUser();if(!u)return NextResponse.json({error:'Unauthorized'},{status:401});
  const {rows}=await db.query(`select o.*,p.name plan_name,s.identifier from orders o left join plans p on p.id=o.plan_id left join servers s on s.id=o.server_id where o.user_id=$1 order by o.created_at desc limit 50`,[u.id]);
  return NextResponse.json({orders:rows},{headers:{'cache-control':'no-store'}})
}

export async function POST(req:NextRequest){
  const u=await getCurrentUser();if(!u)return NextResponse.json({error:'Unauthorized'},{status:401});
  const b=await req.json().catch(()=>({}));const key=requestKey(req,b);const prior=await replay(u.id,key);if(prior)return prior;
  const pq=await db.query('select * from plans where id=$1 and enabled=true limit 1',[b.planId]);const p=pq.rows[0];if(!p)return NextResponse.json({error:'Plan not found'},{status:404});
  const amount=Number(p.price_monthly);const name=String(b.name||`${p.name} Server`).trim().slice(0,120);if(!name)return NextResponse.json({error:'Server name is required.'},{status:400});
  const templateSlug=String(p.template_slug||'minecraft');const nodeId=b.nodeId?String(b.nodeId):null;const port=b.port?Number(b.port):null;
  if(port!==null&&(!Number.isInteger(port)||port<1||port>65535))return NextResponse.json({error:'Invalid port.'},{status:400});
  try{await preflightProvisioning({templateSlug,memoryMb:Number(p.memory_mb),cpu:Number(p.cpu_limit),diskMb:Number(p.disk_mb),nodeId})}catch(e:any){return NextResponse.json({error:`Provisioning unavailable: ${String(e?.message||e)}`},{status:409})}
  if(Number(u.credits)<amount)return NextResponse.json({error:`Insufficient credits. Need ${p.currency} ${amount.toLocaleString()}.`},{status:402});

  const client=await db.connect();let order:any;let invoice='';
  try{
    await client.query('begin');
    const fresh=await client.query('select credits from users where id=$1 for update',[u.id]);if(Number(fresh.rows[0]?.credits)<amount)throw new Error('Insufficient credits');
    const metadata={checkout:'billing-orders',nodeId,preferredPort:port};
    const oq=await client.query(`insert into orders(user_id,plan_id,status,amount,currency,template_slug,server_name,payment_method,paid_at,metadata,idempotency_key) values($1,$2,'PAID',$3,$4,$5,$6,'wallet',now(),$7::jsonb,$8) returning *`,[u.id,p.id,amount,p.currency,templateSlug,name,JSON.stringify(metadata),key||null]);order=oq.rows[0];
    await client.query('update users set credits=credits-$2 where id=$1',[u.id,amount]);
    await client.query(`insert into wallet_transactions(user_id,amount,type,description,reference_type,reference_id) values($1,$2,'DEBIT',$3,'order',$4)`,[u.id,-amount,`Purchase: ${p.name}`,order.id]);
    invoice=`INV-${Date.now().toString(36).toUpperCase()}-${String(order.id).slice(0,6).toUpperCase()}`;
    await client.query(`insert into invoices(user_id,number,amount,currency,status,due_at,paid_at,order_id,description,kind) values($1,$2,$3,$4,'PAID',now(),now(),$5,$6,'ORDER')`,[u.id,invoice,amount,p.currency,order.id,`${p.name} hosting service - ${name}`]);
    await client.query('commit');
  }catch(e:any){
    await client.query('rollback').catch(()=>{});
    if(e?.code==='23505'&&key){const existing=await replay(u.id,key);if(existing)return existing;}
    return NextResponse.json({error:e.message||'Order failed'},{status:409});
  }finally{client.release()}

  try{
    const locked=await withOrderProvisionLock(order.id,async()=>{
      await db.query("update orders set status='PROVISIONING',updated_at=now() where id=$1 and status='PAID'",[order.id]);
      const s=await provisionServer({ownerId:u.id,name,templateSlug,memoryMb:Number(p.memory_mb),cpu:Number(p.cpu_limit),diskMb:Number(p.disk_mb),nodeId,port,planId:p.id});
      await db.query("update orders set status='ACTIVE',server_id=$2,node_id=$3,primary_port=$4,provisioned_at=now(),failure_reason=null,updated_at=now() where id=$1",[order.id,s.id,s.node_id,s.primary_port]);
      return s;
    });
    if(!locked.acquired)return NextResponse.json({ok:false,pending:true,resumable:true,orderId:order.id,status:'PROVISIONING'},{status:202});
    const s=locked.value;
    await db.query("insert into notifications(user_id,title,body,kind) values($1,'Server ready',$2,'success')",[u.id,`${name} has been provisioned on ${s.node_name}${s.node_location?` (${s.node_location})`:''}.`]).catch(()=>{});
    await audit(u.id,'order.provision','order',order.id,{server:s.identifier,plan:p.slug,source:'billing-orders'});
    await emitWebhookEvent(u.id,'invoice.paid',{invoice_number:invoice,order_id:order.id,amount,currency:p.currency,server:s.identifier}).catch(()=>null);
    await emitWebhookEvent(u.id,'server.provisioned',{server:s.identifier,name:s.name,node_id:s.node_id}).catch(()=>null);
    return NextResponse.json({ok:true,orderId:order.id,identifier:s.identifier,node:s.node_name,location:s.node_location},{status:201});
  }catch(e:any){
    const msg=String(e?.message||e).slice(0,800);const c=await db.connect();
    try{
      await c.query('begin');
      const state=await c.query('select status from orders where id=$1 for update',[order.id]);
      if(state.rows[0]?.status!=='FAILED'&&state.rows[0]?.status!=='ACTIVE'){
        await c.query("update orders set status='FAILED',failure_reason=$2,updated_at=now() where id=$1",[order.id,msg]);
        await c.query('update users set credits=credits+$2 where id=$1',[u.id,amount]);
        await c.query(`insert into wallet_transactions(user_id,amount,type,description,reference_type,reference_id) values($1,$2,'REFUND',$3,'order',$4)`,[u.id,amount,`Automatic refund: ${p.name} provisioning failed`,order.id]);
        await c.query("update invoices set status='REFUNDED' where order_id=$1 and status='PAID'",[order.id]);
      }
      await c.query('commit');
    }catch{await c.query('rollback').catch(()=>{})}finally{c.release()}
    return NextResponse.json({error:`Provisioning failed and credits were refunded: ${msg}`,orderId:order.id},{status:502});
  }
}
