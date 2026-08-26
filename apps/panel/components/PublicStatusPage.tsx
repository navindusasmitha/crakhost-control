'use client';
import {useEffect,useMemo,useState} from 'react';
import styles from './PublicStatusPage.module.css';

const REFRESH_SECONDS=60;
const HISTORY_POINTS=10;

export default function PublicStatusPage(){
  const[data,setData]=useState<any>(null);
  const[error,setError]=useState('');
  const[busy,setBusy]=useState(false);
  const[clock,setClock]=useState('00:00:00');
  const[countdown,setCountdown]=useState(REFRESH_SECONDS);

  async function load(){
    setBusy(true);
    try{
      const r=await fetch('/api/public/status',{cache:'no-store'});
      const j=await r.json();
      if(!r.ok&&r.status!==503)throw new Error(j.error||'Status unavailable');
      setData(j);setError('');setCountdown(REFRESH_SECONDS);
    }catch(e:any){setError(e?.message||'Status unavailable')}
    finally{setBusy(false)}
  }

  useEffect(()=>{
    void load();
    const refresh=window.setInterval(()=>{if(!document.hidden)void load()},REFRESH_SECONDS*1000);
    const visible=()=>{if(!document.hidden)void load()};
    document.addEventListener('visibilitychange',visible);
    return()=>{window.clearInterval(refresh);document.removeEventListener('visibilitychange',visible)};
  },[]);

  useEffect(()=>{
    const tick=()=>{
      setClock(new Date().toLocaleTimeString(undefined,{hour12:false}));
      setCountdown(v=>v<=1?REFRESH_SECONDS:v-1);
    };
    tick();const id=window.setInterval(tick,1000);return()=>window.clearInterval(id);
  },[]);

  const overall=String(data?.overall||'outage');
  const components=Array.isArray(data?.components)?data.components:[];
  const incidents=Array.isArray(data?.activeIncidents)?data.activeIncidents:[];
  const title=String(data?.title||'CrakHost Status');
  const logo=String(data?.logoUrl||'');
  const global=globalState(overall);

  return <main className={styles.shell}>
    <section className={styles.wrapper}>
      <header className={styles.header}>
        <div className={styles.brand}>
          {logo?<img src={logo} alt={title} className={styles.logoImg}/>:null}
          <div className={styles.brandText}>
            <h1>{title}</h1>
            <p>LIVE INFRASTRUCTURE · 1 MINUTE MONITORING</p>
          </div>
        </div>
        <div className={`${styles.globalStatus} ${styles[global.className]}`}>
          <span className={styles.pulseDot}/>{global.label}
        </div>
        <div className={styles.clockBox}>
          <span className={styles.clock}>{clock}</span>
          <small>NEXT SYNC {countdown}s</small>
        </div>
      </header>

      {incidents.length>0?<div className={styles.incidentStrip}>
        <strong>{incidents[0].title}</strong><span>{incidents[0].message}</span><em>{String(incidents[0].status||'investigating').toUpperCase()}</em>
      </div>:null}

      <div className={styles.dashboardGrid}>
        {components.length?components.map((item:any)=><StatusCard key={item.id} item={item}/>):<div className={styles.empty}>{error||'Waiting for status data…'}</div>}
      </div>

      <footer className={styles.footer}>
        <span>© 2026 CRAKHOST INFRASTRUCTURE · LAST 10 MINUTES SAVED</span>
        <span className={styles.footerCenter}>LAST UPDATE: {formatTime(data?.generatedAt)}</span>
        <span className={styles.scanning}>{busy?'SYNCING TELEMETRY…':'SCANNING GLOBAL NODES…'}</span>
      </footer>
    </section>
  </main>
}

function StatusCard({item}:{item:any}){
  const status=String(item.status||'outage');
  const state=cardState(status);
  const uptime=Number.isFinite(Number(item.uptime10m))?Number(item.uptime10m):null;
  const latency=Number.isFinite(Number(item.latencyMs))?`${Math.round(Number(item.latencyMs))}ms`:'--';
  const bars=useMemo(()=>normalizeHistory(item.history),[item.history]);
  const known=bars.filter(x=>x.samples>0).length;
  return <article className={styles.card}>
    <div className={styles.cardHeader}>
      <div className={styles.titleArea}>
        <h2>{item.name}</h2>
        <p>{item.detail||'Operational'}</p>
      </div>
      <div className={`${styles.activeBadge} ${styles[state.className]}`}>{state.label}</div>
    </div>

    <div className={styles.statsRow}>
      <div className={`${styles.mainPct} ${uptime===null?styles.mutedPct:''}`}>{uptime===null?'--':`${uptime.toFixed(2)}%`}</div>
      <div className={styles.latencyLabel}>LATENCY: {latency}</div>
    </div>

    <div className={styles.heartbeatWrap}>
      <div className={styles.bars}>
        {bars.map((bar,index)=>{
          const latest=index===bars.length-1&&bar.samples>0;
          const tone=bar.uptime===null?styles.barUnknown:bar.uptime>=99?styles.barGood:bar.uptime>=90?styles.barWarn:styles.barBad;
          const height=18+((index*5+String(item.id).length*3)%13);
          return <span key={`${bar.bucket}-${index}`} className={`${styles.bar} ${tone} ${latest?styles.barLive:''}`} style={{height:latest?35:height}} title={barTitle(bar)}/>;
        })}
      </div>
      <div className={styles.barFooter}>
        <span>{known}/{HISTORY_POINTS} MINUTE SAMPLES</span>
        <span className={styles.resolution}>1 MIN RESOLUTION · LAST 10M</span>
      </div>
    </div>
  </article>
}

function normalizeHistory(history:any):Array<{bucket:string;uptime:number|null;samples:number}>{
  const raw=Array.isArray(history)?history.slice(-HISTORY_POINTS):[];
  const mapped=raw.map((x:any)=>({bucket:String(x.bucket||''),uptime:x.uptime===null||x.uptime===undefined?null:Number(x.uptime),samples:Number(x.samples||0)}));
  const missing=Math.max(0,HISTORY_POINTS-mapped.length);
  return [...Array.from({length:missing},(_,i)=>({bucket:`pending-${i}`,uptime:null,samples:0})),...mapped];
}
function barTitle(bar:{bucket:string;uptime:number|null;samples:number}){
  if(!bar.samples)return 'No saved sample for this minute';
  const d=new Date(bar.bucket);const time=Number.isFinite(d.getTime())?d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}):bar.bucket;
  return `${time} · ${bar.uptime===null?'maintenance':`${bar.uptime.toFixed(2)}% uptime`} · ${bar.samples} sample${bar.samples===1?'':'s'}`;
}
function formatTime(v:any){const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleTimeString(undefined,{hour12:false}):'--:--:--'}
function globalState(status:string){
  if(status==='operational')return{label:'SYSTEMS OPERATIONAL',className:'good'};
  if(status==='maintenance')return{label:'MAINTENANCE MODE',className:'maintenance'};
  if(status==='degraded')return{label:'DEGRADED PERFORMANCE',className:'warning'};
  return{label:'SERVICE DISRUPTION',className:'danger'};
}
function cardState(status:string){
  if(status==='operational')return{label:'ACTIVE',className:'good'};
  if(status==='maintenance')return{label:'MAINTENANCE',className:'maintenance'};
  if(status==='degraded')return{label:'DEGRADED',className:'warning'};
  return{label:'OUTAGE',className:'danger'};
}
