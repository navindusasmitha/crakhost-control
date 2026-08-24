import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser,isAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
import {audit} from '@/lib/audit';

export const dynamic='force-dynamic';

function clean(body:any){
  return {
    id:String(body.id||''),
    slug:String(body.slug||'').trim().toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80),
    name:String(body.name||'').trim().slice(0,120),
    description:String(body.description||'').trim().slice(0,255),
    memoryMb:Number(body.memoryMb),cpu:Number(body.cpu),diskMb:Number(body.diskMb),price:Number(body.price),
    currency:String(body.currency||'LKR').trim().toUpperCase().slice(0,8),
    templateSlug:String(body.templateSlug||'minecraft').trim().slice(0,80),
    featured:!!body.featured,enabled:body.enabled!==false,sortOrder:Number(body.sortOrder)||100,
  };
}
function invalid(p:ReturnType<typeof clean>){
  if(!p.slug||!p.name)return 'Plan slug and name are required.';
  if(!Number.isInteger(p.memoryMb)||p.memoryMb<256||p.memoryMb>262144)return 'RAM must be between 256 MB and 262144 MB.';
  if(!Number.isFinite(p.cpu)||p.cpu<0.1||p.cpu>128)return 'CPU must be between 0.1 and 128 vCPU.';
  if(!Number.isInteger(p.diskMb)||p.diskMb<512||p.diskMb>10485760)return 'Disk must be between 512 MB and 10485760 MB.';
  if(!Number.isFinite(p.price)||p.price<0||p.price>100000000)return 'Price is invalid.';
  if(!/^[A-Z]{3,8}$/.test(p.currency))return 'Currency must be a valid code.';
  if(!Number.isInteger(p.sortOrder)||p.sortOrder<-10000||p.sortOrder>10000)return 'Sort order is invalid.';
  return '';
}
async function admin(){const u=await getCurrentUser();return isAdmin(u)?u:null}
async function templateExists(slug:string){const q=await db.query('select 1 from server_templates where slug=$1 limit 1',[slug]);return !!q.rowCount}

export async function GET(){
  const user=await admin();if(!user)return NextResponse.json({error:'Admin required'},{status:403});
  const {rows}=await db.query(`select p.id,p.slug,p.name,p.description,p.memory_mb,p.cpu_limit,p.disk_mb,p.price_monthly,p.currency,p.template_slug,p.featured,p.enabled,p.sort_order,p.created_at,
    (select count(*)::int from servers s where s.plan_id=p.id and s.status<>'deleted') server_count,
    (select count(*)::int from orders o where o.plan_id=p.id) order_count
    from plans p order by p.sort_order,p.price_monthly,p.created_at`);
  return NextResponse.json({plans:rows},{headers:{'cache-control':'no-store'}});
}

export async function POST(req:NextRequest){
  const user=await admin();if(!user)return NextResponse.json({error:'Admin required'},{status:403});
  try{
    const p=clean(await req.json());const err=invalid(p);if(err)return NextResponse.json({error:err},{status:400});
    if(!await templateExists(p.templateSlug))return NextResponse.json({error:'Selected deployment template does not exist.'},{status:400});
    const {rows}=await db.query(`insert into plans(slug,name,description,memory_mb,cpu_limit,disk_mb,price_monthly,currency,template_slug,featured,enabled,sort_order)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,[p.slug,p.name,p.description,p.memoryMb,p.cpu,p.diskMb,p.price,p.currency,p.templateSlug,p.featured,p.enabled,p.sortOrder]);
    await audit(user.id,'admin.plan.create','plan',rows[0].id,{slug:p.slug,name:p.name,price:p.price,currency:p.currency});
    return NextResponse.json({ok:true,plan:rows[0]},{status:201});
  }catch(e:any){if(e?.code==='23505')return NextResponse.json({error:'A plan with this slug already exists.'},{status:409});return NextResponse.json({error:String(e?.message||'Unable to create plan')},{status:500})}
}

export async function PATCH(req:NextRequest){
  const user=await admin();if(!user)return NextResponse.json({error:'Admin required'},{status:403});
  try{
    const p=clean(await req.json());if(!p.id)return NextResponse.json({error:'Plan id is required.'},{status:400});const err=invalid(p);if(err)return NextResponse.json({error:err},{status:400});
    if(!await templateExists(p.templateSlug))return NextResponse.json({error:'Selected deployment template does not exist.'},{status:400});
    const {rows}=await db.query(`update plans set slug=$2,name=$3,description=$4,memory_mb=$5,cpu_limit=$6,disk_mb=$7,price_monthly=$8,currency=$9,template_slug=$10,featured=$11,enabled=$12,sort_order=$13 where id=$1 returning *`,[p.id,p.slug,p.name,p.description,p.memoryMb,p.cpu,p.diskMb,p.price,p.currency,p.templateSlug,p.featured,p.enabled,p.sortOrder]);
    if(!rows[0])return NextResponse.json({error:'Plan not found.'},{status:404});
    await audit(user.id,'admin.plan.update','plan',p.id,{slug:p.slug,name:p.name,enabled:p.enabled,featured:p.featured});
    return NextResponse.json({ok:true,plan:rows[0]});
  }catch(e:any){if(e?.code==='23505')return NextResponse.json({error:'A plan with this slug already exists.'},{status:409});return NextResponse.json({error:String(e?.message||'Unable to update plan')},{status:500})}
}

export async function DELETE(req:NextRequest){
  const user=await admin();if(!user)return NextResponse.json({error:'Admin required'},{status:403});
  const {id}=await req.json().catch(()=>({}));if(!id)return NextResponse.json({error:'Plan id is required.'},{status:400});
  const refs=await db.query(`select (select count(*)::int from servers where plan_id=$1 and status<>'deleted') servers,(select count(*)::int from orders where plan_id=$1) orders`,[id]);
  if(Number(refs.rows[0]?.servers||0)>0||Number(refs.rows[0]?.orders||0)>0)return NextResponse.json({error:'This plan has service/order history. Disable it instead of deleting it.'},{status:409});
  const q=await db.query('delete from plans where id=$1 returning slug,name',[id]);if(!q.rows[0])return NextResponse.json({error:'Plan not found.'},{status:404});
  await audit(user.id,'admin.plan.delete','plan',String(id),q.rows[0]);return NextResponse.json({ok:true});
}
