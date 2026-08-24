import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser,isAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
import {audit} from '@/lib/audit';

export const dynamic='force-dynamic';
async function admin(){const u=await getCurrentUser();return isAdmin(u)?u:null}

export async function GET(){
  const actor=await admin();if(!actor)return NextResponse.json({error:'Forbidden'},{status:403});
  const {rows}=await db.query(`select u.id,u.name,u.email,u.role,u.credits,u.created_at,u.last_login_at,u.email_verified_at,u.banned_at,u.ban_reason,
    (select count(*)::int from servers s where s.owner_id=u.id and s.status<>'deleted') server_count,
    (select count(*)::int from orders o where o.user_id=u.id) order_count,
    (select count(*)::int from support_tickets t where t.user_id=u.id) ticket_count
    from users u order by u.created_at desc limit 250`);
  return NextResponse.json({users:rows},{headers:{'cache-control':'no-store'}});
}

export async function PATCH(req:NextRequest){
  const actor=await admin();if(!actor)return NextResponse.json({error:'Forbidden'},{status:403});
  const body=await req.json();const id=String(body.id||'');const role=String(body.role||'');const credits=Number(body.credits);const banned=body.banned===true;const reason=String(body.banReason||'').trim().slice(0,500);
  if(!id)return NextResponse.json({error:'User id is required.'},{status:400});
  if(!['USER','ADMIN','SUPPORT','RESELLER'].includes(role))return NextResponse.json({error:'Invalid role'},{status:400});
  if(!Number.isFinite(credits)||credits<0||credits>1000000000)return NextResponse.json({error:'Credits value is invalid.'},{status:400});
  if(actor.id===id&&banned)return NextResponse.json({error:'You cannot ban your own active admin account.'},{status:400});
  const target=await db.query('select id,email,role,banned_at from users where id=$1 limit 1',[id]);if(!target.rows[0])return NextResponse.json({error:'User not found.'},{status:404});
  if(target.rows[0].role==='ADMIN'&&(role!=='ADMIN'||banned)){
    const admins=await db.query("select count(*)::int n from users where role='ADMIN' and banned_at is null");
    if(Number(admins.rows[0]?.n||0)<=1)return NextResponse.json({error:'The last active administrator cannot be demoted or banned.'},{status:409});
  }
  const {rows}=await db.query(`update users set role=$2,credits=$3,banned_at=case when $4 then coalesce(banned_at,now()) else null end,ban_reason=case when $4 then $5 else '' end where id=$1 returning id,name,email,role,credits,banned_at,ban_reason`,[id,role,credits,banned,reason]);
  if(banned)await db.query('delete from sessions where user_id=$1',[id]);
  await audit(actor.id,banned?'admin.user.ban':'admin.user.update','user',id,{email:rows[0].email,role,credits,banned,reason:banned?reason:''});
  return NextResponse.json({ok:true,user:rows[0]});
}

export async function DELETE(req:NextRequest){
  const actor=await admin();if(!actor)return NextResponse.json({error:'Forbidden'},{status:403});
  const {id}=await req.json().catch(()=>({}));if(!id)return NextResponse.json({error:'User id is required.'},{status:400});if(actor.id===id)return NextResponse.json({error:'You cannot delete your own administrator account.'},{status:400});
  const target=await db.query('select id,email,role from users where id=$1 limit 1',[id]);const row=target.rows[0];if(!row)return NextResponse.json({error:'User not found.'},{status:404});
  if(row.role==='ADMIN'){
    const admins=await db.query("select count(*)::int n from users where role='ADMIN' and banned_at is null");
    if(Number(admins.rows[0]?.n||0)<=1)return NextResponse.json({error:'The last active administrator cannot be deleted.'},{status:409});
  }
  const refs=await db.query(`select
    (select count(*)::int from servers where owner_id=$1 and status<>'deleted') servers,
    (select count(*)::int from orders where user_id=$1) orders,
    (select count(*)::int from invoices where user_id=$1) invoices,
    (select count(*)::int from support_tickets where user_id=$1) tickets`,[id]);
  const r=refs.rows[0]||{};if(Number(r.servers)+Number(r.orders)+Number(r.invoices)+Number(r.tickets)>0)return NextResponse.json({error:'This customer has service, billing, or ticket history. Transfer/delete services and retain history, or ban the account instead.'},{status:409});
  await db.query('delete from users where id=$1',[id]);await audit(actor.id,'admin.user.delete','user',String(id),{email:row.email});
  return NextResponse.json({ok:true});
}
