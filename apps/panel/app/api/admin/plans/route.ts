import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {db} from '@/lib/db';

async function admin(){const u=await getCurrentUser();return u?.role==='ADMIN'}
const slugOk=(v:string)=>/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(v);
function number(v:any,min:number,max:number){const n=Number(v);return Number.isFinite(n)&&n>=min&&n<=max?n:null}
async function templateExists(slug:string){const q=await db.query('select 1 from server_templates where slug=$1 and enabled=true limit 1',[slug]);return !!q.rows[0]}

export async function GET(){
  if(!await admin())return NextResponse.json({error:'Forbidden'},{status:403});
  const {rows}=await db.query(`select p.id,p.slug,p.name,p.description,p.memory_mb,p.cpu_limit,p.disk_mb,p.price_monthly,p.currency,p.enabled,p.template_slug,p.featured,p.sort_order,p.created_at,
    (select count(*)::int from servers s where s.plan_id=p.id and s.status<>'deleted') service_count,
    (select count(*)::int from orders o where o.plan_id=p.id and o.status not in ('CANCELLED','FAILED')) order_count
    from plans p order by p.sort_order,p.price_monthly,p.created_at`);
  return NextResponse.json({plans:rows},{headers:{'cache-control':'no-store'}})
}

export async function POST(req:NextRequest){
  if(!await admin())return NextResponse.json({error:'Forbidden'},{status:403});
  const b=await req.json();const slug=String(b.slug||'').trim().toLowerCase(),name=String(b.name||'').trim(),description=String(b.description||'').trim(),templateSlug=String(b.template_slug||'minecraft').trim();
  const memory=number(b.memory_mb,512,131072),cpu=number(b.cpu_limit,0.25,64),disk=number(b.disk_mb,1024,2097152),price=number(b.price_monthly,0,100000000),sort=number(b.sort_order??100,0,100000);
  if(!slugOk(slug)||name.length<2||name.length>120)return NextResponse.json({error:'Enter a valid plan slug and name.'},{status:400});
  if(memory===null||cpu===null||disk===null||price===null||sort===null)return NextResponse.json({error:'Plan resources, price or sort order are invalid.'},{status:400});
  if(!await templateExists(templateSlug))return NextResponse.json({error:'Choose an enabled deployment template.'},{status:400});
  try{const {rows}=await db.query(`insert into plans(slug,name,description,memory_mb,cpu_limit,disk_mb,price_monthly,currency,enabled,template_slug,featured,sort_order) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,[slug,name,description.slice(0,255),memory,cpu,disk,price,String(b.currency||'LKR').trim().toUpperCase().slice(0,8),b.enabled!==false,templateSlug,!!b.featured,sort]);return NextResponse.json({ok:true,plan:rows[0]},{status:201})}catch(e:any){if(e?.code==='23505')return NextResponse.json({error:'A plan with this slug already exists.'},{status:409});throw e}
}

export async function PATCH(req:NextRequest){
  if(!await admin())return NextResponse.json({error:'Forbidden'},{status:403});
  const b=await req.json();const id=String(b.id||''),name=String(b.name||'').trim(),description=String(b.description||'').trim(),templateSlug=String(b.template_slug||'minecraft').trim();
  const memory=number(b.memory_mb,512,131072),cpu=number(b.cpu_limit,0.25,64),disk=number(b.disk_mb,1024,2097152),price=number(b.price_monthly,0,100000000),sort=number(b.sort_order??100,0,100000);
  if(!id||name.length<2||name.length>120||memory===null||cpu===null||disk===null||price===null||sort===null)return NextResponse.json({error:'Plan details are invalid.'},{status:400});
  if(!await templateExists(templateSlug))return NextResponse.json({error:'Choose an enabled deployment template.'},{status:400});
  const {rows}=await db.query(`update plans set name=$2,description=$3,memory_mb=$4,cpu_limit=$5,disk_mb=$6,price_monthly=$7,currency=$8,enabled=$9,template_slug=$10,featured=$11,sort_order=$12 where id=$1 returning *`,[id,name,description.slice(0,255),memory,cpu,disk,price,String(b.currency||'LKR').trim().toUpperCase().slice(0,8),!!b.enabled,templateSlug,!!b.featured,sort]);
  if(!rows[0])return NextResponse.json({error:'Plan not found.'},{status:404});return NextResponse.json({ok:true,plan:rows[0]})
}

export async function DELETE(req:NextRequest){
  if(!await admin())return NextResponse.json({error:'Forbidden'},{status:403});
  const id=String(req.nextUrl.searchParams.get('id')||'');if(!id)return NextResponse.json({error:'Plan id is required.'},{status:400});
  const q=await db.query(`select p.id,(select count(*)::int from servers s where s.plan_id=p.id and s.status<>'deleted') services,(select count(*)::int from orders o where o.plan_id=p.id and o.status not in ('CANCELLED','FAILED')) orders from plans p where p.id=$1 limit 1`,[id]);
  const plan=q.rows[0];if(!plan)return NextResponse.json({error:'Plan not found.'},{status:404});
  if(Number(plan.services)>0||Number(plan.orders)>0)return NextResponse.json({error:'This plan is still attached to active services or orders. Disable it instead.'},{status:409});
  await db.query('delete from plans where id=$1',[id]);return NextResponse.json({ok:true})
}
