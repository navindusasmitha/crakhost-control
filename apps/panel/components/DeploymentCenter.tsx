"use client";
import{useEffect,useRef,useState}from'react';
import{RefreshCw,GitBranch,ShieldCheck,Server,ExternalLink,DownloadCloud,Loader2,Terminal,CheckCircle2,AlertTriangle,Activity,HardDrive,Database,Trash2,Clock3}from'lucide-react';

type UpdateInfo={installed?:string;latest?:string;name?:string;published_at?:string|null;update_available?:boolean;release_url?:string;channel?:string;message?:string;error?:string};
type HistoryItem={job_id?:string|null;job_kind?:string|null;status?:string;started_at?:string|null;finished_at?:string|null;exit_code?:number|null};
type AgentStatus={status?:'idle'|'running'|'success'|'failed'|'interrupted'|'unavailable'|string;job_id?:string|null;job_kind?:string|null;pid?:number|null;started_at?:string|null;finished_at?:string|null;exit_code?:number|null;agent_version?:string;log_tail?:string;history?:HistoryItem[];error?:string};
type HostMetrics={
 ok?:boolean;agent_version?:string;cpu_percent?:number|null;
 memory?:{total_bytes?:number;used_bytes?:number;available_bytes?:number;percent?:number|null};
 disk?:{total_bytes?:number;used_bytes?:number;free_bytes?:number;percent?:number|null};
 backup_bytes?:number|null;load?:number[];uptime_seconds?:number|null;
 docker_df?:Array<Record<string,string>>;
 services?:Array<{name?:string;service?:string;status?:string}>;
 warnings?:string[];collected_at?:string;error?:string;
};

