'use client';
import {useEffect,useMemo,useState} from 'react';
import styles from './PublicStatusPage.module.css';

type Range='DAY'|'1H'|'5M'|'1M'|'1S';
type LivePoint={status:string;latencyMs:number|null;at:string};
const ranges:{key:Range;label:string}[]=[
  {key:'DAY',label:'DAY'},
  {key:'1H',label:'1H'},
  {key:'5M',label:'5M'},
  {key:'1M',label:'1M'},
  {key:'1S',label:'LIVE (1S)'}
];

export default function PublicStatusPage(){
  const[range,setRange]=useState<Range>('1S');
  const[data,setData]=useState<any>(null);
  const[error,setError]=useState('');
  const[busy,setBusy]=useState(false);
  const[clock,setClock]=useState('00:00:00');
  const[liveSeries,setLiveSeries]=useState<Record<string,LivePoint[]>>({});

  async function load(target:Range=range){
    setBusy(true);
    try{
      const r=await fetch(`/api/public/status?range=${encodeURIComponent(target)}`,{cache:'no-store'});
      const j=await r.json();
      if(!r.ok&&r.status!==503)throw new Error(j.error||'Status unavailable');
      setData(j);setError('');
      if(target==='1S'&&Array.isArray(j.components)){
        setLiveSeries(prev=>{
          const next={...prev};
          for(const component of j.components){
            const id=String(component.id);const list=[...(next[id]||[])];
            list.push({status:String(component.status||'outage'),latencyMs:Number.isFinite(Number(component.latencyMs))?Number(component.latencyMs):null,at:String(j.generatedAt||new Date().toISOString())});
            next[id]=list.slice(-15);
          }
          return next;
        });
      }
    }catch(e:any){setError(e?.message||'Status unavailable')}
    finally{setBusy(false)}
  }

  useEffect(()=>{
    void load(range);
    const tick=()=>{if(!document.hidden)void load(range)};
    const id=window.setInterval(tick,range==='1S'?1000:10000);
    document.addEventListener('visibilitychange',tick);
    return()=>{window.clearInterval(id);document.removeEventListener('visibilitychange',tick)};
  },[range]);
  useEffect(()=>{
    const update=()=>setClock(new Date().toLocaleTimeString(undefined,{hour12:false}));
    update();const id=window.setInterval(update,1000);return()=>window.clearInterval(id);
  },[]);

  const overall=String(data?.overall||'outage');
  const pulse=overall==='operational'?'STABLE':overall==='maintenance'?'MAINTENANCE':overall==='degraded'?'DEGRADED':'DISRUPTION';
  const pulseClass=overall==='operational'?styles.pulseGood:overall==='degraded'||overall==='maintenance'?styles.pulseWarn:styles.pulseBad;
  const activeIncident=Array.isArray(data?.activeIncidents)?data.activeIncidents[0]:null;
  const activeRangeLabel=range==='1S'?'REAL-TIME (1S)':data?.rangeLabel||range;
  const components=Array.isArray(data?.components)?data.components:[];
  const title=String(data?.title||'CrakHost Status');
  const logo=String(data?.logoUrl||'');

  return <main className={styles.shell}>
    <div className={styles.nebula}/>
    <section className={styles.dashboard}>
      <header className={styles.header}>
        <div className={styles.logoWrap}>
          {logo?<img src={logo} alt={title} className={styles.logoImg}/>:null}
          <div><h1 className={styles.brand}>CrakHost <span>Hologram</span></h1><p className={styles.kicker}>VIRTUAL INFRASTRUCTURE LIVE</p></div>
        </div>
        <div className={styles.controls}>
          <div className={styles.resPillBox} aria-label="Uptime history resolution">
            {ranges.map(item=><button key={item.key} type="button" className={`${styles.resPill} ${range===item.key?styles.resPillActive:''}`} onClick={()=>setRange(item.key)}>{item.label}</button>)}
          </div>
          <div className={styles.clock}>{clock}</div>
        </div>
      </header>

      {activeIncident?<div className={styles.incident}><span className={styles.incidentBadge}>{String(activeIncident.status||'incident')}</span><strong>{activeIncident.title}</strong><span className={styles.incidentText}>{activeIncident.message}</span></div>:null}

      <div className={styles.grid}>
        {components.length?components.slice(0,12).map((item:any)=><HoloCard key={item.id} item={item} range={range} live={liveSeries[String(item.id)]||[]}/>):<div className={styles.empty}>{error||'Waiting for public status components…'}</div>}
      </div>

      <footer className={styles.footer}>
        <span>SYSTEM PULSE: <span className={pulseClass}>{pulse}</span></span>
        <span className={styles.activeView}>ACTIVE VIEW: {activeRangeLabel}</span>
        <span className={styles.copyright}>© CRAKHOST ELITE</span>
      </footer>
      {busy?<div className={styles.refreshing}>SYNCING LIVE TELEMETRY</div>:null}
    </section>
  </main>
}

