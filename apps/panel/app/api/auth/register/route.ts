import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { createSession, hashPassword } from '../../../../lib/auth';
import {sendTemplateEmail} from '../../../../lib/mail';
export const runtime='nodejs';

function panelUrl(){const raw=process.env.APP_URL||process.env.PANEL_URL||(process.env.PANEL_DOMAIN?`https://${process.env.PANEL_DOMAIN}`:'');return raw.replace(/\/$/,'')}

export async function POST(req:Request){
  try{
    const {name,email,password}=await req.json();
    if(typeof name!=='string'||name.trim().length<2) return NextResponse.json({error:'Name is too short.'},{status:400});
    if(typeof email!=='string'||!email.includes('@')) return NextResponse.json({error:'Enter a valid email.'},{status:400});
    if(typeof password!=='string'||password.length<10) return NextResponse.json({error:'Password must be at least 10 characters.'},{status:400});
    const {rows}=await db.query('insert into users(name,email,password_hash) values($1,lower($2),$3) returning id,name,email,role,credits',[name.trim(),email.trim(),hashPassword(password)]);
    const user=rows[0]; const token=await createSession(user.id);
    await sendTemplateEmail('welcome',user.email,{name:user.name,panel_url:panelUrl()}).catch(e=>console.warn('[mail] welcome delivery failed',e?.message||e));
    const res=NextResponse.json({ok:true,user},{status:201});
    res.cookies.set('crakhost_session',token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:60*60*24*30});
    return res;
  }catch(e:any){ if(e?.code==='23505') return NextResponse.json({error:'An account already exists with this email.'},{status:409}); console.error(e); return NextResponse.json({error:'Registration service unavailable.'},{status:503}) }
}
