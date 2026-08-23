import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import {db} from './db';

type MailConfig={
  enabled:boolean;host:string;port:number;encryption:'STARTTLS'|'SSL_TLS'|'NONE';username:string;password:string;
  fromName:string;fromEmail:string;replyTo:string;rejectUnauthorized:boolean;
};
type TemplateRow={key:string;name:string;description:string;subject:string;html_body:string;text_body:string;variables:string[];enabled:boolean};
type Vars=Record<string,string|number|null|undefined>;

function secretKey(){
  const secret=process.env.SESSION_SECRET||'';
  if(!secret)throw new Error('SESSION_SECRET is required for SMTP credential encryption');
  return createHash('sha256').update(secret).digest();
}
export function encryptMailSecret(value:string){
  if(!value)return '';
  const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',secretKey(),iv);
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);const tag=cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}
export function decryptMailSecret(value:string){
  if(!value)return '';
  const [version,ivRaw,tagRaw,dataRaw]=value.split(':');
  if(version!=='v1'||!ivRaw||!tagRaw||!dataRaw)throw new Error('Stored SMTP password has an unsupported format');
  const decipher=createDecipheriv('aes-256-gcm',secretKey(),Buffer.from(ivRaw,'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw,'base64url')),decipher.final()]).toString('utf8');
}

export async function getMailConfig():Promise<MailConfig>{
  const q=await db.query(`select * from mail_settings where id=1 limit 1`);const s=q.rows[0];
  if(!s)throw new Error('SMTP settings are not initialized; run database migrations');
  return {enabled:!!s.enabled,host:String(s.host||''),port:Number(s.port||587),encryption:s.encryption||'STARTTLS',username:String(s.username||''),password:decryptMailSecret(String(s.password_cipher||'')),fromName:String(s.from_name||'CrakHost'),fromEmail:String(s.from_email||''),replyTo:String(s.reply_to||''),rejectUnauthorized:s.reject_unauthorized!==false};
}

function cleanHeader(v:string){return v.replace(/[\r\n]+/g,' ').trim()}
function encodedHeader(v:string){const clean=cleanHeader(v);return /[^\x20-\x7E]/.test(clean)?`=?UTF-8?B?${Buffer.from(clean).toString('base64')}?=`:clean}
function escapeHtml(v:unknown){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c))}
function render(source:string,vars:Vars,html=false){return source.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g,(_,key)=>html?escapeHtml(vars[key]):String(vars[key]??''))}
function appBase(){return (process.env.APP_URL||process.env.PANEL_URL||process.env.PUBLIC_URL||'').replace(/\/$/,'')}

function readResponse(socket:net.Socket|tls.TLSSocket,timeoutMs=12000):Promise<{code:number,text:string}>{
  return new Promise((resolve,reject)=>{
    let buf='';const timer=setTimeout(()=>done(new Error('SMTP response timed out')),timeoutMs);
    const cleanup=()=>{clearTimeout(timer);socket.off('data',onData);socket.off('error',onError);socket.off('close',onClose)};
    const done=(err?:Error,result?:{code:number;text:string})=>{cleanup();err?reject(err):resolve(result!)};
    const onError=(e:Error)=>done(e);const onClose=()=>done(new Error('SMTP connection closed unexpectedly'));
    const onData=(chunk:Buffer|string)=>{buf+=chunk.toString();const lines=buf.split(/\r?\n/).filter(Boolean);const last=lines[lines.length-1]||'';const m=last.match(/^(\d{3})\s/);if(m)done(undefined,{code:Number(m[1]),text:lines.join('\n')})};
    socket.on('data',onData);socket.once('error',onError);socket.once('close',onClose);
  });
}
async function command(socket:net.Socket|tls.TLSSocket,line:string,ok:number[]){socket.write(line+'\r\n');const r=await readResponse(socket);if(!ok.includes(r.code))throw new Error(`SMTP ${r.code}: ${r.text.slice(0,240)}`);return r}
function connectPlain(config:MailConfig):Promise<net.Socket>{return new Promise((resolve,reject)=>{const s=net.connect({host:config.host,port:config.port});s.setTimeout(15000,()=>s.destroy(new Error('SMTP connection timed out')));s.once('connect',()=>resolve(s));s.once('error',reject)})}
function connectTls(config:MailConfig,socket?:net.Socket):Promise<tls.TLSSocket>{return new Promise((resolve,reject)=>{const s=tls.connect({host:socket?undefined:config.host,port:socket?undefined:config.port,socket,servername:config.host,rejectUnauthorized:config.rejectUnauthorized});s.setTimeout(15000,()=>s.destroy(new Error('SMTP TLS connection timed out')));s.once('secureConnect',()=>resolve(s));s.once('error',reject)})}

