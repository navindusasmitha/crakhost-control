import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {hashPassword} from '@/lib/auth';
import {issueAuthChallenge} from '@/lib/auth-challenges';
import {sendTemplateEmail} from '@/lib/mail';

export const runtime='nodejs';

function panelUrl(){const raw=process.env.APP_URL||process.env.PANEL_URL||(process.env.PANEL_DOMAIN?`https://${process.env.PANEL_DOMAIN}`:'');return raw.replace(/\/$/,'')}
function validEmail(value:string){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)}
function safeNext(value:unknown){const v=String(value||'');return v.startsWith('/')&&!v.startsWith('//')?v:''}

export async function POST(req:Request){
  try{
    const {name,email,password,next}=await req.json();
    const cleanName=String(name||'').trim();
    const cleanEmail=String(email||'').trim().toLowerCase();
    if(cleanName.length<2)return NextResponse.json({error:'Name is too short.'},{status:400});
    if(!validEmail(cleanEmail))return NextResponse.json({error:'Enter a valid email.'},{status:400});
    if(typeof password!=='string'||password.length<10)return NextResponse.json({error:'Password must be at least 10 characters.'},{status:400});

    const {rows}=await db.query('insert into users(name,email,password_hash,email_verified_at) values($1,$2,$3,null) returning id,name,email,role,credits,email_verified_at',[cleanName,cleanEmail,hashPassword(password)]);
    const user=rows[0];
    const challenge=await issueAuthChallenge(user.id,'EMAIL_VERIFY',{ttlMinutes:20,minIntervalSeconds:0});
    const base=panelUrl();
    const params=new URLSearchParams({token:challenge.token});
    const nextPath=safeNext(next);if(nextPath)params.set('next',nextPath);
    const verifyPath=`/verify-email?${params.toString()}`;
    const delivery=await sendTemplateEmail('email_verification',user.email,{name:user.name,otp:challenge.otp,verify_url:base?`${base}${verifyPath}`:verifyPath,expires_minutes:challenge.expiresMinutes,panel_url:base}).catch(e=>{console.warn('[mail] verification delivery failed',e?.message||e);return {sent:false}});
    return NextResponse.json({ok:true,verificationRequired:true,email:user.email,mailSent:!!(delivery as any)?.sent},{status:201});
  }catch(e:any){
    if(e?.code==='23505')return NextResponse.json({error:'An account already exists with this email.'},{status:409});
    console.error(e);return NextResponse.json({error:'Registration service unavailable.'},{status:503});
  }
}
