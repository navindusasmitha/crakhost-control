import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser,isAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
import {audit} from '@/lib/audit';
import {dnsRecords,hashMailboxPassword,mailboxAddress,normaliseDomain,normaliseLocalPart,probeTcp,readDkimDnsValue,validDomain,validLocalPart} from '@/lib/mail-hosting';

export const dynamic='force-dynamic';
export const runtime='nodejs';

function okEmail(v:string){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)&&v.length<=320}
function cleanSelector(v:unknown){const s=String(v||'mail').trim().toLowerCase();return /^[a-z0-9][a-z0-9-]{0,31}$/.test(s)?s:'mail'}

async function snapshot(){
  const [domainsQ,mailboxesQ,aliasesQ]=await Promise.all([
    db.query(`select id,domain,hostname,dkim_selector,enabled,is_primary,created_at,updated_at from mail_domains order by is_primary desc,domain`),
    db.query(`select m.id,m.domain_id,m.email,m.local_part,m.display_name,m.quota_mb,m.enabled,m.created_at,m.updated_at,d.domain from mailboxes m join mail_domains d on d.id=m.domain_id order by m.email`),
    db.query(`select a.id,a.domain_id,a.source,a.destination,a.enabled,a.created_at,a.updated_at,d.domain from mail_aliases a join mail_domains d on d.id=a.domain_id order by a.source`),
  ]);
  const domains=domainsQ.rows;
  const primary=domains.find((d:any)=>d.is_primary)||domains[0]||null;
  const publicIp=String(process.env.MAIL_PUBLIC_IP||process.env.CRAKMAIL_PUBLIC_IP||'').trim();
  const defaultHostname=String(process.env.MAIL_HOSTNAME||process.env.CRAKMAIL_HOSTNAME||'').trim().toLowerCase();
  const dkim=primary?await readDkimDnsValue(primary.domain):'';
  const probes=await Promise.all([
    probeTcp('crakmail',25,1200),probeTcp('crakmail',587,1200),probeTcp('crakmail',993,1200),
  ]);
  return {
    domains,mailboxes:mailboxesQ.rows,aliases:aliasesQ.rows,
    runtime:{
      hostname:defaultHostname||primary?.hostname||'',publicIp,
      webmailUrl:String(process.env.CRAKMAIL_WEBMAIL_URL||''),
      services:{smtp25:probes[0],submission587:probes[1],imaps993:probes[2]},
    },
    dns:primary?dnsRecords(primary.domain,primary.hostname||defaultHostname||`mail.${primary.domain}`,publicIp,primary.dkim_selector||'mail',dkim):[],
    dkimReady:!!dkim,
  };
}

export async function GET(){
  const user=await getCurrentUser();
  if(!isAdmin(user))return NextResponse.json({error:'Admin required'},{status:403});
  return NextResponse.json(await snapshot(),{headers:{'cache-control':'no-store'}});
}

