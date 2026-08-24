import {NextResponse} from 'next/server';
import {consumeEmailVerification} from '@/lib/auth-challenges';
import {createSession} from '@/lib/auth';
import {sendTemplateEmail} from '@/lib/mail';

export const runtime='nodejs';

export async function POST(req:Request){
  try{
    const b=await req.json().catch(()=>({}));
    const user=await consumeEmailVerification({token:String(b.token||''),email:String(b.email||''),otp:String(b.otp||'')});
    if(!user)return NextResponse.json({error:'The verification code or link is invalid, expired, or has already been used.'},{status:400});
    const session=await createSession(user.id);
    await sendTemplateEmail('welcome',user.email,{name:user.name}).catch(e=>console.warn('[mail] welcome delivery failed',e?.message||e));
    const res=NextResponse.json({ok:true,user:{id:user.id,name:user.name,email:user.email,role:user.role,credits:user.credits,emailVerified:true}});
    res.cookies.set('crakhost_session',session,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:60*60*24*30});
    return res;
  }catch(e){console.error(e);return NextResponse.json({error:'Email verification service unavailable.'},{status:503})}
}
