'use client';
import Link from 'next/link';
import {useEffect,useMemo,useState} from 'react';
import {BellRing,CheckCircle2,Clock3,HardDrive,LifeBuoy,PackageOpen,RefreshCw,Server,ShieldAlert,TriangleAlert,Wrench} from 'lucide-react';

export default function AlertCenter(){
  const[data,setData]=useState<any>(null);
  const[busy,setBusy]=useState(false);
  const[msg,setMsg]=useState('');
  const[actionKey,setActionKey]=useState('');
  const[filter,setFilter]=useState<'active'|'all'>('active');

  async function load(silent=false){
    if(!silent)setBusy(true);
    try{
      const r=await fetch('/api/admin/alerts',{cache:'no-store'});
      const j=await r.json();
      if(!r.ok)throw new Error(j.error||'Alert check failed');
      setData(j);setMsg('');
    }catch(e:any){setMsg(e.message||'Alert check failed')}
    finally{if(!silent)setBusy(false)}
  }
  useEffect(()=>{
    void load();
    const tick=()=>{if(!document.hidden)void load(true)};
    const id=window.setInterval(tick,30000);
    document.addEventListener('visibilitychange',tick);
    return()=>{window.clearInterval(id);document.removeEventListener('visibilitychange',tick)};
  },[]);

  async function act(action:string,key?:string,keys?:string[]){
    setActionKey(key||action);setMsg('');
    try{
      const r=await fetch('/api/admin/alerts',{method:'POST',headers:{'content-type':'application/json','x-crakhost-action':'alert-ack'},body:JSON.stringify({action,key,keys})});
      const j=await r.json();
      if(!r.ok)throw new Error(j.error||'Alert action failed');
      await load(true);
    }catch(e:any){setMsg(e.message||'Alert action failed')}
    finally{setActionKey('')}
  }

  const items=useMemo(()=>{
    const all=Array.isArray(data?.alerts)?data.alerts:[];
    return filter==='active'?all.filter((a:any)=>!a.acknowledgedAt):all;
  },[data,filter]);

  if(!data)return <><section className="opsHero"><div className="heroCopy"><div className="eyebrow">ALERT CENTER</div><h1>Operational <span>alerting</span></h1><p>Checking nodes, host pressure, provisioning, backups and priority support.</p></div></section><div className="card panelSection"><div className="emptyState">{busy?'Evaluating production signals…':msg||'No alert data available.'}</div></div></>;

  const s=data.summary||{};
  const activeKeys=(data.alerts||[]).filter((a:any)=>!a.acknowledgedAt).map((a:any)=>a.key);
  return <>
    <section className="opsHero"><div className="heroCopy"><div className="eyebrow">PRODUCTION ALERT CENTER</div><h1>Signals, incidents & <span>acknowledgements</span></h1><p>One live queue for host pressure, CrakNode heartbeat, provisioning failures, stalled orders, backup failures and priority support.</p></div><div className="heroActions"><Link className="btn" href="/operations"><Wrench size={14}/>Operations</Link><button className="btn indigo" onClick={()=>load()} disabled={busy}><RefreshCw size={14} className={busy?'spin':''}/>{busy?'Checking':'Refresh alerts'}</button></div></section>

    <section className="adminOverview panelSection">
      <Metric icon={<BellRing size={15}/>} label="Unacknowledged" value={s.unacknowledged||0} hint={`${s.total||0} active signals`}/>
      <Metric icon={<ShieldAlert size={15}/>} label="Critical" value={s.critical||0} hint="Immediate attention"/>
      <Metric icon={<TriangleAlert size={15}/>} label="Warnings" value={s.warning||0} hint="Operational review"/>
      <Metric icon={<CheckCircle2 size={15}/>} label="Acknowledged" value={s.acknowledged||0} hint={`Auto-resurface after ${data.acknowledgementTtlHours||12}h`}/>
    </section>

    {msg&&<div className="notice error panelSection">{msg}</div>}
    <section className="card panelSection">
      <div className="panelSectionHead"><div><h2>Active production signals</h2><p>Generated from current platform state. Acknowledgements are temporary so unresolved conditions resurface automatically.</p></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className={`btn ${filter==='active'?'indigo':''}`} onClick={()=>setFilter('active')}>Active</button><button className={`btn ${filter==='all'?'indigo':''}`} onClick={()=>setFilter('all')}>All</button>{data.canAcknowledge&&activeKeys.length>0&&<button className="btn" disabled={!!actionKey} onClick={()=>act('acknowledge_all',undefined,activeKeys)}><CheckCircle2 size={13}/>Acknowledge all</button>}</div></div>
      {items.length?<div className="timelineList">{items.map((a:any)=><AlertRow key={a.key} alert={a} canAck={!!data.canAcknowledge} busy={actionKey===a.key} onAck={(action:string)=>act(action,a.key)}/>)}</div>:<div className="emptyState">{filter==='active'?'No unacknowledged alerts. Production signals are clear.':'No alerts are active right now.'}</div>}
    </section>

    <section className="twoCol panelSection">
      <div className="card adminSurface"><div className="panelSectionHead"><div><h2>What is monitored</h2><p>Alert evaluation stays inside the CrakHost control plane.</p></div><BellRing size={15}/></div><div className="releaseBox"><Monitor icon={<Server size={14}/>} title="CrakNode heartbeat" text="Warns on delayed heartbeats and escalates nodes with no recent heartbeat."/><Monitor icon={<HardDrive size={14}/>} title="Host pressure" text="Tracks root disk, memory, CPU and updater-agent availability."/><Monitor icon={<PackageOpen size={14}/>} title="Provisioning flow" text="Surfaces failed orders and paid/provisioning jobs stalled for more than 30 minutes."/><Monitor icon={<LifeBuoy size={14}/>} title="Support & backups" text="Highlights HIGH/URGENT tickets and backup failures from the last 24 hours."/></div></div>
      <div className="card adminSurface"><div className="panelSectionHead"><div><h2>Acknowledgement policy</h2><p>Acknowledging suppresses noise without hiding unresolved production state forever.</p></div><Clock3 size={15}/></div><div className="releaseBox"><div className="timelineRow"><span><b>Temporary acknowledgement</b><small>Each acknowledgement expires after {data.acknowledgementTtlHours||12} hours.</small></span><span className="statusDot online">SAFE</span></div><div className="timelineRow"><span><b>No destructive action</b><small>Acknowledging an alert does not restart services, mutate orders, delete backups or change customer data.</small></span><span className="statusDot online">READ SAFE</span></div><div className="timelineRow"><span><b>Audit trail</b><small>Admin acknowledgement actions are written to the existing audit log.</small></span><span className="statusDot online">AUDITED</span></div></div></div>
    </section>
  </>
}

