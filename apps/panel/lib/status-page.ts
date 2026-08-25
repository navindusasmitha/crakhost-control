import {db} from './db';

export type PublicStatus='operational'|'degraded'|'outage'|'maintenance';
export type StatusComponent={id:string;name:string;source:string;enabled:boolean;manualStatus?:PublicStatus};
export type StatusIncident={id:string;title:string;message:string;severity:'maintenance'|'minor'|'major';status:'investigating'|'identified'|'monitoring'|'resolved';createdAt:string;updatedAt:string;resolvedAt?:string|null};
export type StatusConfig={enabled:boolean;domain:string;title:string;description:string;logoUrl:string;refreshSeconds:number;components:StatusComponent[];incidents:StatusIncident[]};

const LOGO='https://i.ibb.co/sv3BkwyS/logo-Photoroom.png';
export const DEFAULT_STATUS_CONFIG:StatusConfig={
  enabled:true,
  domain:'uptime.crakbit.space',
  title:'CrakHost Status',
  description:'Live availability and incident updates for CrakHost services.',
  logoUrl:LOGO,
  refreshSeconds:30,
  components:[
    {id:'panel',name:'Control Panel',source:'panel',enabled:true},
    {id:'database',name:'Database',source:'database',enabled:true},
    {id:'nodes',name:'CrakNode Network',source:'nodes',enabled:true},
    {id:'mail',name:'Mail Services',source:'manual',enabled:true,manualStatus:'operational'}
  ],
  incidents:[]
};

function cleanStatus(value:any):PublicStatus{return ['operational','degraded','outage','maintenance'].includes(String(value))?value:'operational'}
export function normalizeStatusConfig(raw:any):StatusConfig{
  const src=raw&&typeof raw==='object'?raw:{};
  const components=Array.isArray(src.components)?src.components.slice(0,30).map((c:any,i:number)=>({
    id:String(c.id||`component-${i+1}`).replace(/[^a-zA-Z0-9:_-]/g,'').slice(0,80)||`component-${i+1}`,
    name:String(c.name||`Component ${i+1}`).trim().slice(0,80),
    source:String(c.source||'manual').trim().slice(0,100),
    enabled:c.enabled!==false,
    manualStatus:cleanStatus(c.manualStatus)
  })):DEFAULT_STATUS_CONFIG.components;
  const incidents=Array.isArray(src.incidents)?src.incidents.slice(0,100).map((x:any)=>({
    id:String(x.id||'').slice(0,80),title:String(x.title||'Incident').slice(0,160),message:String(x.message||'').slice(0,2000),
    severity:['maintenance','minor','major'].includes(String(x.severity))?x.severity:'minor',
    status:['investigating','identified','monitoring','resolved'].includes(String(x.status))?x.status:'investigating',
    createdAt:String(x.createdAt||new Date().toISOString()),updatedAt:String(x.updatedAt||x.createdAt||new Date().toISOString()),resolvedAt:x.resolvedAt?String(x.resolvedAt):null
  })).filter((x:any)=>x.id):[];
  return {
    enabled:src.enabled!==false,
    domain:String(src.domain||process.env.STATUS_DOMAIN||DEFAULT_STATUS_CONFIG.domain).trim().toLowerCase().slice(0,180),
    title:String(src.title||DEFAULT_STATUS_CONFIG.title).trim().slice(0,100),
    description:String(src.description||DEFAULT_STATUS_CONFIG.description).trim().slice(0,300),
    logoUrl:String(src.logoUrl||DEFAULT_STATUS_CONFIG.logoUrl).trim().slice(0,500),
    refreshSeconds:Math.min(300,Math.max(15,Number(src.refreshSeconds)||30)),
    components:components.length?components:DEFAULT_STATUS_CONFIG.components,
    incidents
  };
}

export async function getStatusConfig(){
  const {rows}=await db.query(`select value from system_settings where key='public_status' limit 1`);
  return normalizeStatusConfig(rows[0]?.value||{});
}

