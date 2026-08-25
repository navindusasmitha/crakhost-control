import {randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {getCurrentUser,isAdmin} from '@/lib/auth';
import {audit} from '@/lib/audit';
import {DEFAULT_STATUS_CONFIG,getStatusConfig,normalizeStatusConfig,type StatusIncident} from '@/lib/status-page';

export const dynamic='force-dynamic';
export const runtime='nodejs';
type IncidentSeverity=StatusIncident['severity'];
type IncidentStatus=StatusIncident['status'];
function sameOrigin(req:Request){const origin=req.headers.get('origin');if(!origin)return true;try{return new URL(origin).host===req.headers.get('host')}catch{return false}}
function incidentSeverity(value:any,fallback:IncidentSeverity='minor'):IncidentSeverity{const v=String(value);return v==='maintenance'||v==='minor'||v==='major'?v:fallback}
function incidentStatus(value:any,fallback:IncidentStatus='investigating'):IncidentStatus{const v=String(value);return v==='investigating'||v==='identified'||v==='monitoring'||v==='resolved'?v:fallback}
async function save(value:any,userId:string){await db.query(`insert into system_settings(key,value,updated_by,updated_at) values('public_status',$1,$2,now()) on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`,[JSON.stringify(value),userId])}

export async function GET(){
  const user=await getCurrentUser();if(!isAdmin(user))return NextResponse.json({error:'Admin required'},{status:403});
  const [config,nodesQ]=await Promise.all([getStatusConfig(),db.query(`select id,name,location,enabled,last_seen_at from nodes order by name`)]);
  return NextResponse.json({config:{...config,domain:process.env.STATUS_DOMAIN||config.domain||DEFAULT_STATUS_CONFIG.domain},nodes:nodesQ.rows,publicUrl:`https://${process.env.STATUS_DOMAIN||config.domain||DEFAULT_STATUS_CONFIG.domain}`,dnsNote:'Point the status hostname A/AAAA record to this VPS once. CrakHost then serves and manages the page from the panel.'},{headers:{'cache-control':'no-store'}});
}

export async function PATCH(req:Request){
  const user=await getCurrentUser();if(!isAdmin(user))return NextResponse.json({error:'Admin required'},{status:403});
  if(!sameOrigin(req))return NextResponse.json({error:'Cross-origin status change blocked.'},{status:403});
  if(req.headers.get('x-crakhost-action')!=='status-page-config')return NextResponse.json({error:'Missing status-page confirmation.'},{status:400});
  const body=await req.json().catch(()=>({}));const current=await getStatusConfig();
  const requested=normalizeStatusConfig({...current,...body,domain:process.env.STATUS_DOMAIN||current.domain||DEFAULT_STATUS_CONFIG.domain,incidents:current.incidents});
  await save(requested,user.id);await audit(user.id,'status_page.config.update','system','public_status',{enabled:requested.enabled,title:requested.title,components:requested.components.length,domain:requested.domain});
  return NextResponse.json({ok:true,config:requested},{headers:{'cache-control':'no-store'}});
}

export async function POST(req:Request){
  const user=await getCurrentUser();if(!isAdmin(user))return NextResponse.json({error:'Admin required'},{status:403});
  if(!sameOrigin(req))return NextResponse.json({error:'Cross-origin status incident action blocked.'},{status:403});
  if(req.headers.get('x-crakhost-action')!=='status-page-incident')return NextResponse.json({error:'Missing incident confirmation.'},{status:400});
  const body=await req.json().catch(()=>({}));const action=String(body.action||'');const current=await getStatusConfig();let incidents:StatusIncident[]=[...current.incidents];const now=new Date().toISOString();
  if(action==='create'){
    const title=String(body.title||'').trim().slice(0,160),message=String(body.message||'').trim().slice(0,2000);if(!title||!message)return NextResponse.json({error:'Incident title and message are required.'},{status:400});
    const item:StatusIncident={id:randomUUID(),title,message,severity:incidentSeverity(body.severity),status:'investigating',createdAt:now,updatedAt:now,resolvedAt:null};
    incidents=[item,...incidents].slice(0,100);
  }else if(action==='update'){
    const id=String(body.id||'');let found=false;incidents=incidents.map((x):StatusIncident=>{if(x.id!==id)return x;found=true;const status=incidentStatus(body.status,x.status);return{...x,title:String(body.title||x.title).trim().slice(0,160),message:String(body.message||x.message).trim().slice(0,2000),severity:incidentSeverity(body.severity,x.severity),status,updatedAt:now,resolvedAt:status==='resolved'?(x.resolvedAt||now):null}});if(!found)return NextResponse.json({error:'Incident not found.'},{status:404});
  }else if(action==='resolve'){
    const id=String(body.id||'');incidents=incidents.map((x):StatusIncident=>x.id===id?{...x,status:'resolved',updatedAt:now,resolvedAt:now}:x);
  }else if(action==='delete'){
    const id=String(body.id||'');incidents=incidents.filter(x=>x.id!==id);
  }else return NextResponse.json({error:'Unsupported incident action.'},{status:400});
  const next={...current,incidents};await save(next,user.id);await audit(user.id,`status_page.incident.${action}`,'system','public_status',{id:body.id||incidents[0]?.id||null});
  return NextResponse.json({ok:true,config:next},{headers:{'cache-control':'no-store'}});
}