export async function POST(req:NextRequest){
  const user=await getCurrentUser();
  if(!isAdmin(user))return NextResponse.json({error:'Admin required'},{status:403});
  const body=await req.json().catch(()=>({}));
  const action=String(body.action||'');
  try{
    if(action==='probePort25'){
      const host=String(process.env.CRAKMAIL_PORT25_PROBE_HOST||'gmail-smtp-in.l.google.com');
      const result=await probeTcp(host,25,8000);
      await audit(user!.id,'mail.hosting.port25_probe','mail','port25',{host,ok:result.ok,error:result.error||''});
      return NextResponse.json({host,port:25,...result});
    }

    if(action==='saveDomain'){
      const domain=normaliseDomain(body.domain);
      const hostname=normaliseDomain(body.hostname||`mail.${domain}`);
      const selector=cleanSelector(body.dkimSelector);
      if(!validDomain(domain)||!validDomain(hostname))return NextResponse.json({error:'Enter a valid mail domain and mail hostname'},{status:400});
      const makePrimary=body.isPrimary!==false;
      const c=await db.connect();
      try{
        await c.query('begin');
        if(makePrimary)await c.query('update mail_domains set is_primary=false where is_primary=true');
        const q=await c.query(`insert into mail_domains(domain,hostname,dkim_selector,enabled,is_primary) values($1,$2,$3,true,$4)
          on conflict(domain) do update set hostname=excluded.hostname,dkim_selector=excluded.dkim_selector,enabled=true,is_primary=excluded.is_primary,updated_at=now()
          returning id,domain,hostname,dkim_selector,enabled,is_primary`,[domain,hostname,selector,makePrimary]);
        await c.query('commit');
        await audit(user!.id,'mail.domain.save','mail_domain',q.rows[0].id,{domain,hostname,selector,primary:makePrimary});
      }catch(e){await c.query('rollback').catch(()=>{});throw e}finally{c.release()}
      return NextResponse.json({ok:true,...await snapshot()});
    }

    if(action==='setDomainEnabled'){
      const id=String(body.id||'');const enabled=!!body.enabled;
      const q=await db.query('update mail_domains set enabled=$2,updated_at=now() where id=$1 returning id,domain',[id,enabled]);
      if(!q.rowCount)return NextResponse.json({error:'Domain not found'},{status:404});
      await audit(user!.id,enabled?'mail.domain.enable':'mail.domain.disable','mail_domain',id,{domain:q.rows[0].domain});
      return NextResponse.json({ok:true,...await snapshot()});
    }

    if(action==='deleteDomain'){
      const id=String(body.id||'');
      const count=await db.query('select count(*)::int c from mailboxes where domain_id=$1',[id]);
      if(Number(count.rows[0]?.c||0)>0)return NextResponse.json({error:'Delete or move all mailboxes on this domain first'},{status:409});
      const q=await db.query('delete from mail_domains where id=$1 returning domain',[id]);
      if(!q.rowCount)return NextResponse.json({error:'Domain not found'},{status:404});
      await audit(user!.id,'mail.domain.delete','mail_domain',id,{domain:q.rows[0].domain});
      return NextResponse.json({ok:true,...await snapshot()});
    }

    if(action==='createMailbox'){
      const domainId=String(body.domainId||'');
      const local=normaliseLocalPart(body.localPart);
      const password=String(body.password||'');
      const displayName=String(body.displayName||'').trim().slice(0,160);
      const quota=Math.max(64,Math.min(102400,Number(body.quotaMb)||1024));
      if(!validLocalPart(local))return NextResponse.json({error:'Mailbox local part is not valid'},{status:400});
      const dq=await db.query('select id,domain from mail_domains where id=$1 and enabled=true limit 1',[domainId]);
      const d=dq.rows[0];if(!d)return NextResponse.json({error:'Enabled mail domain not found'},{status:404});
      const email=mailboxAddress(local,d.domain);
      const passwordHash=hashMailboxPassword(password);
      const q=await db.query(`insert into mailboxes(domain_id,email,local_part,display_name,password_hash,quota_mb,enabled) values($1,$2,$3,$4,$5,$6,true) returning id,email`,[domainId,email,local,displayName,passwordHash,quota]);
      await audit(user!.id,'mail.mailbox.create','mailbox',q.rows[0].id,{email,quotaMb:quota});
      return NextResponse.json({ok:true,email,...await snapshot()});
    }

    if(action==='updateMailbox'){
      const id=String(body.id||'');
      const current=await db.query('select * from mailboxes where id=$1 limit 1',[id]);const m=current.rows[0];
      if(!m)return NextResponse.json({error:'Mailbox not found'},{status:404});
      const displayName=body.displayName===undefined?m.display_name:String(body.displayName||'').trim().slice(0,160);
      const quota=body.quotaMb===undefined?Number(m.quota_mb):Math.max(64,Math.min(102400,Number(body.quotaMb)||1024));
      const enabled=body.enabled===undefined?!!m.enabled:!!body.enabled;
      const password=String(body.password||'');
      const passwordHash=password?hashMailboxPassword(password):m.password_hash;
      await db.query('update mailboxes set display_name=$2,quota_mb=$3,enabled=$4,password_hash=$5,updated_at=now() where id=$1',[id,displayName,quota,enabled,passwordHash]);
      await audit(user!.id,'mail.mailbox.update','mailbox',id,{email:m.email,quotaMb:quota,enabled,passwordChanged:!!password});
      return NextResponse.json({ok:true,...await snapshot()});
    }

    if(action==='deleteMailbox'){
      const id=String(body.id||'');
      const q=await db.query('delete from mailboxes where id=$1 returning email',[id]);
      if(!q.rowCount)return NextResponse.json({error:'Mailbox not found'},{status:404});
      await db.query('delete from mail_aliases where destination=$1',[q.rows[0].email]);
      await audit(user!.id,'mail.mailbox.delete','mailbox',id,{email:q.rows[0].email});
      return NextResponse.json({ok:true,...await snapshot()});
    }

    if(action==='createAlias'){
      const domainId=String(body.domainId||'');const local=normaliseLocalPart(body.localPart);const destination=String(body.destination||'').trim().toLowerCase();
      if(!validLocalPart(local)||!okEmail(destination))return NextResponse.json({error:'Alias source or destination is invalid'},{status:400});
      const dq=await db.query('select id,domain from mail_domains where id=$1 and enabled=true limit 1',[domainId]);const d=dq.rows[0];
      if(!d)return NextResponse.json({error:'Enabled mail domain not found'},{status:404});
      const target=await db.query('select id from mailboxes where email=$1 and enabled=true limit 1',[destination]);
      if(!target.rowCount)return NextResponse.json({error:'Alias destination must be an enabled local mailbox in v0.47'},{status:409});
      const source=mailboxAddress(local,d.domain);
      const q=await db.query(`insert into mail_aliases(domain_id,source,destination,enabled) values($1,$2,$3,true) on conflict(source) do update set destination=excluded.destination,enabled=true,updated_at=now() returning id`,[domainId,source,destination]);
      await audit(user!.id,'mail.alias.save','mail_alias',q.rows[0].id,{source,destination});
      return NextResponse.json({ok:true,...await snapshot()});
    }

    if(action==='deleteAlias'){
      const id=String(body.id||'');const q=await db.query('delete from mail_aliases where id=$1 returning source,destination',[id]);
      if(!q.rowCount)return NextResponse.json({error:'Alias not found'},{status:404});
      await audit(user!.id,'mail.alias.delete','mail_alias',id,q.rows[0]);
      return NextResponse.json({ok:true,...await snapshot()});
    }

    if(action==='useLocalSmtp'){
      const fromEmail=String(body.fromEmail||'').trim().toLowerCase();
      if(!okEmail(fromEmail))return NextResponse.json({error:'Choose a valid local sender address'},{status:400});
      const mq=await db.query('select id from mailboxes where email=$1 and enabled=true limit 1',[fromEmail]);
      if(!mq.rowCount)return NextResponse.json({error:'Sender must be an enabled CrakMail mailbox'},{status:409});
      await db.query(`update mail_settings set enabled=true,host='crakmail',port=25,encryption='NONE',username='',password_cipher='',from_email=$1,reply_to=$1,reject_unauthorized=true,updated_by=$2,updated_at=now() where id=1`,[fromEmail,user!.id]);
      await audit(user!.id,'mail.hosting.use_local_smtp','mail','smtp',{fromEmail});
      return NextResponse.json({ok:true});
    }

    return NextResponse.json({error:'Unknown action'},{status:400});
  }catch(e:any){
    if(e?.code==='23505')return NextResponse.json({error:'That mail domain, mailbox, or alias already exists'},{status:409});
    console.error('[crakmail admin]',e);
    return NextResponse.json({error:String(e?.message||'CrakMail operation failed')},{status:500});
  }
}
