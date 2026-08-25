import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {db} from '@/lib/db';

async function requireAdmin(){const u=await getCurrentUser();return u?.role==='ADMIN'?u:null}

export async function GET(){
  const admin=await requireAdmin();if(!admin)return NextResponse.json({error:'Forbidden'},{status:403});
  const {rows}=await db.query(`
    select u.id,u.name,u.email,u.role,u.credits,u.created_at,u.last_login_at,u.email_verified_at,u.banned_at,u.banned_reason,
      (select count(*)::int from servers s where s.owner_id=u.id and s.status<>'deleted') server_count,
      (select count(*)::int from orders o where o.user_id=u.id and o.status not in ('CANCELLED','FAILED')) order_count
    from users u order by u.created_at desc limit 200
  `);
  return NextResponse.json({users:rows},{headers:{'cache-control':'no-store'}})
}

export async function PATCH(req:NextRequest){
  const admin=await requireAdmin();if(!admin)return NextResponse.json({error:'Forbidden'},{status:403});
  const body=await req.json();const id=String(body.id||'');if(!id)return NextResponse.json({error:'User id is required.'},{status:400});
  if(id===admin.id&&body.action==='ban')return NextResponse.json({error:'You cannot ban your own account.'},{status:400});
  if(body.action==='ban'||body.action==='unban'){
    const target=await db.query('select id,role from users where id=$1 limit 1',[id]);
    if(!target.rows[0])return NextResponse.json({error:'User not found.'},{status:404});
    if(target.rows[0].role==='ADMIN'&&body.action==='ban')return NextResponse.json({error:'Demote an administrator before banning the account.'},{status:409});
    const c=await db.connect();try{await c.query('begin');if(body.action==='ban')await c.query('update users set banned_at=now(),banned_reason=$2 where id=$1',[id,String(body.reason||'Disabled by administrator').slice(0,255)]);else await c.query("update users set banned_at=null,banned_reason='' where id=$1",[id]);await c.query('delete from sessions where user_id=$1',[id]);await c.query('commit')}catch(e){await c.query('rollback');throw e}finally{c.release()}
    return NextResponse.json({ok:true,banned:body.action==='ban'});
  }
  const role=String(body.role||'');if(!['USER','ADMIN','SUPPORT','RESELLER'].includes(role))return NextResponse.json({error:'Invalid role'},{status:400});
  const credits=Number(body.credits);if(!Number.isFinite(credits)||credits<0)return NextResponse.json({error:'Credits must be a positive number.'},{status:400});
  await db.query('update users set role=$2,credits=$3 where id=$1',[id,role,credits]);
  return NextResponse.json({ok:true})
}

export async function DELETE(req:NextRequest){
  const admin=await requireAdmin();if(!admin)return NextResponse.json({error:'Forbidden'},{status:403});
  const id=String(req.nextUrl.searchParams.get('id')||'');if(!id)return NextResponse.json({error:'User id is required.'},{status:400});
  if(id===admin.id)return NextResponse.json({error:'You cannot delete your own account.'},{status:400});
  const target=await db.query(`select u.id,u.role,
    (select count(*)::int from servers s where s.owner_id=u.id and s.status<>'deleted') server_count,
    (select count(*)::int from orders o where o.user_id=u.id and o.status not in ('CANCELLED','FAILED')) order_count
    from users u where u.id=$1 limit 1`,[id]);
  const user=target.rows[0];if(!user)return NextResponse.json({error:'User not found.'},{status:404});
  if(user.role==='ADMIN')return NextResponse.json({error:'Demote an administrator before deleting the account.'},{status:409});
  if(Number(user.server_count)>0||Number(user.order_count)>0)return NextResponse.json({error:'This user still owns active services or orders. Transfer/delete those services first.'},{status:409});
  await db.query('delete from users where id=$1',[id]);
  return NextResponse.json({ok:true})
}
