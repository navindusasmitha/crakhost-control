import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser,isAdmin} from '@/lib/auth';
import {audit} from '@/lib/audit';
import {sendDirectEmail} from '@/lib/mail';

export async function POST(req:NextRequest){
  const user=await getCurrentUser();
  if(!isAdmin(user))return NextResponse.json({error:'Admin required'},{status:403});
  try{
    const b=await req.json();
    const to=String(b.to||'').trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))return NextResponse.json({error:'Enter a valid test recipient'},{status:400});
    const now=new Date().toISOString();
    const result=await sendDirectEmail(to,'CrakHost SMTP test',`<div style="font-family:Arial,sans-serif;background:#0b0d14;color:#eef1f7;padding:28px"><div style="max-width:600px;margin:auto;background:#121622;border:1px solid #252c40;border-radius:16px;padding:24px"><h1 style="margin-top:0;color:#fff">SMTP connection verified</h1><p>This test message was sent from the CrakHost admin mail center.</p><p style="color:#8b95aa">${now}</p></div></div>`,`CrakHost SMTP connection verified.\n${now}`);
    await audit(user!.id,'mail.test.send','mail','smtp',{to,sent:result.sent});
    if(!result.sent)return NextResponse.json({error:result.reason||'Mail delivery is disabled'},{status:409});
    return NextResponse.json({ok:true,messageId:'messageId' in result?result.messageId:''});
  }catch(e:any){
    await audit(user!.id,'mail.test.failed','mail','smtp',{error:String(e?.message||e).slice(0,300)}).catch(()=>{});
    return NextResponse.json({error:String(e?.message||'SMTP test failed')},{status:502});
  }
}
