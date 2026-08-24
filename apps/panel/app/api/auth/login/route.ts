import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {createSession,verifyPassword} from '@/lib/auth';

export const runtime='nodejs';

export async function POST(req:Request){
  try{
    const {email,password}=await req.json();
    if(typeof email!=='string'||typeof password!=='string')return NextResponse.json({error:'Email and password are required.'},{status:400});
    const {rows}=await db.query('select id,name,email,password_hash,role,credits,email_verified_at,banned_at,ban_reason from users where lower(email)=lower($1) limit 1',[email.trim()]);
    const user=rows[0];
    if(!user||!verifyPassword(password,user.password_hash))return NextResponse.json({error:'Invalid email or password.'},{status:401});
    if(user.banned_at)return NextResponse.json({error:user.ban_reason?`Account suspended: ${user.ban_reason}`:'This account has been suspended. Contact support.',code:'ACCOUNT_BANNED'},{status:403});
    if(!user.email_verified_at)return NextResponse.json({error:'Verify your email before signing in.',code:'EMAIL_VERIFICATION_REQUIRED',email:user.email},{status:403});
    const token=await createSession(user.id);
    await db.query('update users set last_login_at=now() where id=$1',[user.id]).catch(()=>{});
    const res=NextResponse.json({ok:true,user:{id:user.id,name:user.name,email:user.email,role:user.role,credits:user.credits,emailVerified:true}});
    res.cookies.set('crakhost_session',token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:60*60*24*30});
    return res;
  }catch(e){console.error(e);return NextResponse.json({error:'Authentication service unavailable.'},{status:503})}
}
