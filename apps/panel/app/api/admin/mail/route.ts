import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser,isAdmin} from '@/lib/auth';
import {audit} from '@/lib/audit';
import {db} from '@/lib/db';
import {encryptMailSecret,mailAdminSnapshot} from '@/lib/mail';

export const dynamic='force-dynamic';

function email(v:string){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)}
function webUrl(v:string){try{const u=new URL(v);return u.protocol==='https:'||u.protocol==='http:'}catch{return false}}

export async function GET(){
  const user=await getCurrentUser();
  if(!isAdmin(user))return NextResponse.json({error:'Admin required'},{status:403});
  try{return NextResponse.json(await mailAdminSnapshot(),{headers:{'cache-control':'no-store'}})}
  catch(e:any){return NextResponse.json({error:String(e?.message||'Unable to load mail settings')},{status:500})}
}

export async function PATCH(req:NextRequest){
  const user=await getCurrentUser();
  if(!isAdmin(user))return NextResponse.json({error:'Admin required'},{status:403});
  try{
    const b=await req.json();
    const enabled=!!b.enabled;
    const host=String(b.host||'').trim().slice(0,255);
    const port=Number(b.port);
    const encryption=String(b.encryption||'STARTTLS').toUpperCase();
    const username=String(b.username||'').trim().slice(0,255);
    const fromName=String(b.fromName||'CrakHost').trim().slice(0,160);
    const fromEmail=String(b.fromEmail||'').trim().toLowerCase().slice(0,255);
    const replyTo=String(b.replyTo||'').trim().toLowerCase().slice(0,255);
    const logoUrl=String(b.logoUrl||'').trim().slice(0,1000);
    const rejectUnauthorized=b.rejectUnauthorized!==false;
    if(!host)return NextResponse.json({error:'SMTP host is required'},{status:400});
    if(!Number.isInteger(port)||port<1||port>65535)return NextResponse.json({error:'SMTP port must be between 1 and 65535'},{status:400});
    if(!['STARTTLS','SSL_TLS','NONE'].includes(encryption))return NextResponse.json({error:'Invalid SMTP encryption mode'},{status:400});
    if(!fromName)return NextResponse.json({error:'Sender name is required'},{status:400});
    if(!fromEmail||!email(fromEmail))return NextResponse.json({error:'A valid sender email is required'},{status:400});
    if(replyTo&&!email(replyTo))return NextResponse.json({error:'Reply-to email is not valid'},{status:400});
    if(!logoUrl||!webUrl(logoUrl))return NextResponse.json({error:'Brand logo must be a valid http(s) URL'},{status:400});

    let passwordSql='password_cipher';let passwordValue:any=null;
    if(b.clearPassword===true){passwordSql="$12";passwordValue=''}
    else if(typeof b.password==='string'&&b.password.length>0){passwordSql="$12";passwordValue=encryptMailSecret(b.password)}

    const values:any[]=[enabled,host,port,encryption,username,fromName,fromEmail,replyTo,rejectUnauthorized,logoUrl,user!.id];
    if(passwordValue!==null)values.push(passwordValue);
    await db.query(`
      update mail_settings set
        enabled=$1,host=$2,port=$3,encryption=$4,username=$5,
        from_name=$6,from_email=$7,reply_to=$8,reject_unauthorized=$9,logo_url=$10,
        updated_by=$11,updated_at=now(),password_cipher=${passwordSql}
      where id=1
    `,values);
    await audit(user!.id,'mail.settings.update','mail','smtp',{enabled,host,port,encryption,username:username?'configured':'',fromEmail,logoUrl,passwordChanged:passwordValue!==null});
    return NextResponse.json({ok:true,...await mailAdminSnapshot()},{headers:{'cache-control':'no-store'}});
  }catch(e:any){
    return NextResponse.json({error:String(e?.message||'Unable to save mail settings')},{status:500});
  }
}