function AlertRow({alert,canAck,busy,onAck}:{alert:any;canAck:boolean;busy:boolean;onAck:(action:string)=>void}){
  const cls=alert.severity==='critical'?'failed':alert.severity==='warning'?'provisioning':'online';
  return <div className="timelineRow"><span style={{minWidth:0,flex:1}}><b>{alert.title}</b><small>{String(alert.category||'system').toUpperCase()} · {alert.detail} · {ago(alert.createdAt)}</small>{alert.acknowledgedAt&&<small>ACKNOWLEDGED · {ago(alert.acknowledgedAt)}</small>}</span><div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',justifyContent:'flex-end'}}><span className={`statusDot ${cls}`}>{alert.severity}</span><Link className="btn" href={alert.href||'/operations'}>Open</Link>{canAck&&(alert.acknowledgedAt?<button className="btn" disabled={busy} onClick={()=>onAck('unacknowledge')}>Unacknowledge</button>:<button className="btn" disabled={busy} onClick={()=>onAck('acknowledge')}><CheckCircle2 size={13}/>Acknowledge</button>)}</div></div>
}
function Metric({icon,label,value,hint}:{icon:React.ReactNode;label:string;value:any;hint:string}){return <div className="surfaceMetric"><div className="surfaceMetricTop"><span>{label}</span>{icon}</div><strong>{value}</strong><small>{hint}</small></div>}
function Monitor({icon,title,text}:{icon:React.ReactNode;title:string;text:string}){return <div className="timelineRow"><span><b>{title}</b><small>{text}</small></span>{icon}</div>}
function ago(value:any){const t=new Date(value).getTime();if(!Number.isFinite(t))return'unknown time';const s=Math.max(0,Math.round((Date.now()-t)/1000));if(s<60)return`${s}s ago`;if(s<3600)return`${Math.floor(s/60)}m ago`;if(s<86400)return`${Math.floor(s/3600)}h ago`;return`${Math.floor(s/86400)}d ago`}
