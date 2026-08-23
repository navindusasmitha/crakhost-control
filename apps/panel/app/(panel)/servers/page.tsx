import Link from 'next/link';
import {Plus,Server,ArrowUpRight,Cpu,MemoryStick,HardDrive,MapPin}from'lucide-react';
import {getCurrentUser,isStaff}from'../../../lib/auth';
import {db}from'../../../lib/db';
import {nodeFetchFor}from'../../../lib/node';

export const dynamic='force-dynamic';
export const revalidate=0;

export default async function Servers(){
 const user=await getCurrentUser();if(!user)return null;const staff=isStaff(user);
 const q=staff?`select s.*,u.email owner_email,n.name node_name,n.location node_location,n.base_url,n.api_token from servers s join users u on u.id=s.owner_id left join nodes n on n.id=s.node_id where s.status<>'deleted' order by s.created_at desc`:`select distinct s.*,u.email owner_email,n.name node_name,n.location node_location,n.base_url,n.api_token from servers s join users u on u.id=s.owner_id left join server_users su on su.server_id=s.id left join nodes n on n.id=s.node_id where (s.owner_id=$1 or su.user_id=$1) and s.status<>'deleted' order by s.created_at desc`;
 const {rows}=await db.query(q,staff?[]:[user.id]);
 const servers=await Promise.all(rows.map(async(s:any)=>{try{const live=await nodeFetchFor(s,`/v1/servers/${encodeURIComponent(s.identifier)}/status`);return{...s,runtime:String(live.status||s.status||'unknown'),live}}catch{return{...s,runtime:'offline',live:null}}}));
 const running=servers.filter((s:any)=>s.runtime==='running').length;
 const ram=servers.reduce((a:number,s:any)=>a+Number(s.memory_mb||0),0),disk=servers.reduce((a:number,s:any)=>a+Number(s.disk_mb||0),0),cpu=servers.reduce((a:number,s:any)=>a+Number(s.cpu_limit||0),0);
 return <>
  <section className="fleetHero"><div className="heroCopy"><div className="eyebrow">SERVER FLEET</div><h1>Managed <span>instances</span></h1><p>{running}/{servers.length} running · runtime data is read from each assigned CrakNode.</p></div><div className="heroActions"><Link className="btn indigo" href="/servers/create"><Plus size={14}/>Create server</Link></div></section>
  <section className="surfaceGrid"><Metric label="Instances" value={servers.length} hint={`${running} running`} icon={<Server size={15}/>}/><Metric label="CPU allocation" value={`${trim(cpu)} vCPU`} hint="Configured hard limits" icon={<Cpu size={15}/>}/><Metric label="Memory allocation" value={`${gb(ram)} GB`} hint="Across visible servers" icon={<MemoryStick size={15}/>}/><Metric label="Disk allocation" value={`${gb(disk)} GB`} hint="Configured storage" icon={<HardDrive size={15}/>}/></section>
  <section className="panelSection"><div className="panelSectionHead"><div><h2>All servers</h2><p>{staff?'Customer and internal workloads.':'Servers you own or have delegated access to.'}</p></div><span className="liveChip"><i/>LIVE STATUS</span></div>{servers.length===0?<div className="nodeEmpty"><Server size={28}/><h3>No servers found</h3><p>Deploy your first server to populate the fleet.</p><Link className="btn indigo" href="/checkout">Order server</Link></div>:<div className="fleetList">{servers.map((s:any)=>{const liveCpu=Math.max(0,Math.min(100,Number(s.live?.cpu||0)));const liveMem=Number(s.live?.memory||0);const memPct=Number(s.memory_mb)?Math.max(0,Math.min(100,liveMem/Number(s.memory_mb)*100)):0;return <article className="fleetRow" key={s.id}><div className="fleetIdentity"><div className="fleetIcon"><Server size={18}/></div><div><b>{s.name}</b><small>{s.primary_ip}:{s.primary_port} · {s.identifier}</small></div></div><div className="fleetCell"><span className={`statusDot ${statusClass(s.runtime)}`}>{s.runtime}</span><small><MapPin size={10} style={{verticalAlign:'middle'}}/> {s.node_location||s.node_name||'Unassigned'}</small></div><div className="fleetUsage"><div className="fleetUsageLine"><span>CPU</span><b>{liveCpu.toFixed(1)}%</b></div><div className="fleetBar"><span style={{width:`${liveCpu}%`}}/></div><small>{trim(Number(s.cpu_limit||0))} vCPU limit</small></div><div className="fleetUsage"><div className="fleetUsageLine"><span>RAM</span><b>{Math.round(liveMem)} / {Number(s.memory_mb||0)} MB</b></div><div className="fleetBar"><span style={{width:`${memPct}%`}}/></div><small>{staff?s.owner_email:`${gb(Number(s.disk_mb||0))} GB disk`}</small></div><Link href={`/servers/${s.identifier}`} className="btn">Manage <ArrowUpRight size={13}/></Link></article>})}</div>}</section>
 </>
}
function Metric({label,value,hint,icon}:{label:string;value:any;hint:string;icon:React.ReactNode}){return <div className="surfaceMetric"><div className="surfaceMetricTop"><span>{label}</span>{icon}</div><strong>{value}</strong><small>{hint}</small></div>}
function gb(mb:number){return Number.isFinite(mb)?Number((mb/1024).toFixed(1)).toString():'0'}
function trim(v:number){return Number.isFinite(v)?Number(v.toFixed(2)).toString():'0'}
function statusClass(v:any){const s=String(v||'unknown').toLowerCase();return ['running','active','online','offline','failed','suspended','provisioning','starting'].includes(s)?s:'unknown'}
