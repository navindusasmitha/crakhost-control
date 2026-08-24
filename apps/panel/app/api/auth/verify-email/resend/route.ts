import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {ChallengeRateLimitError,issueAuthChallenge} from '@/lib/auth-challenges';
import {sendTemplateEmail} from '@/lib/mail';

export const runtime='nodejs';

function panelUrl(){const raw=process.env.APP_URL||process.env.PANEL_URL||(process.env.PANEL_DOMAIN?`https://${process.env.PANEL_DOMAIN}`:'');return raw.replace(/\/$/,'')}
function safeNext(value:unknown){const v=String(value||'');return v.startsWith('/')&&!v.startsWith('//')?v:''}

export async function POST(req:Request){
  try{
    const b=await req.json().catch(()=>({}));
    const email=String(b.email||'').trim().toLowerCase();
    if(!email)return NextResponse.json({error:'Email is required.'},{status:400});
    const q=await db.query(`select id,name,email,email_verified_at from users where lower(email)=lower($1) limit 1`,[email]);
    const user=q.rows[0];
    if(!user||user.email_verified_at)return NextResponse.json({ok:true,message:'If verification is required, a new code will be sent.'});
    const challenge=await issueAuthChallenge(user.id,'EMAIL_VERIFY',{ttlMinutes:20,minIntervalSeconds:60});
    const base=panelUrl();const params=new URLSearchParams({token:challenge.token});const next=safeNext(b.next);if(next)params.set('next',next);
    const path=`/verify-email?${params.toString()}`;
    await sendTemplateEmail('email_verification',user.email,{name:user.name,otp:challenge.otp,verify_url:base?`${base}${path}`:path,expires_minutes:challenge.expiresMinutes,panel_url:base});
    return NextResponse.json({ok:true,message:'A new verification code was sent.'});
  }catch(e:any){
    if(e instanceof ChallengeRateLimitError)return NextResponse.json({error:e.message,retryAfter:e.retryAfterSeconds},{status:429,headers:{'retry-after':String(e.retryAfterSeconds)}});
    console.error(e);return NextResponse.json({error:'Unable to resend verification email.'},{status:503});
  }
}
