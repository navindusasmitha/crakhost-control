import {timingSafeEqual} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';

function secretOk(got:string,expected:string){const a=Buffer.from(got),b=Buffer.from(expected);return a.length===b.length&&a.length>0&&timingSafeEqual(a,b)}
function ttlHours(){const n=Number(process.env.CRAKHOST_PENDING_ORDER_TTL_HOURS||24);return Number.isFinite(n)?Math.max(1,Math.min(720,Math.floor(n))):24}

export async function POST(req:NextRequest){
  const expected=String(process.env.CRAKHOST_CRON_SECRET||'');
  if(expected.length<16)return NextResponse.json({error:'Commerce cleanup secret is not configured'},{status:503});
  if(!secretOk(String(req.headers.get('x-crakhost-cron-secret')||''),expected))return NextResponse.json({error:'Forbidden'},{status:403});
  const hours=ttlHours(),c=await db.connect();let ids:string[]=[];
  try{
    await c.query('begin');
    const q=await c.query(`select id from orders where status='PENDING' and created_at<now()-($1::text||' hours')::interval order by created_at asc limit 500 for update skip locked`,[hours]);
    ids=q.rows.map((x:any)=>String(x.id));
    if(ids.length){
      await c.query("update orders set status='CANCELLED',failure_reason=case when failure_reason='' or failure_reason is null then 'Expired unpaid order' else failure_reason end,updated_at=now() where id=any($1::uuid[]) and status='PENDING'",[ids]);
      await c.query("update invoices set status='VOID' where order_id=any($1::uuid[]) and status='DUE'",[ids]);
      await c.query(`insert into notifications(user_id,title,body,kind)
        select user_id,'Unpaid order expired','An unpaid hosting order expired automatically. Start a new checkout when you are ready.','warning'
        from orders where id=any($1::uuid[])`,[ids]);
    }
    await c.query('commit');
  }catch(e:any){await c.query('rollback').catch(()=>{});return NextResponse.json({error:e.message||'Cleanup failed'},{status:500})}finally{c.release()}
  return NextResponse.json({ok:true,expired:ids.length,ttlHours:hours});
}