export default function DeploymentCenter(){
 const[u,setU]=useState<UpdateInfo|null>(null);
 const[agent,setAgent]=useState<AgentStatus|null>(null);
 const[health,setHealth]=useState<HostMetrics|null>(null);
 const[loading,setLoading]=useState(false);
 const[healthLoading,setHealthLoading]=useState(false);
 const[installing,setInstalling]=useState(false);
 const[cleaning,setCleaning]=useState(false);
 const completedJob=useRef<string|null>(null);

 async function check(){
  setLoading(true);
  try{const r=await fetch('/api/admin/update/check',{cache:'no-store'});setU(await r.json())}
  catch{setU({error:'Unable to reach update service'})}
  finally{setLoading(false)}
 }
 async function readAgent(){
  try{
   const r=await fetch('/api/admin/update/status',{cache:'no-store'});const j=await r.json();
   if(r.ok)setAgent(j);else setAgent(prev=>prev?.status==='running'?{...prev,error:'Panel is reconnecting to the updater agent...'}:j);
  }catch{setAgent(prev=>prev?.status==='running'?{...prev,error:'Panel is restarting; job monitoring will reconnect automatically.'}:{status:'unavailable',error:'Updater agent is unavailable.'})}
 }
 async function readHealth(){
  setHealthLoading(true);
  try{const r=await fetch('/api/admin/maintenance',{cache:'no-store'});const j=await r.json();setHealth(j)}
  catch{setHealth({error:'Unable to read host health.'})}
  finally{setHealthLoading(false)}
 }
 async function applyUpdate(){
  if(agent?.status==='running')return;
  const label=u?.update_available&&u.latest?`Install ${u.latest}`:'Re-apply the latest production build';
  if(!window.confirm(`${label} now?\n\nCrakHost will create a database backup, rebuild the panel, run migrations and restart services. The panel may disconnect briefly.`))return;
  setInstalling(true);
  try{
   const r=await fetch('/api/admin/update/apply',{method:'POST',headers:{'x-crakhost-action':'apply-update'}});const j=await r.json();setAgent(j);
   if(!r.ok)throw new Error(j.error||'Unable to start update.');
  }catch(error){setAgent({status:'failed',error:error instanceof Error?error.message:'Unable to start update.'})}
  finally{setInstalling(false)}
 }
 async function safeCleanup(){
  if(agent?.status==='running')return;
  if(!window.confirm('Run safe Docker cleanup now?\n\nThis removes only dangling images and build cache older than 7 days. It does NOT remove containers, volumes, databases or backups.'))return;
  setCleaning(true);
  try{
   const r=await fetch('/api/admin/maintenance',{method:'POST',headers:{'x-crakhost-action':'safe-cleanup'}});const j=await r.json();setAgent(j);
   if(!r.ok)throw new Error(j.error||'Unable to start maintenance cleanup.');
  }catch(error){setAgent({status:'failed',job_kind:'maintenance',error:error instanceof Error?error.message:'Unable to start maintenance cleanup.'})}
  finally{setCleaning(false)}
 }

 useEffect(()=>{void check();void readAgent();void readHealth();const id=window.setInterval(()=>void readHealth(),15000);return()=>window.clearInterval(id)},[]);
 useEffect(()=>{if(agent?.status!=='running')return;const id=window.setInterval(()=>void readAgent(),2000);return()=>window.clearInterval(id)},[agent?.status]);
 useEffect(()=>{
  if(!agent?.job_id||!['success','failed','interrupted'].includes(String(agent.status)))return;
  if(completedJob.current===agent.job_id)return;
  completedJob.current=agent.job_id;
  void check();void readHealth();
 },[agent?.job_id,agent?.status]);

 const running=agent?.status==='running';
 const maintenanceRunning=running&&agent?.job_kind==='maintenance';
 const updateLabel=running&&!maintenanceRunning?'Updating…':installing?'Starting…':u?.update_available&&u.latest?`Install ${u.latest}`:'Re-apply latest';
 const agentLabel=running?(maintenanceRunning?'Maintenance running':'Update running'):agent?.status==='success'?(agent?.job_kind==='maintenance'?'Last cleanup succeeded':'Last update succeeded'):agent?.status==='failed'?(agent?.job_kind==='maintenance'?'Last cleanup failed':'Last update failed'):agent?.status==='interrupted'?'Job interrupted':agent?.status==='unavailable'?'Agent unavailable':'Ready';
 const diskPct=health?.disk?.percent;
 const memPct=health?.memory?.percent;
 const dockerImages=health?.docker_df?.find(x=>String(x.Type||'').toLowerCase().includes('image'));
 const dockerBuild=health?.docker_df?.find(x=>String(x.Type||'').toLowerCase().includes('build'));

 return <>
  <section className="opsHero">
   <div className="heroCopy"><div className="eyebrow">PRODUCTION CONTROL</div><h1>Deployment, health & <span>maintenance</span></h1><p>Install production updates, watch VPS health and run restricted maintenance jobs from one admin page.</p></div>
   <div className="heroActions">
    <button className="btn" onClick={check} disabled={loading||running}><RefreshCw size={14}/>{loading?'Checking':'Check releases'}</button>
    <button className="btn" onClick={applyUpdate} disabled={installing||running||!agent||agent?.status==='unavailable'} title={agent?.status==='unavailable'?'Updater agent must be installed on the VPS first.':''}>{running&&!maintenanceRunning||installing?<Loader2 size={14}/>:<DownloadCloud size={14}/>} {updateLabel}</button>
   </div>
  </section>

  <section className="deployGrid panelSection">
   <Card label="Installed version" value={u?.installed||'Unknown'} icon={<Server size={14}/>}/>
   <Card label="Latest production" value={u?.latest||'Unknown'} icon={<GitBranch size={14}/>}/>
   <Card label="Updater state" value={agentLabel} icon={running?<Loader2 size={14}/>:agent?.status==='failed'||agent?.status==='interrupted'?<AlertTriangle size={14}/>:<ShieldCheck size={14}/>}/>
  </section>

  <section className="card panelSection">
   <div className="panelSectionHead"><div><h2>Server health & maintenance</h2><p>Read-only host metrics come from the restricted local updater agent. No browser shell is exposed.</p></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btn" onClick={readHealth} disabled={healthLoading}><RefreshCw size={13}/>{healthLoading?'Refreshing':'Refresh health'}</button><button className="btn" onClick={safeCleanup} disabled={running||cleaning||agent?.status==='unavailable'}><Trash2 size={13}/>{maintenanceRunning?'Cleaning…':cleaning?'Starting…':'Safe cleanup'}</button></div></div>
   {health?.error&&<div className="notice error">{health.error}</div>}
   {health?.warnings?.map((w,i)=><div key={i} className="notice error" style={{marginBottom:8}}><AlertTriangle size={14}/>{w}</div>)}
   <div className="deployGrid" style={{marginTop:12}}>
    <Card label="CPU usage" value={health?.cpu_percent==null?'—':`${health.cpu_percent}%`} icon={<Activity size={14}/>}/>
    <Card label="Memory usage" value={memPct==null?'—':`${memPct}%`} icon={<Server size={14}/>}/>
    <Card label="Root disk" value={diskPct==null?'—':`${diskPct}%`} icon={<HardDrive size={14}/>}/>
   </div>
   <div className="releaseBox" style={{marginTop:14}}>
    <div className="timelineRow"><span><b>Disk free</b><small>{health?.disk?`${humanBytes(health.disk.used_bytes)} used of ${humanBytes(health.disk.total_bytes)}`:'Waiting for host metrics'}</small></span><b>{humanBytes(health?.disk?.free_bytes)}</b></div>
    <div className="timelineRow"><span><b>Backup storage</b><small>CrakHost updater/database backups</small></span><b>{humanBytes(health?.backup_bytes)}</b></div>
    <div className="timelineRow"><span><b>Docker reclaimable</b><small>{dockerImages?`Images ${dockerImages.Size||'—'} total`: 'Docker image storage'} · {dockerBuild?`Build cache ${dockerBuild.Size||'—'}`:'build cache'}</small></span><b>{[dockerImages?.Reclaimable,dockerBuild?.Reclaimable].filter(Boolean).join(' + ')||'—'}</b></div>
    <div className="timelineRow"><span><b>Load / uptime</b><small>{health?.load?.length?`Load ${health.load.join(' / ')}`:'Load unavailable'}</small></span><b>{humanDuration(health?.uptime_seconds)}</b></div>
   </div>
   <div style={{marginTop:16}}><div className="panelSectionHead"><div><h3 style={{margin:0}}>CrakHost services</h3><p>Compose services including panel, node, database and mail stack.</p></div><small>{health?.collected_at?`Updated ${new Date(health.collected_at).toLocaleTimeString()}`:''}</small></div>
    <div className="releaseBox">{health?.services?.length?health.services.map(s=><div className="timelineRow" key={`${s.service}-${s.name}`}><span><b>{s.service||s.name}</b><small>{s.name}</small></span><b style={{color:serviceHealthy(s.status)?'#86efac':'#fca5a5'}}>{s.status||'Unknown'}</b></div>):<div className="timelineRow"><span><b>Services</b><small>No Compose service data returned yet.</small></span><b>—</b></div>}</div>
   </div>
   <div className="notice" style={{marginTop:14}}><Trash2 size={14}/><span><b>Safe cleanup policy:</b> only dangling Docker images and build cache older than 7 days are removed. Containers, volumes, databases, customer data and backups are left untouched.</span></div>
  </section>

  <section className="card panelSection">
   <div className="panelSectionHead"><div><h2>Release status</h2><p>Production version is read from the repository main branch, so a GitHub Release tag is not required.</p></div>{u?.release_url&&<a className="btn" href={u.release_url} target="_blank" rel="noreferrer">Source <ExternalLink size={13}/></a>}</div>
   {u?.error?<div className="notice error">{u.error}</div>:<div className="releaseBox"><div className="timelineRow"><span><b>Installed</b><small>Version reported by the running panel</small></span><b>{u?.installed||'Unknown'}</b></div><div className="timelineRow"><span><b>Latest</b><small>{u?.name||'Production main branch'}</small></span><b>{u?.latest||'Unknown'}</b></div><div className="timelineRow"><span><b>State</b><small>{u?.message||'Version comparison'}</small></span><b>{u?.update_available?'Update available':'Up to date'}</b></div></div>}
  </section>

  <section className="card panelSection">
   <div className="panelSectionHead"><div><h2>Privileged job monitor</h2><p>Update and maintenance jobs are fixed server-side actions. Arbitrary shell commands are never accepted from the browser.</p></div><div style={{display:'flex',alignItems:'center',gap:8,color:'#9da7ba'}}>{agent?.status==='success'?<CheckCircle2 size={15}/>:agent?.status==='failed'||agent?.status==='interrupted'?<AlertTriangle size={15}/>:<Terminal size={15}/>}<b>{agentLabel}</b></div></div>
   {agent?.error&&<div className="notice error">{agent.error}</div>}
   <div className="releaseBox"><div className="timelineRow"><span><b>Agent</b><small>Root-owned local Unix-socket service on the VPS</small></span><b>{agent?.agent_version?`v${agent.agent_version}`:agent?.status==='unavailable'?'Offline':'Checking'}</b></div><div className="timelineRow"><span><b>Job</b><small>{agent?.started_at?`Started ${new Date(agent.started_at).toLocaleString()}`:'No active privileged job'}</small></span><b>{agent?.job_id?`${agent.job_kind||'job'} · ${agent.job_id.slice(0,8)}`:'-'}</b></div><div className="timelineRow"><span><b>Result</b><small>{agent?.finished_at?`Finished ${new Date(agent.finished_at).toLocaleString()}`:'Backup → fetch/build or fixed maintenance → verify'}</small></span><b>{agent?.exit_code==null?agentLabel:`Exit ${agent.exit_code}`}</b></div></div>
   <pre style={{marginTop:16,maxHeight:360,overflow:'auto',whiteSpace:'pre-wrap',wordBreak:'break-word',fontSize:12,lineHeight:1.6,padding:16,border:'1px solid rgba(148,163,184,.16)',borderRadius:14,background:'rgba(3,7,18,.55)'}}>{agent?.log_tail||'No privileged job log yet.'}</pre>
  </section>

  <section className="card panelSection">
   <div className="panelSectionHead"><div><h2>Recent deployment & maintenance history</h2><p>Last completed privileged jobs persisted by the host agent.</p></div><Clock3 size={16}/></div>
   <div className="releaseBox">{agent?.history?.length?agent.history.slice(0,8).map(h=><div className="timelineRow" key={h.job_id||`${h.started_at}-${h.job_kind}`}><span><b>{h.job_kind==='maintenance'?'Maintenance cleanup':'Production update'}</b><small>{h.started_at?new Date(h.started_at).toLocaleString():'Unknown start'}{h.finished_at?` → ${new Date(h.finished_at).toLocaleString()}`:''}</small></span><b style={{color:h.status==='success'?'#86efac':h.status==='failed'?'#fca5a5':'inherit'}}>{h.status||'unknown'}{h.exit_code==null?'':` · ${h.exit_code}`}</b></div>):<div className="timelineRow"><span><b>History</b><small>History starts with v0.53 jobs.</small></span><b>Empty</b></div>}</div>
  </section>

  <section className="deployGrid panelSection"><div className="deployCard"><span>One-click production update</span><strong>Backup + migrate + verify</strong><p className="small">Updates create a PostgreSQL backup first, refresh main, rebuild the panel, restart CrakNode and verify service health.</p></div><div className="deployCard"><span>Manual fallback</span><strong>Safe updater</strong><p className="small">SSH remains available as a recovery path if the panel or updater agent cannot be reached.</p><code className="codeBlock">cd /opt/crakhost &amp;&amp; sudo ./scripts/update-production.sh</code></div><div className="deployCard"><span>Security boundary</span><strong>No browser shell</strong><p className="small">The panel talks to a root-owned Unix socket using a server-side secret. Only health, update and safe cleanup actions exist.</p></div></section>
 </>;
}

function Card({label,value,icon}:{label:string;value:string;icon:React.ReactNode}){return <div className="deployCard"><span>{label}</span><strong>{value}</strong><div style={{marginTop:9,color:'#8f99ae'}}>{icon}</div></div>}
function humanBytes(value?:number|null){if(value==null||Number.isNaN(value))return'—';const units=['B','KiB','MiB','GiB','TiB'];let n=value,i=0;while(n>=1024&&i<units.length-1){n/=1024;i++}return`${n>=10||i===0?n.toFixed(0):n.toFixed(1)} ${units[i]}`}
function humanDuration(value?:number|null){if(value==null)return'—';const d=Math.floor(value/86400),h=Math.floor(value%86400/3600),m=Math.floor(value%3600/60);return d>0?`${d}d ${h}h`:h>0?`${h}h ${m}m`:`${m}m`}
function serviceHealthy(status?:string){const s=String(status||'').toLowerCase();return s.startsWith('up')&&!s.includes('unhealthy')}