async function smtpSend(config:MailConfig,to:string,subject:string,html:string,text:string){
  if(!config.host||!config.port)throw new Error('SMTP host and port are required');
  if(!config.fromEmail)throw new Error('SMTP sender email is required');
  let socket:net.Socket|tls.TLSSocket=config.encryption==='SSL_TLS'?await connectTls(config):await connectPlain(config);
  try{
    const greeting=await readResponse(socket);if(greeting.code!==220)throw new Error(`SMTP greeting failed: ${greeting.text}`);
    const ehlo=(process.env.SMTP_EHLO_NAME||'crakhost-control').replace(/[^a-zA-Z0-9.-]/g,'')||'crakhost-control';
    await command(socket,`EHLO ${ehlo}`,[250]);
    if(config.encryption==='STARTTLS'){
      await command(socket,'STARTTLS',[220]);
      socket=await connectTls(config,socket as net.Socket);
      await command(socket,`EHLO ${ehlo}`,[250]);
    }
    if(config.username){
      await command(socket,'AUTH LOGIN',[334]);
      await command(socket,Buffer.from(config.username).toString('base64'),[334]);
      await command(socket,Buffer.from(config.password).toString('base64'),[235]);
    }
    await command(socket,`MAIL FROM:<${cleanHeader(config.fromEmail)}>`,[250]);
    await command(socket,`RCPT TO:<${cleanHeader(to)}>`,[250,251]);
    await command(socket,'DATA',[354]);
    const boundary=`crakhost_${randomBytes(8).toString('hex')}`;
    const fromName=encodedHeader(config.fromName||'CrakHost');
    const messageId=`<${Date.now()}.${randomBytes(8).toString('hex')}@${(config.fromEmail.split('@')[1]||'crakhost.local')}>`;
    const headers=[
      `From: ${fromName} <${cleanHeader(config.fromEmail)}>`,`To: <${cleanHeader(to)}>`,`Subject: ${encodedHeader(subject)}`,`Date: ${new Date().toUTCString()}`,`Message-ID: ${messageId}`,
      ...(config.replyTo?[`Reply-To: <${cleanHeader(config.replyTo)}>`]:[]),'MIME-Version: 1.0',`Content-Type: multipart/alternative; boundary="${boundary}"`
    ];
    const body=[...headers,'',`--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(text||html.replace(/<[^>]+>/g,' ')).toString('base64'),`--${boundary}`,'Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(html||`<pre>${escapeHtml(text)}</pre>`).toString('base64'),`--${boundary}--`,''].join('\r\n').replace(/^\./gm,'..');
    socket.write(body+'\r\n.\r\n');const sent=await readResponse(socket);if(sent.code!==250)throw new Error(`SMTP message rejected: ${sent.text}`);
    await command(socket,'QUIT',[221]).catch(()=>null);
    return {messageId};
  }finally{socket.destroy()}
}

async function logDelivery(templateKey:string|null,recipient:string,subject:string,status:'SENT'|'FAILED'|'SKIPPED',messageId='',error=''){
  await db.query(`insert into email_delivery_logs(template_key,recipient,subject,status,message_id,error) values($1,$2,$3,$4,$5,$6)`,[templateKey,recipient,subject,status,messageId,error.slice(0,1000)]).catch(()=>{});
}

export async function sendDirectEmail(to:string,subject:string,html:string,text=''){
  const config=await getMailConfig();
  if(!config.enabled){await logDelivery(null,to,subject,'SKIPPED','','SMTP delivery is disabled');return {sent:false,skipped:true,reason:'SMTP delivery is disabled'}}
  try{const out=await smtpSend(config,to,subject,html,text);await logDelivery(null,to,subject,'SENT',out.messageId,'');return {sent:true,...out}}
  catch(e:any){const error=String(e?.message||e);await logDelivery(null,to,subject,'FAILED','',error);throw e}
}

export async function sendTemplateEmail(templateKey:string,to:string,vars:Vars={}){
  const config=await getMailConfig();
  const tq=await db.query(`select * from email_templates where key=$1 limit 1`,[templateKey]);const t=tq.rows[0] as TemplateRow|undefined;
  if(!t)throw new Error(`Email template not found: ${templateKey}`);
  const merged:Vars={panel_url:appBase()||'',billing_url:appBase()?`${appBase()}/billing`:'',support_url:appBase()?`${appBase()}/support`:'',...vars};
  const subject=render(String(t.subject||''),merged,false);const html=render(String(t.html_body||''),merged,true);const text=render(String(t.text_body||''),merged,false);
  if(!config.enabled||!t.enabled){const reason=!config.enabled?'SMTP delivery is disabled':'Email template is disabled';await logDelivery(templateKey,to,subject,'SKIPPED','',reason);return {sent:false,skipped:true,reason}}
  try{const out=await smtpSend(config,to,subject,html,text);await logDelivery(templateKey,to,subject,'SENT',out.messageId,'');return {sent:true,...out}}
  catch(e:any){const error=String(e?.message||e);await logDelivery(templateKey,to,subject,'FAILED','',error);throw e}
}

export async function mailAdminSnapshot(){
  const [s,t,l]=await Promise.all([
    db.query(`select enabled,host,port,encryption,username,password_cipher,from_name,from_email,reply_to,reject_unauthorized,updated_at from mail_settings where id=1 limit 1`),
    db.query(`select key,name,description,subject,html_body,text_body,variables,enabled,system_template,updated_at from email_templates order by name`),
    db.query(`select id,template_key,recipient,subject,status,message_id,error,created_at from email_delivery_logs order by created_at desc limit 50`),
  ]);
  const row=s.rows[0]||{};
  return {settings:{enabled:!!row.enabled,host:row.host||'',port:Number(row.port||587),encryption:row.encryption||'STARTTLS',username:row.username||'',passwordConfigured:!!row.password_cipher,fromName:row.from_name||'CrakHost',fromEmail:row.from_email||'',replyTo:row.reply_to||'',rejectUnauthorized:row.reject_unauthorized!==false,updatedAt:row.updated_at||null},templates:t.rows,logs:l.rows};
}