function HoloCard({item,range,live}:{item:any;range:Range;live:LivePoint[]}){
  const bars=useMemo(()=>range==='1S'?liveBars(live):historyBars(item.history),[range,live,item.history]);
  const liveUptime=useMemo(()=>{
    const known=live.filter(x=>x.status!=='maintenance');if(!known.length)return null;
    return known.filter(x=>x.status==='operational').length*100/known.length;
  },[live]);
  const raw=range==='1S'?liveUptime:Number(item.uptimeRange);
  const uptime=Number.isFinite(Number(raw))?Number(raw):null;
  const status=String(item.status||'outage');
  const stateLabel=status==='operational'?'ACTIVE':status==='maintenance'?'MAINTENANCE':status==='degraded'?'DEGRADED':'OUTAGE';
  const latency=Number.isFinite(Number(item.latencyMs))?`${Math.round(Number(item.latencyMs))}ms`:'--';
  return <article className={styles.card}>
    <div className={styles.cardHead}>
      <div style={{minWidth:0}}><h3 className={styles.serviceName}>{item.name}</h3><p className={styles.serviceDetail}>{item.detail||'Node: Stable'}</p></div>
      <div className={styles.state} style={{color:status==='operational'?'#00ffaa':status==='degraded'?'#f8b84e':status==='maintenance'?'#b894ff':'#ff477e'}}>{stateLabel}</div>
    </div>
    <div className={`${styles.uptime} ${uptime===null?styles.uptimeMuted:''}`}>{uptime===null?'--':`${uptime.toFixed(uptime>=99.995?2:uptime>=99?2:1)}%`}</div>
    <div className={styles.bars}>{bars.map((bar:any,index:number)=>{
      const level=bar?.uptime;const last=index===bars.length-1;const liveNow=range==='1S'&&last&&bar?.known;
      const cls=level===null||level===undefined?styles.barUnknown:level>=99?styles.barGood:level>=90?styles.barWarn:styles.barBad;
      const height=10+((index*7+String(item.id).length*3)%16);
      return <span key={`${bar?.key||index}-${index}`} title={bar?.title||''} className={`${styles.bar} ${cls} ${liveNow?styles.barLive:''}`} style={{height:liveNow?30:height}}/>;
    })}</div>
    <div className={styles.meta}><span>LATENCY: {latency}</span><span>{range==='1S'?`${live.length}/15 LIVE SAMPLES`:`${Number(item.sampleCount||0)} SAMPLES`}</span><span>{range}</span></div>
  </article>
}

function historyBars(history:any){
  if(!Array.isArray(history)||!history.length)return Array.from({length:30},(_,i)=>({key:i,uptime:null,title:'No sample',known:false}));
  return history.map((h:any,i:number)=>({key:h.bucket||i,uptime:h.uptime===null?null:Number(h.uptime),known:Number(h.samples||0)>0,title:`${fmtShort(h.bucket)} · ${h.uptime===null?'No sample':`${h.uptime}% uptime`} · ${h.samples||0} samples`}));
}
function liveBars(points:LivePoint[]){
  const padded:Array<LivePoint|null>=[...Array(Math.max(0,15-points.length)).fill(null),...points.slice(-15)];
  return padded.map((p,i)=>({key:p?.at||i,uptime:p?statusPercent(p.status):null,known:!!p,title:p?`${fmtShort(p.at)} · ${p.status.toUpperCase()}${p.latencyMs!==null?` · ${p.latencyMs}ms`:''}`:'Waiting for live sample'}));
}
function statusPercent(status:string){return status==='operational'?100:status==='maintenance'?null:status==='degraded'?95:0}
function fmtShort(v:any){const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'}):''}
