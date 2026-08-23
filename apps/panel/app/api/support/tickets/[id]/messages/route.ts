import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {getCurrentUser,isStaff} from '@/lib/auth';
import {sendTemplateEmail} from '@/lib/mail';

function appBase(){const raw=process.env.APP_URL||process.env.PANEL_URL||(process.env.PANEL_DOMAIN?`https://${process.env.PANEL_DOMAIN}`:'');return raw.replace(/\/$/,'')}
async function access(id:string,u:any){const{rows}=await db.query('select * from support_tickets where id=$1 limit 1',[id]);const t=rows[0];return t&&(t.user_id===u.id||isStaff(u))?t:null}

export async function GET(_:NextRequest,{params}:{params:Promise<{id:string}>}){
  const u=await getCurrentUser();if(!u)return NextResponse.json({error:'Unauthenticated'},{status:401});
  const{id}=await params,t=await access(id,u);if(!t)return NextResponse.json({error:'Not found'},{status:404});
  const{rows}=await db.query(`select m.id,m.body,m.staff_reply,m.created_at,u.name,u.email from support_messages m left join users u on u.id=m.user_id where m.ticket_id=$1 order by m.created_at`,[id]);
  return NextResponse.json({ticket:t,messages:rows});
}

export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const u=await getCurrentUser();if(!u)return NextResponse.json({error:'Unauthenticated'},{status:401});
  const{id}=await params,t=await access(id,u);if(!t)return NextResponse.json({error:'Not found'},{status:404});
  const{message,status}=await req.json();
  if(status==='CLOSED'){await db.query('update support_tickets set status=$2,updated_at=now() where id=$1',[id,'CLOSED']);return NextResponse.json({ok:true})}
  if(typeof message!=='string'||!message.trim())return NextResponse.json({error:'Message required'},{status:400});
  const staff=isStaff(u);const clean=message.trim();
  await db.query('insert into support_messages(ticket_id,user_id,body,staff_reply) values($1,$2,$3,$4)',[id,u.id,clean,staff]);
  await db.query('update support_tickets set status=$2,updated_at=now() where id=$1',[id,staff?'ANSWERED':'CUSTOMER_REPLY']);
  if(staff){
    const owner=await db.query('select name,email from users where id=$1 limit 1',[t.user_id]);const customer=owner.rows[0];const base=appBase();
    if(customer?.email)await sendTemplateEmail('support_reply',customer.email,{name:customer.name,ticket_subject:t.subject,message:clean,support_url:base?`${base}/support`:''}).catch(e=>console.warn('[mail] support reply delivery failed',e?.message||e));
  }
  return NextResponse.json({ok:true});
}
