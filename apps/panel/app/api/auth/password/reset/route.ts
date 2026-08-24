import {NextResponse} from 'next/server';
import {hashPassword} from '@/lib/auth';
import {consumePasswordReset} from '@/lib/auth-challenges';
import {sendTemplateEmail} from '@/lib/mail';

export const runtime='nodejs';

export async function POST(req:Request){
  try{
    const b=await req.json().catch(()=>({}));
    const password=String(b.password||'');
    if(password.length<10)return NextResponse.json({error:'Password must be at least 10 characters.'},{status:400});
    const user=await consumePasswordReset({token:String(b.token||''),email:String(b.email||''),otp:String(b.otp||'')},hashPassword(password));
    if(!user)return NextResponse.json({error:'The reset code or link is invalid, expired, or has already been used.'},{status:400});
    await sendTemplateEmail('password_changed',user.email,{name:user.name}).catch(e=>console.warn('[mail] password changed delivery failed',e?.message||e));
    return NextResponse.json({ok:true,message:'Password changed. You can sign in with the new password.'});
  }catch(e){console.error(e);return NextResponse.json({error:'Password reset service unavailable.'},{status:503})}
}
