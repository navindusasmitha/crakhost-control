import Link from 'next/link';
import {Server as ServerIcon,Plus,Activity,Cpu,MemoryStick,HardDrive,Wallet,TerminalSquare,Gamepad2,ArrowUpRight} from 'lucide-react';
import {db} from '@/lib/db';
import {nodeFetchFor} from '@/lib/node';
import {getCurrentUser,isStaff} from '@/lib/auth';

export const dynamic='force-dynamic';
export const revalidate=0;

export default async function Dashboard(){
  const user=await getCurrentUser();
  if(!user)return null;
  const staff=isStaff(user);
  const params:any[]=staff?[]:[user.id];
  const where=staff?'':'where s.owner_id=$1';
  const [serverQ,invoiceQ]=await Promise.all([
    db.query(`select s.id,s.name,s.identifier,s.status,s.memory_mb,s.cpu_limit,s.disk_mb,s.primary_ip,s.primary_port,s.node_id,n.name node_name,n.location,n.base_url,n.api_token from servers s left join nodes n on n.id=s.node_id ${where} order by s.created_at desc limit 24`,params),
    staff?db.query(`select coalesce(sum(amount),0)::numeric amount,coalesce(max(currency),'LKR') currency from invoices where status='PAID' and paid_at>=date_trunc('month',now())`):db.query(`select coalesce(sum(amount),0)::numeric amount,coalesce(max(currency),'LKR') currency from invoices where user_id=$1 and status='PAID' and paid_at>=date_trunc('month',now())`,[user.id])
  ]);
  const servers=await Promise.all(serverQ.rows.map(async(s:any)=>{try{const live=await nodeFetchFor(s,`/v1/servers/${encodeURIComponent(s.identifier)}/status`);return{...s,status:String(live.status||s.status||'offline'),live}}catch{return{...s,status:'offline',live:null}}}));
  const running=servers.filter((s:any)=>s.status==='running').length;
  const totalRam=servers.reduce((a:number,s:any)=>a+Number(s.memory_mb||0),0);
  const totalCpu=servers.reduce((a:number,s:any)=>a+Number(s.cpu_limit||0),0);
  const totalDisk=servers.reduce((a:number,s:any)=>a+Number(s.disk_mb||0),0);
  const spend=Number(invoiceQ.rows[0]?.amount||0),currency=String(invoiceQ.rows[0]?.currency||'LKR');
  const first=servers[0];
  let consoleLines:string[]=[];
  if(first){try{const logs=await nodeFetchFor(first,`/v1/servers/${encodeURIComponent(first.identifier)}/logs`);consoleLines=Array.isArray(logs?.lines)?logs.lines.slice(-10):[]}catch{}}

  return <>
    <section className="dashboardHero"><div className="heroCopy"><div className="eyebrow">CONTROL OVERVIEW</div><h1>{staff?'Infrastructure':'Your hosting'} <span>at a glance</span></h1><p>{running} of {servers.length} servers currently running with live CrakNode status checks.</p></div><div className="heroActions"><Link href="/servers" className="btn"><ServerIcon size={14}/>Server fleet</Link><Link href="/checkout" className="btn indigo"><Plus size={14}/>Deploy server</Link></div></section>

    <section className="surfaceGrid">
      <Metric icon={<ServerIcon size={15}/>} label="Servers" value={servers.length} hint={`${running} running`}/>
      <Metric icon={<Cpu size={15}/>} label="Allocated CPU" value={`${trim(totalCpu)} vCPU`} hint="Purchased allocation"/>
      <Metric icon={<MemoryStick size={15}/>} label="Allocated RAM" value={`${gb(totalRam)} GB`} hint={`${gb(totalDisk)} GB disk`}/>
      <Metric icon={<Wallet size={15}/>} label={staff?'Paid this month':'Spend this month'} value={`${currency} ${spend.toLocaleString()}`} hint="Paid invoices only"/>
    </section>

    <section className="panelSection"><div className="panelSectionHead"><div><h2>Server fleet</h2><p>Runtime status and resource use reported by each assigned node.</p></div><span className="liveChip"><i/>LIVE DATA</span></div>{servers.length===0?<div className="nodeEmpty"><Gamepad2 size={28}/><h3>No servers yet</h3><p>Order a plan to provision the first workload.</p><Link href="/checkout" className="btn indigo">Order server</Link></div>:<div className="fleetList">{servers.map((s:any)=>{const cpu=Math.max(0,Math.min(100,Number(s.live?.cpu||0)));const mem=Number(s.live?.memory||0);const memPct=s.memory_mb?Math.max(0,Math.min(100,mem/Number(s.memory_mb)*100)):0;return <article className="fleetRow" key={s.id}><div className="fleetIdentity"><div className="fleetIcon"><Gamepad2 size={19}/></div><div><b>{s.name}</b><small>{s.primary_ip}:{s.primary_port} · {s.identifier}</small></div></div><div className="fleetCell"><span className={`statusDot ${statusClass(s.status)}`}>{s.status||'unknown'}</span><small>{s.node_name||'Unassigned node'}</small></div><div className="fleetUsage"><div className="fleetUsageLine"><span>CPU</span><b>{cpu.toFixed(1)}%</b></div><div className="fleetBar"><span style={{width:`${cpu}%`}}/></div><small>{trim(Number(s.cpu_limit||0))} vCPU limit</small></div><div className="fleetUsage"><div className="fleetUsageLine"><span>Memory</span><b>{Math.round(mem)} / {Number(s.memory_mb||0)} MB</b></div><div className="fleetBar"><span style={{width:`${memPct}%`}}/></div><small>{gb(Number(s.memory_mb||0))} GB allocation</small></div><Link className="btn" href={`/servers/${s.identifier}`}>Manage <ArrowUpRight size={13}/></Link></article>})}</div>}</section>

    <section className="panelSection"><div className="panelSectionHead"><div><h2>Recent console</h2><p>{first?`Latest output from ${first.name}.`:'Provision a server to start receiving output.'}</p></div>{first&&<Link href={`/servers/${first.identifier}`} className="btn"><TerminalSquare size={13}/>Full console</Link>}</div><div className="clientConsoleCard"><div className="clientConsole">{first?(consoleLines.length?consoleLines.map((line:string,i:number)=><div key={i}>{line}</div>):<div>[CrakHost] No console output reported yet.</div>):<div>[CrakHost] No managed server selected.</div>}</div></div></section>
  </>
}

function Metric({icon,label,value,hint}:{icon:React.ReactNode;label:string;value:any;hint:string}){return <div className="surfaceMetric"><div className="surfaceMetricTop"><span>{label}</span>{icon}</div><strong>{value}</strong><small>{hint}</small></div>}
function gb(mb:number){return Number.isFinite(mb)?Number((mb/1024).toFixed(1)).toString():'0'}
function trim(v:number){return Number.isFinite(v)?Number(v.toFixed(2)).toString():'0'}
function statusClass(v:any){const s=String(v||'unknown').toLowerCase();return ['running','active','online','offline','failed','suspended','provisioning','starting'].includes(s)?s:'unknown'}
