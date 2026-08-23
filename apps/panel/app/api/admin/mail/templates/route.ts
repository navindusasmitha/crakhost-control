import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser,isAdmin} from '@/lib/auth';
import {audit} from '@/lib/audit';
import {db} from '@/lib/db';

export const dynamic='force-dynamic';

function keyOk(v:string){return /^[a-z0-9][a-z0-9_-]{1,79}$/.test(v)}

export async function GET(){
  const user=await getCurrentUser();
  if(!isAdmin(user))return NextResponse.json({error:'Admin required'},{status:403});
  const q=await db.query(`select key,name,description,subject,html_body,text_body,variables,enabled,system_template,updated_at from email_templates order by name`);
  return NextResponse.json({templates:q.rows},{headers:{'cache-control':'no-store'}});
}

export async function PUT(req:NextRequest){
  const user=await getCurrentUser();
  if(!isAdmin(user))return NextResponse.json({error:'Admin required'},{status:403});
  try{
    const b=await req.json();const key=String(b.key||'').trim().toLowerCase();
    if(!keyOk(key))return NextResponse.json({error:'Invalid template key'},{status:400});
    const current=await db.query('select * from email_templates where key=$1 limit 1',[key]);
    if(!current.rowCount)return NextResponse.json({error:'Template not found'},{status:404});
    const name=String(b.name||current.rows[0].name).trim().slice(0,140);
    const description=String(b.description??current.rows[0].description??'').trim().slice(0,255);
    const subject=String(b.subject??'').trim().slice(0,500);
    const htmlBody=String(b.htmlBody??'');const textBody=String(b.textBody??'');const enabled=b.enabled!==false;
    if(!name||!subject)return NextResponse.json({error:'Template name and subject are required'},{status:400});
    if(!htmlBody.trim()&&!textBody.trim())return NextResponse.json({error:'HTML or text body is required'},{status:400});
    await db.query(`update email_templates set name=$2,description=$3,subject=$4,html_body=$5,text_body=$6,enabled=$7,updated_by=$8,updated_at=now() where key=$1`,[key,name,description,subject,htmlBody,textBody,enabled,user!.id]);
    await audit(user!.id,'mail.template.update','email_template',key,{enabled,name});
    const q=await db.query(`select key,name,description,subject,html_body,text_body,variables,enabled,system_template,updated_at from email_templates where key=$1`,[key]);
    return NextResponse.json({ok:true,template:q.rows[0]});
  }catch(e:any){return NextResponse.json({error:String(e?.message||'Unable to update template')},{status:500})}
}