function dayKey(date:Date){return date.toISOString().slice(0,10)}
function currentNodeStatus(node:any):PublicStatus{
  if(!node?.enabled)return'maintenance';
  const last=node.last_seen_at?new Date(node.last_seen_at).getTime():0;
  const age=last?(Date.now()-last)/1000:Number.POSITIVE_INFINITY;
  if(!last||age>180)return'outage';
  if(age>90)return'degraded';
  return'operational';
}
function worst(values:PublicStatus[]):PublicStatus{
  const rank:Record<PublicStatus,number>={operational:0,maintenance:1,degraded:2,outage:3};
  return values.reduce((a,b)=>rank[b]>rank[a]?b:a,'operational' as PublicStatus);
}

export async function buildPublicStatus(){
  const config=await getStatusConfig();
  const nodesQ=await db.query(`select id,name,location,enabled,last_seen_at from nodes order by name`);
  const nodes=nodesQ.rows;
  const historyQ=await db.query(`select node_id,date_trunc('day',created_at)::date day,count(*)::int samples,count(*) filter(where status='online')::int online from node_health_snapshots where created_at>=now()-interval '30 days' group by node_id,2 order by 2`);
  const history=historyQ.rows;
  const days=Array.from({length:30},(_,i)=>{const d=new Date();d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-(29-i));return dayKey(d)});

  const components=config.components.filter(c=>c.enabled).map(c=>{
    let status:PublicStatus='operational';let detail='Operational';let relevant:any[]=history;
    if(c.source==='panel'){status='operational';detail='Control panel is responding';relevant=[]}
    else if(c.source==='database'){status='operational';detail='Database is responding';relevant=[]}
    else if(c.source==='nodes'){
      const states=nodes.filter(n=>n.enabled).map(currentNodeStatus);status=states.length?worst(states):'maintenance';
      const online=nodes.filter(n=>currentNodeStatus(n)==='operational').length;detail=`${online}/${nodes.length} nodes operational`;
    }else if(c.source.startsWith('node:')){
      const id=c.source.slice(5);const n=nodes.find(x=>String(x.id)===id);status=n?currentNodeStatus(n):'outage';detail=n?`${n.name} · ${n.location||'Unknown location'}`:'Node no longer exists';relevant=history.filter(h=>String(h.node_id)===id);
    }else{status=cleanStatus(c.manualStatus);detail=status==='operational'?'Operational':status==='maintenance'?'Maintenance':status==='degraded'?'Degraded performance':'Service disruption';relevant=[]}
    const historyBars=days.map(day=>{
      if(c.source==='nodes'){
        const rows=relevant.filter(h=>dayKey(new Date(h.day))===day);const samples=rows.reduce((s,h)=>s+Number(h.samples||0),0),online=rows.reduce((s,h)=>s+Number(h.online||0),0);return{day,uptime:samples?Math.round((online/samples)*1000)/10:null};
      }
      if(c.source.startsWith('node:')){const rows=relevant.filter(h=>dayKey(new Date(h.day))===day);const samples=rows.reduce((s,h)=>s+Number(h.samples||0),0),online=rows.reduce((s,h)=>s+Number(h.online||0),0);return{day,uptime:samples?Math.round((online/samples)*1000)/10:null};}
      return{day,uptime:null};
    });
    const known=historyBars.filter(x=>x.uptime!==null);const uptime30d=known.length?Math.round(known.reduce((s,x)=>s+Number(x.uptime),0)/known.length*100)/100:null;
    return{...c,status,detail,uptime30d,history:historyBars};
  });
  const incidents=[...config.incidents].sort((a,b)=>new Date(b.updatedAt).getTime()-new Date(a.updatedAt).getTime());
  const activeIncidents=incidents.filter(i=>i.status!=='resolved');
  let overall=worst(components.map(c=>c.status));
  if(activeIncidents.some(i=>i.severity==='major'))overall='outage';else if(activeIncidents.some(i=>i.severity==='minor')&&overall==='operational')overall='degraded';else if(activeIncidents.some(i=>i.severity==='maintenance')&&overall==='operational')overall='maintenance';
  return {enabled:config.enabled,domain:config.domain,title:config.title,description:config.description,logoUrl:config.logoUrl,refreshSeconds:config.refreshSeconds,overall,components,incidents:incidents.slice(0,20),activeIncidents,generatedAt:new Date().toISOString(),monitoringSince:'v0.58.0'};
}
