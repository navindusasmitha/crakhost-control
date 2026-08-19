import Link from 'next/link';
import {Server as ServerIcon,Plus,RotateCcw,Power,TerminalSquare,Gamepad2,Wallet,Cpu,MemoryStick} from 'lucide-react';
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
  const serverQ=await db.query(`select s.id,s.name,s.identifier,s.status,s.memory_mb,s.cpu_limit,s.disk_mb,s.primary_ip,s.primary_port,s.node_id,n.name node_name,n.location,n.base_url,n.api_token from servers s left join nodes n on n.id=s.node_id ${where} order by s.created_at desc limit 20`,params);
  const invoiceQ=staff?await db.query(`select coalesce(sum(amount),0)::numeric amount,coalesce(max(currency),'LKR') currency from invoices where status='PAID' and paid_at>=date_trunc('month',now())`):await db.query(`select coalesce(sum(amount),0)::numeric amount,coalesce(max(currency),'LKR') currency from invoices where user_id=$1 and status='PAID' and paid_at>=date_trunc('month',now())`,[user.id]);
  const servers=await Promise.all(serverQ.rows.map(async(s:any)=>{try{const live=await nodeFetchFor(s,`/v1/servers/${encodeURIComponent(s.identifier)}/status`);return{...s,status:String(live.status||s.status||'offline'),live}}catch{return{...s,status:'offline',live:null}}}));
  const first=servers[0];
  let consoleLines:string[]=[];
  if(first){try{const logs=await nodeFetchFor(first,`/v1/servers/${encodeURIComponent(first.identifier)}/logs`);consoleLines=Array.isArray(logs?.lines)?logs.lines.slice(-12):[]}catch{}}
  const running=servers.filter((s:any)=>s.status==='running').length;
  const totalRam=servers.reduce((a:number,s:any)=>a+Number(s.memory_mb||0),0);
  const totalCpu=servers.reduce((a:number,s:any)=>a+Number(s.cpu_limit||0),0);
  const spend=Number(invoiceQ.rows[0]?.amount||0),currency=String(invoiceQ.rows[0]?.currency||'LKR');
  return <>
    <div className="clientHero"><div><h1>Manage <span>{staff?'Infrastructure':'Servers'}</span></h1><p>{running}/{servers.length} servers online · live CrakNode data</p></div><div className="actions"><Link className="btn" href="/servers"><ServerIcon size={14}/>All Servers</Link><Link className="btn indigo" href="/checkout"><Plus size={14}/>Deploy</Link></div></div>

    <div className="clientKpis">
      <div className="clientKpi"><span>Servers</span><strong>{servers.length}</strong></div>
      <div className="clientKpi"><span>Running</span><strong>{running}</strong></div>
      <div className="clientKpi"><span>Allocated RAM</span><strong>{fmtGB(totalRam)} GB</strong></div>
      <div className="clientKpi"><span>{staff?'Revenue this month':'Spend this month'}</span><strong>{currency} {spend.toLocaleString()}</strong></div>
    </div>

    {servers.length===0?<div className="clientEmpty"><Gamepad2 size={34} style={{margin:'0 auto 12px',color:'#a855f7'}}/><h3>No servers yet</h3><p>Order a plan and CrakHost will provision your first real workload automatically.</p><Link className="marketingPrimary" href="/checkout">Order Server</Link></div>:<div className="clientServerGrid">{servers.map((s:any)=>{
      const cpuLive=Math.max(0,Math.min(100,Number(s.live?.cpu||0)));
      const memoryUsed=Number(s.live?.memory||0);
      const memoryPct=s.memory_mb?Math.max(0,Math.min(100,memoryUsed/Number(s.memory_mb)*100)):0;
      const online=s.status==='running';
      return <article className="clientServerCard" key={s.id}>
        <div className="clientServerTop"><div className="clientServerIdentity"><div className="clientServerIcon"><Gamepad2 size={23}/></div><div><h3>{s.name}</h3><span className="clientAddress">{s.primary_ip}:{s.primary_port}</span></div></div><span className={`clientStatus ${online?'online':'offline'}`}>{s.status}</span></div>
        <div className="clientResources"><div><div className="clientResourceHead"><span>CPU Threads</span><b>{cpuLive.toFixed(1)}%</b></div><div className="clientProgress"><span style={{width:`${cpuLive}%`}}/></div><div className="small" style={{marginTop:7}}><Cpu size={11} style={{verticalAlign:'middle'}}/> {Number(s.cpu_limit)} vCPU limit</div></div><div><div className="clientResourceHead"><span>Memory</span><b>{Math.round(memoryUsed)} / {s.memory_mb} MB</b></div><div className="clientProgress"><span style={{width:`${memoryPct}%`}}/></div><div className="small" style={{marginTop:7}}><MemoryStick size={11} style={{verticalAlign:'middle'}}/> {fmtGB(Number(s.memory_mb))} GB limit</div></div></div>
        <div className="clientControls"><Link href={`/servers/${s.identifier}`} className="clientManage">Manage</Link><Link href={`/servers/${s.identifier}`} className="clientIconBtn restart" title="Restart from server page"><RotateCcw size={16}/></Link><Link href={`/servers/${s.identifier}`} className="clientIconBtn stop" title="Power controls"><Power size={16}/></Link></div>
      </article>})}</div>}

    <section className="clientConsoleCard"><div className="clientConsoleHeader"><h3>Live Console {first&&<span style={{color:'#a855f7'}}>· {first.name}</span>}</h3><span className="streaming">{first?'Streaming data':'No server selected'}</span></div><div className="clientConsole">{first?(consoleLines.length?consoleLines.map((line:string,i:number)=><div key={i}>{line}</div>):<div>[CrakHost] No console lines available yet. Open the server to start or inspect it.</div>):<div>[CrakHost] Provision a server to enable live console output.</div>}</div>{first&&<div style={{marginTop:10,display:'flex',justifyContent:'space-between',gap:10}}><Link className="btn" href={`/servers/${first.identifier}`}><TerminalSquare size={14}/>View Full Console</Link><Link className="btn" href="/billing"><Wallet size={14}/>Billing</Link></div>}</section>
  </>
}

function fmtGB(mb:number){return Number.isFinite(mb)?Number((mb/1024).toFixed(1)).toString():'0'}
