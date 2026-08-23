import {createHash,randomBytes} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const DOMAIN_RE=/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const LOCAL_RE=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,128}$/;

export function normaliseDomain(input:unknown){return String(input||'').trim().toLowerCase().replace(/^\.+|\.+$/g,'')}
export function validDomain(domain:string){return DOMAIN_RE.test(domain)}
export function normaliseLocalPart(input:unknown){return String(input||'').trim().toLowerCase()}
export function validLocalPart(local:string){return LOCAL_RE.test(local)&&!local.includes('..')&&!local.startsWith('.')&&!local.endsWith('.')}
export function mailboxAddress(local:string,domain:string){return `${local}@${domain}`.toLowerCase()}

// Dovecot supports SSHA512 natively. The database never stores a mailbox password in plaintext.
export function hashMailboxPassword(password:string){
  if(password.length<12)throw new Error('Mailbox password must be at least 12 characters');
  const salt=randomBytes(16);
  const digest=createHash('sha512').update(Buffer.from(password,'utf8')).update(salt).digest();
  return `{SSHA512}${Buffer.concat([digest,salt]).toString('base64')}`;
}

export function dnsRecords(domain:string,hostname:string,publicIp:string,selector='mail',dkimValue=''){
  const cleanIp=String(publicIp||'').trim();
  return [
    {type:'A',name:hostname,value:cleanIp||'<VPS_PUBLIC_IP>',purpose:'Mail host'},
    {type:'MX',name:domain,value:`10 ${hostname}.`,purpose:'Inbound mail'},
    {type:'TXT',name:domain,value:`v=spf1 mx a:${hostname}${cleanIp?` ip4:${cleanIp}`:''} -all`,purpose:'SPF sender policy'},
    {type:'TXT',name:`${selector}._domainkey.${domain}`,value:dkimValue||'<generated after CrakMail starts>',purpose:'DKIM signing key'},
    {type:'TXT',name:`_dmarc.${domain}`,value:`v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}; adkim=s; aspf=s`,purpose:'DMARC policy'},
    {type:'PTR',name:cleanIp||'<VPS_PUBLIC_IP>',value:`${hostname}.`,purpose:'Set at VPS provider, not normal DNS'},
  ];
}

export async function readDkimDnsValue(domain:string){
  if(!validDomain(domain))return '';
  const base=process.env.CRAKMAIL_DKIM_DIR||'/var/lib/crakmail/dkim';
  const file=path.join(base,`${domain}.txt`);
  try{return (await fs.readFile(file,'utf8')).trim()}catch{return ''}
}

export function probeTcp(host:string,port:number,timeoutMs=5000):Promise<{ok:boolean;latencyMs:number;error?:string}>{
  return new Promise(resolve=>{
    const started=Date.now();let settled=false;
    let socket:net.Socket;
    const done=(ok:boolean,error?:string)=>{if(settled)return;settled=true;socket.destroy();resolve({ok,latencyMs:Date.now()-started,...(error?{error}: {})})};
    socket=net.createConnection({host,port});
    socket.setTimeout(timeoutMs);
    socket.once('connect',()=>done(true));
    socket.once('timeout',()=>done(false,'timeout'));
    socket.once('error',e=>done(false,e.message));
  });
}
