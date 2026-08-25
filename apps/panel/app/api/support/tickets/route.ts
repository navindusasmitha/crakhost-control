import {NextRequest,NextResponse} from 'next/server';
import{db}from'@/lib/db';
import{getCurrentUser,isStaff}from'@/lib/auth';

export async function GET(){
 const u=await getCurrentUser();if(!u)return NextResponse.json({error:'Unauthenticated'},{status:401});
 const staff=isStaff(u);const{rows}=await db.query(`select t.id,t.subject,t.priority,t.status,t.created_at,t.updated_at,u.email owner_email,(select count(*)::int from support_messages m where m.ticket_id=t.id) messages from support_tickets t join users u on u.id=t.user_id ${staff?'':'where t.user_id=$1'} order by t.updated_at desc limit 100`,staff?[]:[u.id]);
 return NextResponse.json({tickets:rows,staff},{headers:{'cache-control':'no-store'}})
}

export async function POST(req:NextRequest){
 const u=await getCurrentUser();if(!u)return NextResponse.json({error:'Unauthenticated'},{status:401});
 const{subject,priority='NORMAL',message}=await req.json();
 if(typeof subject!=='string'||subject.trim().length<4||typeof message!=='string'||message.trim().length<2)return NextResponse.json({error:'Subject and message are required.'},{status:400});
 if(!['LOW','NORMAL','HIGH','URGENT'].includes(priority))return NextResponse.json({error:'Invalid priority.'},{status:400});
 const c=await db.connect();try{
  await c.query('begin');
  const{rows}=await c.query(`insert into support_tickets(user_id,subject,priority) values($1,$2,$3) returning id,subject,priority,status,created_at,updated_at`,[u.id,subject.trim().slice(0,180),priority]);
  const ticket={...rows[0],owner_email:u.email,messages:1};
  await c.query('insert into support_messages(ticket_id,user_id,body,staff_reply) values($1,$2,$3,false)',[ticket.id,u.id,message.trim()]);
  await c.query('commit');
  return NextResponse.json({ok:true,id:ticket.id,ticket},{status:201})
 }catch(e){await c.query('rollback');throw e}finally{c.release()}
}
