'use client';
import {useEffect,useMemo,useState} from 'react';
import {Activity,CheckCircle2,Clock3,RefreshCw,TriangleAlert,XCircle} from 'lucide-react';

const tone:any={operational:{label:'All Systems Operational',color:'#34d399',bg:'rgba(16,185,129,.12)',icon:CheckCircle2},degraded:{label:'Degraded Performance',color:'#fbbf24',bg:'rgba(245,158,11,.12)',icon:TriangleAlert},outage:{label:'Service Disruption',color:'#fb7185',bg:'rgba(244,63,94,.12)',icon:XCircle},maintenance:{label:'Maintenance in Progress',color:'#a78bfa',bg:'rgba(139,92,246,.12)',icon:Clock3}};

export default function PublicStatusPage(){
  const[data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function load(){setBusy(true);try{const r=await fetch('/api/public/status',{cache:'no-store'});const j=await r.json();if(!r.ok&&r.status!==503)throw new Error(j.error||'Status unavailable');setData(j);setError('')}catch(e:any){setError(e.message||'Status unavailable')}finally{setBusy(false)}}
  useEffect(()=>{void load();const tick=()=>{if(!document.hidden)void load()};const id=window.setInterval(tick,30000);document.addEventListener('visibilitychange',tick);return()=>{window.clearInterval(id);document.removeEventListener('visibilitychange',tick)}},[]);
  const overall=useMemo(()=>tone[data?.overall]||tone.outage,[data]);
  if(!data)return <main style={shell}><div style={wrap}><div style={loading}><RefreshCw className={busy?'spin':''} size={22}/><span>{error||'Loading CrakHost status…'}</span></div></div></main>;
  const OverallIcon=overall.icon;
  return <main style={shell}><div style={wrap}>
    <header style={header}><div style={{display:'flex',alignItems:'center',gap:14}}>{data.logoUrl&&<img src={data.logoUrl} alt="CrakHost" style={{height:46,maxWidth:190,objectFit:'contain'}}/>}<div><h1 style={h1}>{data.title}</h1><p style={sub}>{data.description}</p></div></div><button onClick={load} disabled={busy} style={refresh}><RefreshCw size={15} className={busy?'spin':''}/>Refresh</button></header>
    <section style={{...banner,background:overall.bg,borderColor:`${overall.color}55`,color:overall.color}}><OverallIcon size={22}/><div><b style={{fontSize:17}}>{overall.label}</b><div style={{fontSize:12,opacity:.78,marginTop:2}}>Last checked {fmt(data.generatedAt)}</div></div></section>

    {Array.isArray(data.activeIncidents)&&data.activeIncidents.length>0&&<section style={{marginTop:22}}><h2 style={sectionTitle}>Active incidents</h2><div style={{display:'grid',gap:10}}>{data.activeIncidents.map((x:any)=><article key={x.id} style={incident}><div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center'}}><b>{x.title}</b><span style={pill}>{String(x.status).replace('_',' ')}</span></div><p style={{margin:'8px 0 0',color:'#a9b0bf',fontSize:13,lineHeight:1.6}}>{x.message}</p><small style={{color:'#626a7a'}}>Updated {fmt(x.updatedAt)}</small></article>)}</div></section>}

    <section style={{marginTop:26}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'end',gap:12}}><div><h2 style={sectionTitle}>Services</h2><p style={sub}>Live component health with up to 30 days of CrakNode history.</p></div><Activity size={18} color="#7c83a0"/></div><div style={{display:'grid',gap:12,marginTop:12}}>{(data.components||[]).map((c:any)=><ComponentRow key={c.id} item={c}/>)}</div></section>

    {Array.isArray(data.incidents)&&data.incidents.some((x:any)=>x.status==='resolved')&&<section style={{marginTop:28}}><h2 style={sectionTitle}>Recent incident history</h2><div style={{display:'grid',gap:10}}>{data.incidents.filter((x:any)=>x.status==='resolved').slice(0,8).map((x:any)=><article key={x.id} style={incident}><div style={{display:'flex',justifyContent:'space-between',gap:12}}><b>{x.title}</b><span style={{...pill,color:'#34d399'}}>resolved</span></div><p style={{margin:'6px 0',color:'#8f97a8',fontSize:12}}>{x.message}</p><small style={{color:'#626a7a'}}>Resolved {fmt(x.resolvedAt||x.updatedAt)}</small></article>)}</div></section>}

    <footer style={footer}>Powered by CrakHost Control · Public status refreshes automatically.</footer>
  </div></main>
}

function ComponentRow({item}:{item:any}){const t=tone[item.status]||tone.outage;const Icon=t.icon;return <article style={component}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:14}}><div><b style={{fontSize:14}}>{item.name}</b><div style={{color:'#747d90',fontSize:11,marginTop:3}}>{item.detail}</div></div><span style={{display:'inline-flex',alignItems:'center',gap:6,color:t.color,fontSize:11,fontWeight:800}}><Icon size={14}/>{String(item.status).toUpperCase()}</span></div><div style={{display:'flex',gap:3,marginTop:14,alignItems:'stretch'}}>{(item.history||[]).map((h:any)=><span key={h.day} title={`${h.day}: ${h.uptime===null?'No samples':`${h.uptime}%`}`} style={{height:24,flex:1,borderRadius:3,background:h.uptime===null?'#202532':h.uptime>=99?'#22c55e':h.uptime>=90?'#f59e0b':'#ef4444',opacity:h.uptime===null?.55:.9}}/>)}</div><div style={{display:'flex',justifyContent:'space-between',marginTop:7,color:'#596173',fontSize:10}}><span>30 days ago</span><span>{item.uptime30d===null?'History collecting':`${item.uptime30d}% uptime`}</span><span>Today</span></div></article>}
function fmt(v:any){const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString():''}
const shell:React.CSSProperties={minHeight:'100vh',background:'radial-gradient(circle at 50% -10%,rgba(99,102,241,.14),transparent 30%),#07080d',color:'#eef0f7',fontFamily:'Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',padding:'36px 16px'};
const wrap:React.CSSProperties={width:'min(920px,100%)',margin:'0 auto'};
const header:React.CSSProperties={display:'flex',justifyContent:'space-between',alignItems:'center',gap:18,flexWrap:'wrap',padding:'8px 0 22px'};
const h1:React.CSSProperties={margin:0,fontSize:26,lineHeight:1.1};const sub:React.CSSProperties={margin:'6px 0 0',color:'#7f8798',fontSize:12,lineHeight:1.5};
const refresh:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:7,border:'1px solid #252b39',background:'#10131b',color:'#cdd2dd',padding:'9px 12px',borderRadius:10,cursor:'pointer'};
const banner:React.CSSProperties={display:'flex',alignItems:'center',gap:12,border:'1px solid',borderRadius:15,padding:'17px 18px'};
const sectionTitle:React.CSSProperties={fontSize:15,margin:0,color:'#f3f4f8'};
const component:React.CSSProperties={background:'rgba(15,17,24,.88)',border:'1px solid #202531',borderRadius:15,padding:'16px 17px'};
const incident:React.CSSProperties={background:'#10131b',border:'1px solid #252b39',borderRadius:13,padding:'14px 15px'};
const pill:React.CSSProperties={border:'1px solid #303748',borderRadius:999,padding:'4px 8px',fontSize:9,textTransform:'uppercase',letterSpacing:'.06em',color:'#c1c6d3'};
const footer:React.CSSProperties={padding:'30px 0 8px',textAlign:'center',color:'#4f5768',fontSize:11};const loading:React.CSSProperties={minHeight:'70vh',display:'flex',alignItems:'center',justifyContent:'center',gap:10,color:'#8b93a5'};
