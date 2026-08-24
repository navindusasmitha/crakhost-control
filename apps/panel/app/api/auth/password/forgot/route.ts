import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {ChallengeRateLimitError,issueAuthChallenge} from '@/lib/auth-challenges';
import {sendTemplateEmail} from '@/lib/mail';

export const runtime='nodejs';

function panelUrl(){const raw=process.env.APP_URL||process.env.PANEL_URL||(process.env.PANEL_DOMAIN?`https://${process.env.PANEL_DOMAIN}`:'');return raw.replace(/\/$/,'')}

export async function POST(req:Request){
  const generic={ok:true,message:'If an account exists for that email, a password reset code has been sent.'};
  try{
    const b=await req.json().catch(()=>({}));
    const email=String(b.email||'').trim().toLowerCase();
    if(!email)return NextResponse.json({error:'Email is required.'},{status:400});
    const q=await db.query(`select id,name,email from users where lower(email)=lower($1) limit 1`,[email]);
    const user=q.rows[0];
    if(!user)return NextResponse.json(generic);
    try{
      const challenge=await issueAuthChallenge(user.id,'PASSWORD_RESET',{ttlMinutes:15,minIntervalSeconds:60});
      const base=panelUrl();const path=`/reset-password?token=${encodeURIComponent(challenge.token)}&email=${encodeURIComponent(user.email)}`;
      await sendTemplateEmail('password_reset_otp',user.email,{name:user.name,otp:challenge.otp,reset_url:base?`${base}${path}`:path,expires_minutes:challenge.expiresMinutes,panel_url:base});
    }catch(e:any){
      if(!(e instanceof ChallengeRateLimitError))console.warn('[auth] password reset delivery failed',e?.message||e);
    }
    return NextResponse.json(generic);
  }catch(e){console.error(e);return NextResponse.json(generic)}
}
