import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {db} from '@/lib/db';

async function admin(){const u=await getCurrentUser();return u?.role==='ADMIN'?u:null}
const slugOk=(v:string)=>/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(v);

export async function GET(){
 const actor=await admin();if(!actor)return NextResponse.json({error:'Forbidden'},{status:403});
 const [plans,templates]=await Promise.all([
  db.query(`select id,slug,name,description,memory_mb,cpu_limit,disk_mb,price_monthly,currency,enabled,featured,sort_order,template_slug,created_at from plans order by enabled desc,sort_order,price_monthly`),
  db.query(`select slug,name,game_type,enabled from server_templates order by enabled desc,name`)
 ]);
 return NextResponse.json({plans:plans.rows,templates:templates.rows},{headers:{'cache-control':'no-store'}})
}

export async function POST(req:NextRequest){
 const actor=await admin();if(!actor)return NextResponse.json({error:'Forbidden'},{status:403});
 const b=await req.json();const slug=String(b.slug||'').trim().toLowerCase(),name=String(b.name||'').trim(),description=String(b.description||'').trim().slice(0,255),templateSlug=String(b.templateSlug||'minecraft').trim();
 const memory=Number(b.memoryMb),cpu=Number(b.cpuLimit),disk=Number(b.diskMb),price=Number(b.priceMonthly),currency=String(b.currency||'LKR').trim().toUpperCase().slice(0,8),sortOrder=Math.max(0,Math.min(10000,Number(b.sortOrder)||100)),featured=!!b.featured,enabled=b.enabled!==false;
 if(!slugOk(slug)||name.length<2)return NextResponse.json({error:'Valid slug and name are required.'},{status:400});
 if(!Number.isFinite(memory)||memory<512||memory>262144||!Number.isFinite(cpu)||cpu<=0||cpu>128||!Number.isFinite(disk)||disk<1000||disk>10000000||!Number.isFinite(price)||price<0)return NextResponse.json({error:'Invalid resource or price values.'},{status:400});
 const tq=await db.query('select slug from server_templates where slug=$1 limit 1',[templateSlug]);if(!tq.rows[0])return NextResponse.json({error:'Selected template does not exist.'},{status:400});
 try{
  const {rows}=await db.query(`insert into plans(slug,name,description,memory_mb,cpu_limit,disk_mb,price_monthly,currency,enabled,featured,sort_order,template_slug) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,[slug,name,description,Math.round(memory),cpu,Math.round(disk),price,currency,enabled,featured,sortOrder,templateSlug]);
  await db.query(`insert into audit_events(user_id,event,subject_type,subject_id,metadata) values($1,'admin.plan.create','plan',$2,$3::jsonb)`,[actor.id,rows[0].id,JSON.stringify({slug,name})]);
  return NextResponse.json({ok:true,plan:rows[0]},{status:201});
 }catch(e:any){if(String(e?.code)==='23505')return NextResponse.json({error:'Plan slug already exists.'},{status:409});throw e}
}

export async function PATCH(req:NextRequest){
 const actor=await admin();if(!actor)return NextResponse.json({error:'Forbidden'},{status:403});
 const b=await req.json();const id=String(b.id||'');if(!id)return NextResponse.json({error:'Plan id is required.'},{status:400});
 const current=await db.query('select * from plans where id=$1',[id]);if(!current.rows[0])return NextResponse.json({error:'Plan not found.'},{status:404});
 const p=current.rows[0];const name=b.name===undefined?p.name:String(b.name).trim(),description=b.description===undefined?p.description:String(b.description).trim().slice(0,255),templateSlug=b.templateSlug===undefined?p.template_slug:String(b.templateSlug).trim(),currency=b.currency===undefined?p.currency:String(b.currency).trim().toUpperCase().slice(0,8);
 const memory=b.memoryMb===undefined?Number(p.memory_mb):Number(b.memoryMb),cpu=b.cpuLimit===undefined?Number(p.cpu_limit):Number(b.cpuLimit),disk=b.diskMb===undefined?Number(p.disk_mb):Number(b.diskMb),price=b.priceMonthly===undefined?Number(p.price_monthly):Number(b.priceMonthly),sortOrder=b.sortOrder===undefined?Number(p.sort_order):Math.max(0,Math.min(10000,Number(b.sortOrder)||0)),featured=b.featured===undefined?p.featured:!!b.featured,enabled=b.enabled===undefined?p.enabled:!!b.enabled;
 if(name.length<2||memory<512||cpu<=0||disk<1000||price<0)return NextResponse.json({error:'Invalid plan values.'},{status:400});
 const tq=await db.query('select slug from server_templates where slug=$1 limit 1',[templateSlug]);if(!tq.rows[0])return NextResponse.json({error:'Selected template does not exist.'},{status:400});
 const {rows}=await db.query(`update plans set name=$2,description=$3,memory_mb=$4,cpu_limit=$5,disk_mb=$6,price_monthly=$7,currency=$8,enabled=$9,featured=$10,sort_order=$11,template_slug=$12 where id=$1 returning *`,[id,name,description,Math.round(memory),cpu,Math.round(disk),price,currency,enabled,featured,sortOrder,templateSlug]);
 await db.query(`insert into audit_events(user_id,event,subject_type,subject_id,metadata) values($1,'admin.plan.update','plan',$2,$3::jsonb)`,[actor.id,id,JSON.stringify({slug:rows[0].slug,enabled,featured})]);
 return NextResponse.json({ok:true,plan:rows[0]})
}

export async function DELETE(req:NextRequest){
 const actor=await admin();if(!actor)return NextResponse.json({error:'Forbidden'},{status:403});
 const {id}=await req.json();if(!id)return NextResponse.json({error:'Plan id is required.'},{status:400});
 const {rows}=await db.query(`update plans set enabled=false,featured=false where id=$1 returning id,slug,name`,[id]);if(!rows[0])return NextResponse.json({error:'Plan not found.'},{status:404});
 await db.query(`insert into audit_events(user_id,event,subject_type,subject_id,metadata) values($1,'admin.plan.disable','plan',$2,$3::jsonb)`,[actor.id,id,JSON.stringify({slug:rows[0].slug})]);
 return NextResponse.json({ok:true})
}
