import {db} from './db';
import {nodeFetchFor} from './node';

export type PublicStatus='operational'|'degraded'|'outage'|'maintenance';
export type StatusComponent={id:string;name:string;source:string;enabled:boolean;manualStatus?:PublicStatus};
export type StatusIncident={id:string;title:string;message:string;severity:'maintenance'|'minor'|'major';status:'investigating'|'identified'|'monitoring'|'resolved';createdAt:string;updatedAt:string;resolvedAt?:string|null};
export type StatusConfig={enabled:boolean;domain:string;title:string;description:string;logoUrl:string;refreshSeconds:number;components:StatusComponent[];incidents:StatusIncident[]};

type SafeRows={rows:any[];error:string|null};
type LiveComponent=StatusComponent&{status:PublicStatus;detail:string;latencyMs:number|null};
const LOGO='https://i.ibb.co/sv3BkwyS/logo-Photoroom.png';
const HISTORY_MINUTES=10;
const SAMPLE_SECONDS=60;

export const DEFAULT_STATUS_CONFIG:StatusConfig={
  enabled:true,
  domain:'uptime.crakbit.space',
  title:'CrakHost Status',
  description:'Live availability and incident updates for CrakHost services.',
  logoUrl:LOGO,
  refreshSeconds:SAMPLE_SECONDS,
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
    refreshSeconds:Math.min(300,Math.max(SAMPLE_SECONDS,Number(src.refreshSeconds)||SAMPLE_SECONDS)),
    components:components.length?components:DEFAULT_STATUS_CONFIG.components,
    incidents
  };
}

function errorText(error:any){return String(error instanceof Error?error.message:error||'unknown error').slice(0,240)}
async function safeRows(sql:string,params:any[]=[]):Promise<SafeRows>{
  try{return{rows:(await db.query(sql,params)).rows,error:null}}
  catch(error){const message=errorText(error);console.error('[CrakHost Status] telemetry query failed:',message);return{rows:[],error:message}}
}

export async function getStatusConfig(){
  try{const {rows}=await db.query(`select value from system_settings where key='public_status' limit 1`);return normalizeStatusConfig(rows[0]?.value||{})}
  catch(error){console.error('[CrakHost Status] configuration read failed:',errorText(error));return normalizeStatusConfig(DEFAULT_STATUS_CONFIG)}
}

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

async function evaluateCurrent(config:StatusConfig){
  const dbStarted=Date.now();
  const [nodesQ,nodeLatencyQ,databaseQ]=await Promise.all([
    safeRows(`select id,name,location,enabled,last_seen_at from nodes order by name`),
    safeRows(`select distinct on(node_id) node_id,latency_ms,created_at from node_health_snapshots order by node_id,created_at desc`),
    safeRows(`select 1 as ok`)
  ]);
  const databaseLatency=Math.max(0,Date.now()-dbStarted);
  const nodes=nodesQ.rows;
  const databaseHealthy=!databaseQ.error;
  const nodeInventoryHealthy=!nodesQ.error;
  const latestLatency=new Map(nodeLatencyQ.rows.map((r:any)=>[String(r.node_id),Number.isFinite(Number(r.latency_ms))?Number(r.latency_ms):null]));
  const components:LiveComponent[]=config.components.filter(c=>c.enabled).map(c=>{
    let status:PublicStatus='operational';let detail='Operational';let latencyMs:number|null=null;
    if(c.source==='panel'){status='operational';detail='Public status endpoint is responding';latencyMs=databaseLatency}
    else if(c.source==='database'){status=databaseHealthy?'operational':'outage';detail=databaseHealthy?'Database is responding':'Database telemetry unavailable';latencyMs=databaseHealthy?databaseLatency:null}
    else if(c.source==='nodes'){
      if(!nodeInventoryHealthy){status='outage';detail='CrakNode inventory telemetry unavailable'}
      else{
        const enabled=nodes.filter((n:any)=>n.enabled);const states=enabled.map(currentNodeStatus);status=states.length?worst(states):'maintenance';const online=enabled.filter((n:any)=>currentNodeStatus(n)==='operational').length;detail=`${online}/${enabled.length} nodes operational`;
        const latencies=enabled.map((n:any)=>latestLatency.get(String(n.id))).filter((v:any)=>Number.isFinite(Number(v))) as number[];
        latencyMs=latencies.length?Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length):null;
      }
    }else if(c.source.startsWith('node:')){
      const id=c.source.slice(5);const n=nodes.find((x:any)=>String(x.id)===id);
      if(!nodeInventoryHealthy){status='outage';detail='Node telemetry unavailable'}
      else{status=n?currentNodeStatus(n):'outage';detail=n?`${n.name} · ${n.location||'Unknown location'}`:'Node no longer exists';latencyMs=n?(latestLatency.get(String(n.id))??null):null}
    }else{status=cleanStatus(c.manualStatus);detail=status==='operational'?'Operational':status==='maintenance'?'Maintenance':status==='degraded'?'Degraded performance':'Service disruption'}
    return {...c,status,detail,latencyMs};
  });
  return {components,telemetry:{database:databaseHealthy,nodes:nodeInventoryHealthy}};
}

