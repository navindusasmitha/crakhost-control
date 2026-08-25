"use client";
import{useEffect,useRef,useState}from'react';
import{RefreshCw,GitBranch,ShieldCheck,Server,ExternalLink,DownloadCloud,Loader2,Terminal,CheckCircle2,AlertTriangle}from'lucide-react';

type UpdateInfo={
 installed?:string;
 latest?:string;
 name?:string;
 published_at?:string|null;
 update_available?:boolean;
 release_url?:string;
 channel?:string;
 message?:string;
 error?:string;
};

type AgentStatus={
 status?:'idle'|'running'|'success'|'failed'|'interrupted'|'unavailable'|string;
 job_id?:string|null;
 pid?:number|null;
 started_at?:string|null;
 finished_at?:string|null;
 exit_code?:number|null;
 agent_version?:string;
 log_tail?:string;
 error?:string;
};

export default function DeploymentCenter(){
 const[u,setU]=useState<UpdateInfo|null>(null);
 const[agent,setAgent]=useState<AgentStatus|null>(null);
 const[loading,setLoading]=useState(false);
 const[installing,setInstalling]=useState(false);
 const completedJob=useRef<string|null>(null);

 async function check(){
  setLoading(true);
  try{
   const r=await fetch('/api/admin/update/check',{cache:'no-store'});
   const j=await r.json();
   setU(j);
  }catch{
   setU({error:'Unable to reach update service'});
  }finally{setLoading(false)}
 }

 async function readAgent(){
  try{
   const r=await fetch('/api/admin/update/status',{cache:'no-store'});
   const j=await r.json();
   if(r.ok)setAgent(j);
   else setAgent(prev=>prev?.status==='running'?{...prev,error:'Panel is reconnecting to the updater agent...'}:j);
  }catch{
   setAgent(prev=>prev?.status==='running'?{...prev,error:'Panel is restarting; update monitoring will reconnect automatically.'}:{status:'unavailable',error:'Updater agent is unavailable.'});
  }
 }

 async function applyUpdate(){
  if(agent?.status==='running')return;
  const label=u?.update_available&&u.latest?`Install ${u.latest}`:'Re-apply the latest production build';
  if(!window.confirm(`${label} now?\n\nCrakHost will create a database backup, rebuild the panel, run migrations and restart services. The panel may disconnect briefly.`))return;
  setInstalling(true);
  try{
   const r=await fetch('/api/admin/update/apply',{
    method:'POST',
    headers:{'x-crakhost-action':'apply-update'}
   });
   const j=await r.json();
   setAgent(j);
   if(!r.ok)throw new Error(j.error||'Unable to start update.');
  }catch(error){
   setAgent({status:'failed',error:error instanceof Error?error.message:'Unable to start update.'});
  }finally{setInstalling(false)}
 }

 useEffect(()=>{void check();void readAgent()},[]);
 useEffect(()=>{
  if(agent?.status!=='running')return;
  const id=window.setInterval(()=>void readAgent(),2000);
  return()=>window.clearInterval(id);
 },[agent?.status]);
 useEffect(()=>{
  if(!agent?.job_id||!['success','failed','interrupted'].includes(String(agent.status)))return;
  if(completedJob.current===agent.job_id)return;
  completedJob.current=agent.job_id;
  void check();
 },[agent?.job_id,agent?.status]);

 const running=agent?.status==='running';
 const updateLabel=running?'Updating…':installing?'Starting…':u?.update_available&&u.latest?`Install ${u.latest}`:'Re-apply latest';
 const agentLabel=running?'Update running':agent?.status==='success'?'Last update succeeded':agent?.status==='failed'?'Last update failed':agent?.status==='interrupted'?'Update interrupted':agent?.status==='unavailable'?'Agent unavailable':'Ready';

 return <>
  <section className="opsHero">
   <div className="heroCopy">
    <div className="eyebrow">PRODUCTION CONTROL</div>
    <h1>Deployment & <span>updates</span></h1>
    <p>Check the production branch and install CrakHost updates directly from this admin page through the restricted host updater.</p>
   </div>
   <div className="heroActions">
    <button className="btn" onClick={check} disabled={loading||running}><RefreshCw size={14}/>{loading?'Checking':'Check releases'}</button>
    <button className="btn" onClick={applyUpdate} disabled={installing||running||!agent||agent?.status==='unavailable'} title={agent?.status==='unavailable'?'Updater agent must be installed on the VPS first.':''}>
     {running||installing?<Loader2 size={14}/>:<DownloadCloud size={14}/>}
     {updateLabel}
    </button>
   </div>
  </section>

  <section className="deployGrid panelSection">
   <Card label="Installed version" value={u?.installed||'Unknown'} icon={<Server size={14}/>}/>
   <Card label="Latest production" value={u?.latest||'Unknown'} icon={<GitBranch size={14}/>}/>
   <Card label="Updater state" value={agentLabel} icon={running?<Loader2 size={14}/>:agent?.status==='failed'||agent?.status==='interrupted'?<AlertTriangle size={14}/>:<ShieldCheck size={14}/>}/>
  </section>

  <section className="card panelSection">
   <div className="panelSectionHead">
    <div><h2>Release status</h2><p>Production version is read from the repository main branch, so a GitHub Release tag is no longer required.</p></div>
    {u?.release_url&&<a className="btn" href={u.release_url} target="_blank" rel="noreferrer">Source <ExternalLink size={13}/></a>}
   </div>
   {u?.error?<div className="notice error">{u.error}</div>:<div className="releaseBox">
    <div className="timelineRow"><span><b>Installed</b><small>Version reported by the running panel</small></span><b>{u?.installed||'Unknown'}</b></div>
    <div className="timelineRow"><span><b>Latest</b><small>{u?.name||'Production main branch'}</small></span><b>{u?.latest||'Unknown'}</b></div>
    <div className="timelineRow"><span><b>State</b><small>{u?.message||'Version comparison'}</small></span><b>{u?.update_available?'Update available':'Up to date'}</b></div>
   </div>}
  </section>

  <section className="card panelSection">
   <div className="panelSectionHead">
    <div><h2>In-panel updater</h2><p>Only ADMIN sessions can request the fixed production updater. No arbitrary shell command is accepted from the browser.</p></div>
    <div style={{display:'flex',alignItems:'center',gap:8,color:'#9da7ba'}}>
     {agent?.status==='success'?<CheckCircle2 size={15}/>:agent?.status==='failed'||agent?.status==='interrupted'?<AlertTriangle size={15}/>:<Terminal size={15}/>}
     <b>{agentLabel}</b>
    </div>
   </div>
   {agent?.error&&<div className="notice error">{agent.error}</div>}
   <div className="releaseBox">
    <div className="timelineRow"><span><b>Agent</b><small>Root-owned local Unix-socket service on the VPS</small></span><b>{agent?.agent_version?`v${agent.agent_version}`:agent?.status==='unavailable'?'Offline':'Checking'}</b></div>
    <div className="timelineRow"><span><b>Job</b><small>{agent?.started_at?`Started ${new Date(agent.started_at).toLocaleString()}`:'No active update'}</small></span><b>{agent?.job_id?agent.job_id.slice(0,10):'-'}</b></div>
    <div className="timelineRow"><span><b>Result</b><small>{agent?.finished_at?`Finished ${new Date(agent.finished_at).toLocaleString()}`:'Backup → fetch → build → migrate → verify'}</small></span><b>{agent?.exit_code==null?agentLabel:`Exit ${agent.exit_code}`}</b></div>
   </div>
   <pre style={{marginTop:16,maxHeight:360,overflow:'auto',whiteSpace:'pre-wrap',wordBreak:'break-word',fontSize:12,lineHeight:1.6,padding:16,border:'1px solid rgba(148,163,184,.16)',borderRadius:14,background:'rgba(3,7,18,.55)'}}>{agent?.log_tail||'No update log yet. Start an update and progress will appear here.'}</pre>
  </section>

  <section className="deployGrid panelSection">
   <div className="deployCard"><span>One-click production update</span><strong>Backup + migrate + verify</strong><p className="small">The update button creates a PostgreSQL backup first, refreshes main, rebuilds the panel, restarts CrakNode and verifies both services.</p></div>
   <div className="deployCard"><span>Manual fallback</span><strong>Safe updater</strong><p className="small">SSH remains available as a recovery path if the panel or updater agent cannot be reached.</p><code className="codeBlock">cd /opt/crakhost &amp;&amp; sudo ./scripts/update-production.sh</code></div>
   <div className="deployCard"><span>Security boundary</span><strong>No browser shell</strong><p className="small">The panel talks to a root-owned Unix socket using a server-side secret. The agent exposes only status and the fixed CrakHost update action.</p></div>
  </section>
 </>;
}

function Card({label,value,icon}:{label:string;value:string;icon:React.ReactNode}){
 return <div className="deployCard"><span>{label}</span><strong>{value}</strong><div style={{marginTop:9,color:'#8f99ae'}}>{icon}</div></div>;
}
