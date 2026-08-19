'use client';
import {Play,RotateCw,Square,Terminal,RefreshCw} from 'lucide-react';
import {useCallback,useEffect,useRef,useState} from 'react';

type Status={status?:string;cpu?:number;cpuRaw?:number;cpuLimit?:number;memory?:number;memoryLimit?:number;uptime?:string;health?:string;error?:string};
const GRAPH_POINTS=24;
const clamp=(n:number,min=0,max=100)=>Math.min(max,Math.max(min,Number.isFinite(n)?n:0));

export default function ServerControl({id}:{id:string}){
  const [s,setS]=useState<Status>({status:'checking',cpu:0,memory:0,memoryLimit:8192,uptime:'-'});
  const [lines,setLines]=useState<string[]>(['[CrakHost] Connecting to CrakNode...']);
  const [busy,setBusy]=useState('');
  const [cmd,setCmd]=useState('');
  const [cpuHistory,setCpuHistory]=useState<number[]>(Array(GRAPH_POINTS).fill(0));
  const [memHistory,setMemHistory]=useState<number[]>(Array(GRAPH_POINTS).fill(0));
  const consoleRef=useRef<HTMLDivElement>(null);

  const refresh=useCallback(async()=>{
    try{
      const [a,b]=await Promise.all([
        fetch(`/api/servers/${id}/status`,{cache:'no-store'}),
        fetch(`/api/servers/${id}/logs`,{cache:'no-store'})
      ]);
      const stat=await a.json();
      setS(stat);
      const cpu=clamp(Number(stat.cpu||0));
      const mem=clamp(((Number(stat.memory)||0)/(Number(stat.memoryLimit)||8192))*100);
      setCpuHistory(h=>[...h.slice(-(GRAPH_POINTS-1)),cpu]);
      setMemHistory(h=>[...h.slice(-(GRAPH_POINTS-1)),mem]);
      const l=await b.json();
      if(Array.isArray(l.lines))setLines(l.lines.map((x:unknown)=>String(x)));
    }catch{
      setS(x=>({...x,status:'node_offline'}));
    }
  },[id]);

  useEffect(()=>{refresh();const t=setInterval(refresh,2500);return()=>clearInterval(t)},[refresh]);
  useEffect(()=>{consoleRef.current?.scrollTo({top:consoleRef.current.scrollHeight})},[lines]);

  async function action(a:string){
    setBusy(a);
    try{
      const r=await fetch(`/api/servers/${id}/action`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:a})});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||'Action failed');
      await refresh();
    }catch(e:any){setLines(x=>[...x,`[CrakHost] ${e.message}`])}
    finally{setBusy('')}
  }

  async function send(){
    const c=cmd.trim();if(!c||s.status!=='running')return;
    setCmd('');setLines(x=>[...x,`> ${c}`]);
    try{
      const r=await fetch(`/api/servers/${id}/command`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command:c})});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||'Command failed');
      if(d.output)setLines(x=>[...x,String(d.output)]);
    }catch(e:any){setLines(x=>[...x,`[CrakHost] ${e.message}`])}
    setTimeout(refresh,500);
  }

  const running=s.status==='running';
  const offline=s.status==='offline'||s.status==='exited'||s.status==='created';
  const memPct=clamp(((s.memory||0)/(s.memoryLimit||8192))*100);
  const cpuPct=clamp(Number(s.cpu||0));

  return <>
    <div className="actions serverActions">
      <span className={`runtimeBadge ${running?'onlineState':s.status==='node_offline'?'offlineState':''}`}>{s.status||'unknown'}</span>
      <button className="btn green" onClick={()=>action('start')} disabled={!!busy||running}><Play size={14}/>START</button>
      <button className="btn orange" onClick={()=>action('restart')} disabled={!!busy||!running}><RotateCw size={14}/>RESTART</button>
      <button className="btn rose" onClick={()=>action('stop')} disabled={!!busy||offline}><Square size={14}/>STOP</button>
      <button className="btn" onClick={refresh} disabled={!!busy}><RefreshCw size={14}/></button>
    </div>

    <div className="grid4 runtimeGrid">
      <Runtime label="CPU Usage" value={`${cpuPct.toFixed(1)}%`} pct={cpuPct} sub={s.cpuRaw&&s.cpuRaw>100?`Raw Docker: ${s.cpuRaw.toFixed(1)}% · ${s.cpuLimit||'?'} CPU limit`:undefined}/>
      <Runtime label="Memory" value={`${formatMb(s.memory||0)} / ${formatMb(s.memoryLimit||8192)}`} pct={memPct} kind="purple"/>
      <Runtime label="Node Link" value={s.status==='node_offline'?'Offline':'Secured'} pct={s.status==='node_offline'?0:100} kind="green"/>
      <div className="card"><div className="metricTop"><span>Uptime</span><Terminal size={15}/></div><div className="metricValue" style={{fontSize:23}}>{cleanUptime(s.uptime)}</div><div className="small">CrakNode v0.10 · protected API{s.health?` · ${s.health}`:''}</div></div>
    </div>

    <section className="section twoCol serverMonitorGrid">
      <div className="card graphCard">
        <div className="sectionTitle graphTitle"><span>Live Resource Graph</span><span className="graphLegend"><b>CPU</b><b>RAM</b></span></div>
        <div className="chart" aria-label="Live CPU and memory graph">
          {cpuHistory.map((h,i)=><div className="chartColumn" key={i}><i className="cpuBar" style={{height:`${clamp(h)}%`}}/><i className="memBar" style={{height:`${clamp(memHistory[i]||0)}%`}}/></div>)}
        </div>
      </div>
      <div className="card consoleCard">
        <div className="sectionTitle">Live Console</div>
        <div className="console" ref={consoleRef}>{lines.slice(-120).map((l,i)=><div key={i} className={l.includes('Done')||l.includes('CrakHost')?'ok':l.startsWith('>')?'accent':''}>{l}</div>)}</div>
        <div className="consoleInput"><input value={cmd} disabled={!running} onChange={e=>setCmd(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()} placeholder={running?'Type a console command...':'Start the server to use console'}/><button className="btn indigo" disabled={!running||!cmd.trim()} onClick={send}>Send</button></div>
      </div>
    </section>
  </>
}

function Runtime({label,value,pct,kind,sub}:{label:string,value:string,pct:number,kind?:string,sub?:string}){
  return <div className="card"><div className="metricTop"><span>{label}</span></div><div className="metricValue" style={{fontSize:23}}>{value}</div><div className={`progress ${kind||''}`}><span style={{width:`${clamp(pct)}%`}}/></div>{sub&&<div className="small metricSub">{sub}</div>}</div>
}
function formatMb(v:number){return v>=1024?`${(v/1024).toFixed(1)} GB`:`${Math.round(v)} MB`}
function cleanUptime(v?:string){if(!v||v.includes('â')||v==='—')return '-';return v}
