import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {db} from '@/lib/db';

async function admin(){const u=await getCurrentUser();return u?.role==='ADMIN'?u:null}

export async function GET(req:NextRequest){
 const actor=await admin();if(!actor)return NextResponse.json({error:'Forbidden'},{status:403});
 const q=String(req.nextUrl.searchParams.get('q')||'').trim().slice(0,120);
 const state=String(req.nextUrl.searchParams.get('state')||'all').toUpperCase();
 const args:any[]=[];const where:string[]=[];
 if(q){args.push(`%${q}%`);where.push(`(u.name ilike $${args.length} or u.email ilike $${args.length})`)}
 if(['ACTIVE','BANNED','DELETED'].includes(state)){args.push(state);where.push(`u.account_status=$${args.length}`)}
 const {rows}=await db.query(`select u.id,u.name,u.email,u.role,u.credits,u.account_status,u.banned_at,u.ban_reason,u.created_at,u.last_login_at,u.email_verified_at,(select count(*)::int from servers s where s.owner_id=u.id and s.status<>'deleted') server_count,(select count(*)::int from orders o where o.user_id=u.id) order_count from users u ${where.length?'where '+where.join(' and '):''} order by u.created_at desc limit 200`,args);
 return NextResponse.json({users:rows},{headers:{'cache-control':'no-store'}})
}

export async function PATCH(req:NextRequest){
 const actor=await admin();if(!actor)return NextResponse.json({error:'Forbidden'},{status:403});
 const body=await req.json();const id=String(body.id||'');if(!id)return NextResponse.json({error:'User id is required'},{status:400});
 if(id===actor.id&&body.accountStatus&&body.accountStatus!=='ACTIVE')return NextResponse.json({error:'You cannot suspend your own admin account.'},{status:400});
 const role=body.role;const credits=body.credits;const status=body.accountStatus;const reason=String(body.reason||'').trim().slice(0,255);
 if(role!==undefined&&!['USER','ADMIN','SUPPORT','RESELLER'].includes(role))return NextResponse.json({error:'Invalid role'},{status:400});
 if(status!==undefined&&!['ACTIVE','BANNED'].includes(status))return NextResponse.json({error:'Invalid account status'},{status:400});
 const current=await db.query('select id,role,account_status from users where id=$1',[id]);if(!current.rows[0])return NextResponse.json({error:'User not found'},{status:404});
 await db.query(`update users set role=coalesce($2,role),credits=coalesce($3,credits),account_status=coalesce($4,account_status),banned_at=case when $4='BANNED' then now() when $4='ACTIVE' then null else banned_at end,ban_reason=case when $4='BANNED' then $5 when $4='ACTIVE' then '' else ban_reason end where id=$1`,[id,role??null,credits===undefined?null:Number(credits)||0,status??null,reason]);
 if(status==='BANNED')await db.query('delete from sessions where user_id=$1',[id]);
 await db.query(`insert into audit_events(user_id,event,subject_type,subject_id,metadata) values($1,$2,'user',$3,$4::jsonb)`,[actor.id,status==='BANNED'?'admin.user.ban':status==='ACTIVE'?'admin.user.unban':'admin.user.update',id,JSON.stringify({role,credits,status,reason})]);
 return NextResponse.json({ok:true})
}

export async function DELETE(req:NextRequest){
 const actor=await admin();if(!actor)return NextResponse.json({error:'Forbidden'},{status:403});
 const {id}=await req.json();if(!id)return NextResponse.json({error:'User id is required'},{status:400});if(id===actor.id)return NextResponse.json({error:'You cannot delete your own admin account.'},{status:400});
 const active=await db.query(`select count(*)::int n from servers where owner_id=$1 and status<>'deleted'`,[id]);if(Number(active.rows[0]?.n||0)>0)return NextResponse.json({error:'User still owns active services. Transfer or delete those services first.'},{status:409});
 const user=await db.query('select id,email from users where id=$1',[id]);if(!user.rows[0])return NextResponse.json({error:'User not found'},{status:404});
 await db.query('delete from users where id=$1',[id]);
 await db.query(`insert into audit_events(user_id,event,subject_type,subject_id,metadata) values($1,'admin.user.delete','user',$2,$3::jsonb)`,[actor.id,id,JSON.stringify({email:user.rows[0].email})]);
 return NextResponse.json({ok:true})
}
