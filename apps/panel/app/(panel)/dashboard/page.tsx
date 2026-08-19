import Link from 'next/link';
import {Plus,Bell,Cpu,MemoryStick,HardDrive,Activity,ArrowUpRight,Server as ServerIcon} from 'lucide-react';
import {db} from '@/lib/db';
import {nodeFetchFor} from '@/lib/node';

export const dynamic='force-dynamic';
export const revalidate=0;

type LiveServer={id:string,name:string,identifier:string,status:string,memory_mb:number,cpu_limit:number,disk_mb:number,primary_ip:string,primary_port:number,node_name:string,node_location:string,node_id:string|null,base_url?:string,api_token?:string,live?:any};
type LiveNode={id:string,name:string,location:string,status:string,latencyMs:number,managedContainers?:number,runningContainers?:number,diskFreeBytes?:number,dockerVersion?:string,error?:string};

export default async function Dashboard(){
  const [serverQ,nodeQ,revenueQ]=await Promise.all([
    db.query(`select s.id,s.name,s.identifier,s.status,s.memory_mb,s.cpu_limit,s.disk_mb,s.primary_ip,s.primary_port,s.node_id,n.name node_name,n.location node_location,n.base_url,n.api_token from servers s left join nodes n on n.id=s.node_id order by s.created_at desc limit 25`),
    db.query(`select id,name,location,base_url,api_token,enabled,capacity_cpu,capacity_memory_mb,capacity_disk_mb from nodes where enabled=true order by name`),
    db.query(`select coalesce(sum(amount),0)::numeric amount,coalesce(max(currency),'LKR') currency from invoices where status='PAID' and paid_at>=date_trunc('month',now())`)
  ]);

  const nodes:LiveNode[]=[];
  for(const n of nodeQ.rows){
    const started=Date.now();
    try{const d=await nodeFetchFor(n,'/diagnostics');nodes.push({id:n.id,name:n.name,location:n.location,status:'online',latencyMs:Date.now()-started,...d});}
    catch(e:any){nodes.push({id:n.id,name:n.name,location:n.location,status:'offline',latencyMs:Date.now()-started,error:e?.message||'Node unavailable'});}
  }

  const servers:LiveServer[]=await Promise.all(serverQ.rows.map(async(s:any)=>{
    if(!s.node_id||!s.base_url)return {...s,status:'offline'};
    try{const live=await nodeFetchFor(s,`/v1/servers/${encodeURIComponent(s.identifier)}/status`);return {...s,status:String(live.status||s.status||'offline'),live};}
    catch{return {...s,status:'offline'};}
  }));

  const running=servers.filter(s=>s.status==='running').length;
  const cpuAllocated=serverQ.rows.reduce((a:number,s:any)=>a+Number(s.cpu_limit||0),0);
  const memoryAllocated=serverQ.rows.reduce((a:number,s:any)=>a+Number(s.memory_mb||0),0);
  const cpuCapacity=nodeQ.rows.reduce((a:number,n:any)=>a+Number(n.capacity_cpu||0),0);
  const memoryCapacity=nodeQ.rows.reduce((a:number,n:any)=>a+Number(n.capacity_memory_mb||0),0);
  const cpuPct=cpuCapacity>0?Math.min(100,Math.round(cpuAllocated/cpuCapacity*100)):0;
  const memPct=memoryCapacity>0?Math.min(100,Math.round(memoryAllocated/memoryCapacity*100)):0;
  const revenue=Number(revenueQ.rows[0]?.amount||0);
  const currency=String(revenueQ.rows[0]?.currency||'LKR');

  return <>
    <div className="pageHead"><div><p>CRAKHOST CLOUD</p><h1>Infrastructure Overview</h1><p>Live data from PostgreSQL and registered CrakNode agents.</p></div><div className="actions"><Link className="btn" href="/operations"><Bell size={15}/>Operations</Link><Link className="btn indigo" href="/servers/create"><Plus size={15}/>Deploy Server</Link></div></div>
    <div className="grid4">
      <Metric icon={<Activity size={16}/>} label="Servers" value={String(servers.length)} sub={`${running} running · ${Math.max(0,servers.length-running)} offline/stopped`}/>
      <Metric icon={<Cpu size={16}/>} label="CPU Allocated" value={`${cpuPct}%`} sub={`${fmt(cpuAllocated)} / ${fmt(cpuCapacity)} vCPU configured`}/>
      <Metric icon={<MemoryStick size={16}/>} label="Memory Allocated" value={`${fmtGB(memoryAllocated)} GB`} sub={`${memPct}% of ${fmtGB(memoryCapacity)} GB node capacity`}/>
      <Metric icon={<HardDrive size={16}/>} label="Paid This Month" value={`${currency} ${revenue.toLocaleString()}`} sub="Calculated from paid invoices"/>
    </div>

    <section className="section"><div className="sectionTitle">Real Servers</div><div className="serverTable">
      {servers.length===0?<div className="serverRow"><div><div className="serverName">No servers provisioned</div><div className="serverSub">Deploy a Minecraft or FiveM server to see it here.</div></div></div>:servers.map(s=><div className="serverRow" key={s.id}>
        <div><div className="serverName">{s.name}</div><div className="serverSub">{s.node_name||'No node'} · {s.primary_ip}:{s.primary_port}</div></div>
        <div className="hideSm"><div className={`status ${s.status==='running'?'':'offline'}`}><span className="pulse"/>{s.status.toUpperCase()}</div></div>
        <div className="hideMd"><div className="small">RAM</div>{s.live?.memory?`${Math.round(Number(s.live.memory))} MB / `:''}{fmtGB(Number(s.memory_mb))} GB</div>
        <div className="hideSm"><div className="small">CPU</div>{s.live?.cpu!=null?`${Number(s.live.cpu).toFixed(1)}% live`:`${fmt(Number(s.cpu_limit))} vCPU`}</div>
        <div className="hideMd"><div className="small">DISK LIMIT</div>{fmtGB(Number(s.disk_mb))} GB</div>
        <Link className="btn" href={`/servers/${s.identifier}`}><ArrowUpRight size={15}/></Link>
      </div>)}
    </div></section>

    <section className="section twoCol">
      <div className="card"><div className="sectionTitle">Node Capacity</div><div className="list">{nodeQ.rows.length===0?<div className="small">No nodes registered.</div>:nodeQ.rows.map((n:any)=>{const live=nodes.find(x=>x.id===n.id);return <div className="listItem" key={n.id}><div><b style={{fontSize:12}}>{n.name}</b><div className="small" style={{marginTop:4}}>{n.location} · {fmt(Number(n.capacity_cpu))} vCPU · {fmtGB(Number(n.capacity_memory_mb))} GB RAM</div></div><span className="badge">{live?.status==='online'?'ONLINE':'OFFLINE'}</span></div>})}</div></div>
      <div className="card"><div className="sectionTitle">Live Node Health</div><div className="list">{nodes.length===0?<div className="small">No live CrakNode data.</div>:nodes.map(n=><div className="listItem" key={n.id}><div><b style={{fontSize:12}}>{n.name}</b><div className="small" style={{marginTop:4}}>{n.status==='online'?`${n.latencyMs} ms · ${n.runningContainers||0}/${n.managedContainers||0} managed running · ${fmtBytes(n.diskFreeBytes||0)} free`:n.error||'Node unavailable'}</div></div><span className="badge">{n.status.toUpperCase()}</span></div>)}</div></div>
    </section>
  </>;
}

function Metric({icon,label,value,sub}:{icon:React.ReactNode,label:string,value:string,sub:string}){return <div className="card"><div className="metricTop"><span>{label}</span>{icon}</div><div className="metricValue">{value}</div><div className="small">{sub}</div></div>}
function fmt(v:number){return Number.isFinite(v)?Number(v.toFixed(2)).toString():'0'}
function fmtGB(mb:number){return Number.isFinite(mb)?Number((mb/1024).toFixed(1)).toString():'0'}
function fmtBytes(v:number){if(!v)return '0 GB';return `${(v/1024/1024/1024).toFixed(1)} GB`}