async function refreshNodeTelemetry(){
  const q=await safeRows(`select id,name,location,base_url,api_token,enabled,last_seen_at,agent_version from nodes order by name`);
  if(q.error)return {checked:0,online:0,error:q.error};
  let checked=0,online=0;
  await Promise.all(q.rows.filter((n:any)=>n.enabled).map(async(n:any)=>{
    checked+=1;const started=Date.now();
    try{
      const d=await nodeFetchFor(n,'/diagnostics');const latency=Date.now()-started;online+=1;
      await Promise.all([
        db.query(`update nodes set last_seen_at=now(),agent_version=$2 where id=$1`,[n.id,String(d.version||n.agent_version||'')]).catch(()=>null),
        db.query(`insert into node_health_snapshots(node_id,status,latency_ms,docker_version,managed_containers,running_containers,disk_free_bytes,detail) values($1,'online',$2,$3,$4,$5,$6,$7)`,[n.id,latency,String(d.dockerVersion||''),Number(d.managedContainers)||0,Number(d.runningContainers)||0,d.diskFreeBytes?Number(d.diskFreeBytes):null,JSON.stringify(d)]).catch(()=>null)
      ]);
    }catch(error){
      const latency=Date.now()-started;
      await db.query(`insert into node_health_snapshots(node_id,status,latency_ms,detail) values($1,'offline',$2,$3)`,[n.id,latency,JSON.stringify({error:errorText(error)})]).catch(()=>null);
    }
  }));
  return {checked,online,error:null};
}

export async function recordPublicStatusSample(probeNodes=true){
  const nodeProbe=probeNodes?await refreshNodeTelemetry():{checked:0,online:0,error:null};
  const config=await getStatusConfig();
  if(!config.enabled)return {ok:true,disabled:true,sampled:0,nodeProbe};
  const current=await evaluateCurrent(config);
  let sampled=0;
  for(const component of current.components){
    const result=await db.query(`insert into status_component_snapshots(component_id,status,detail,created_at)
      select $1,$2,$3,now()
      where not exists(select 1 from status_component_snapshots where component_id=$1 and created_at>now()-interval '50 seconds')
      returning id`,[component.id,component.status,component.detail.slice(0,255)]).catch(()=>({rows:[]} as any));
    if(result.rows?.length)sampled+=1;
  }
  await db.query(`delete from status_component_snapshots where created_at<now()-interval '10 minutes'`).catch(()=>null);
  await db.query(`delete from node_health_snapshots where created_at<now()-interval '45 days'`).catch(()=>null);
  return {ok:true,sampled,nodeProbe,generatedAt:new Date().toISOString(),sampleEverySeconds:SAMPLE_SECONDS,retainedMinutes:HISTORY_MINUTES};
}

export async function buildPublicStatus(){
  const config=await getStatusConfig();
  const [current,historyQ]=await Promise.all([
    evaluateCurrent(config),
    safeRows(`select component_id,
      date_trunc('minute',created_at) bucket,
      count(*) filter(where status<>'maintenance')::int samples,
      count(*) filter(where status='operational')::int online,
      min(created_at) first_seen,max(created_at) last_seen
      from status_component_snapshots
      where created_at>=now()-interval '10 minutes'
      group by component_id,2 order by 2`)
  ]);
  const history=historyQ.rows||[];
  const historyHealthy=!historyQ.error;
  const minuteMs=60_000;
  const endBucket=Math.floor(Date.now()/minuteMs)*minuteMs;
  const expectedBuckets=Array.from({length:HISTORY_MINUTES},(_,i)=>endBucket-(HISTORY_MINUTES-1-i)*minuteMs);

  const components=current.components.map(c=>{
    const relevant=history.filter((h:any)=>String(h.component_id)===c.id);
    const byBucket=new Map<number,any>();
    for(const row of relevant){const t=new Date(row.bucket).getTime();if(Number.isFinite(t))byBucket.set(Math.floor(t/minuteMs)*minuteMs,row)}
    const historyBars=expectedBuckets.map(bucket=>{
      if(!historyHealthy)return{bucket:new Date(bucket).toISOString(),uptime:null,samples:0};
      const row=byBucket.get(bucket);const samples=Number(row?.samples||0),online=Number(row?.online||0);
      return{bucket:new Date(bucket).toISOString(),uptime:samples?Math.round((online/samples)*10000)/100:null,samples};
    });
    const totalSamples=historyBars.reduce((s,x)=>s+Number(x.samples||0),0);
    const weightedOnline=historyBars.reduce((s,x)=>s+(x.uptime===null?0:Number(x.uptime)*Number(x.samples||0)/100),0);
    const uptime10m=totalSamples?Math.round((weightedOnline/totalSamples)*10000)/100:(c.status==='operational'?100:c.status==='maintenance'?null:0);
    const trackedMinutes=historyBars.filter(x=>x.samples>0).length;
    const lastSample=relevant.map((h:any)=>new Date(h.last_seen).getTime()).filter(Number.isFinite).sort((a:number,b:number)=>b-a)[0];
    return {...c,uptime10m,uptimeRange:uptime10m,trackedMinutes,sampleCount:totalSamples,lastSampleAt:lastSample?new Date(lastSample).toISOString():null,history:historyBars};
  });

  const incidents=[...config.incidents].sort((a,b)=>new Date(b.updatedAt).getTime()-new Date(a.updatedAt).getTime());
  const activeIncidents=incidents.filter(i=>i.status!=='resolved');
  let overall=worst(components.map(c=>c.status));
  if(activeIncidents.some(i=>i.severity==='major'))overall='outage';else if(activeIncidents.some(i=>i.severity==='minor')&&overall==='operational')overall='degraded';else if(activeIncidents.some(i=>i.severity==='maintenance')&&overall==='operational')overall='maintenance';

  return {
    enabled:config.enabled,domain:config.domain,title:config.title,description:config.description,logoUrl:config.logoUrl,
    refreshSeconds:SAMPLE_SECONDS,historyMinutes:HISTORY_MINUTES,overall,components,incidents:incidents.slice(0,20),activeIncidents,
    generatedAt:new Date().toISOString(),monitoringSince:'v0.58.6',telemetry:{...current.telemetry,history:historyHealthy}
  };
}
