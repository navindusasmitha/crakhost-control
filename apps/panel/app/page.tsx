import Link from 'next/link';
import {ArrowRight,Cpu,Gamepad2,HardDrive,Headphones,LockKeyhole,MapPin,MemoryStick,Server,ShieldCheck,TicketCheck,Zap} from 'lucide-react';
import {db} from '@/lib/db';
import MarketingNav from '@/components/MarketingNav';

export const dynamic='force-dynamic';
const LOGO='https://i.ibb.co/pv5zb3Q5/logo-Photoroom.png';

export default async function Home(){
  const [planQ,nodeQ,serverQ]=await Promise.all([
    db.query(`select id,slug,name,description,memory_mb,cpu_limit,disk_mb,price_monthly,currency,template_slug,featured from plans where enabled=true order by sort_order,price_monthly`),
    db.query(`select id,name,location,capacity_cpu,capacity_memory_mb,capacity_disk_mb,last_seen_at,agent_version from nodes where enabled=true order by last_seen_at desc nulls last,name limit 8`),
    db.query(`select count(*)::int count from servers where status<>'deleted'`),
  ]);
  const plans=planQ.rows,nodes=nodeQ.rows,servers=Number(serverQ.rows[0]?.count||0);
  const now=Date.now();const online=nodes.filter((n:any)=>n.last_seen_at&&now-new Date(n.last_seen_at).getTime()<=90000).length;
  const platform=online>0?'Live':nodes.length?'Degraded':'Unavailable';
  return <main className="publicRoot v49Public"><div className="v49Blob one"/><div className="v49Blob two"/><MarketingNav/>
    <section className="v49Hero">
      <div className="publicEyebrow"><Zap size={11}/>ESTABLISHED 2026 · CRAKNODE POWERED</div>
      <h1>Host your world<br/><span>with real power.</span></h1>
      <p>Deploy and manage game services through CrakHost with automatic provisioning, billing, backups, databases, live console access and account-linked support.</p>
      <div className="v49HeroActions"><Link href="/games" className="publicBtn primary">Get Started <ArrowRight size={14}/></Link><Link href="/locations" className="publicBtn">View Nodes</Link></div>
    </section>

    <section className="v49Stats" aria-label="Live platform statistics">
      <Stat value={nodes.length} label="Nodes"/><Stat value={plans.length} label="Plans"/><Stat value={servers} label="Servers"/><Stat value={platform} label="Status" live={platform==='Live'}/>
    </section>

    <section className="v49Section" id="games">
      <div className="v49SectionHead"><div><span>GAME HOSTING</span><h2>Choose your workload.</h2><p>Every plan below is read from the live billing catalog. Admin changes are reflected here automatically.</p></div><Link href="/games" className="publicBtn">Full catalog <ArrowRight size={13}/></Link></div>
      <div className="v49PlanGrid">{plans.map((p:any)=><article className={`v49Plan ${p.featured?'featured':''}`} key={p.id}>{p.featured&&<div className="v49Featured">FEATURED</div>}<div className="v49PlanType">{String(p.template_slug||'game').toUpperCase()}</div><h3>{p.name}</h3><p>{p.description||'Managed game hosting plan'}</p><div className="v49Price"><span>{p.currency}</span>{Number(p.price_monthly).toLocaleString()}<small>/ 30d</small></div><div className="v49Specs"><div><span>RAM</span><b>{formatGb(p.memory_mb)}</b></div><div><span>vCPU</span><b>{Number(p.cpu_limit)} Core{Number(p.cpu_limit)===1?'':'s'}</b></div><div><span>Disk</span><b>{formatGb(p.disk_mb)}</b></div></div><Link className="v49PlanBtn" href={`/register?plan=${encodeURIComponent(p.slug)}`}>Configure Server <ArrowRight size={13}/></Link></article>)}{plans.length===0&&<div className="v49Empty">No enabled plans are published yet.</div>}</div>
    </section>

    <section className="v49Section v49Split" id="vps">
      <article className="v49Gate"><div className="v49BigIcon"><Server size={30}/></div><div className="v49Eyebrow">CLOUD VPS</div><h2>Virtual machines are gated.</h2><p>VPS checkout stays unavailable until a real supported hypervisor is connected. CrakHost does not display or sell fake VM capacity.</p><div className="v49Locked"><LockKeyhole size={13}/> HYPERVISOR INTEGRATION REQUIRED</div><Link href="/vps" className="publicBtn">View VPS status</Link></article>
      <div className="v49ControlStack"><article><Gamepad2 size={20}/><div><b>Client server workspace</b><p>Console, files, databases, backups, network allocations, schedules, startup and settings.</p></div></article><article><ShieldCheck size={20}/><div><b>Account & billing</b><p>Verified accounts, invoices, wallet history, service lifecycle and security controls.</p></div></article><article><TicketCheck size={20}/><div><b>Support tickets</b><p>Customers can open account-linked tickets and continue staff conversations from the panel.</p></div></article></div>
    </section>

    <section className="v49Section" id="nodes">
      <div className="v49SectionHead"><div><span>REGISTERED INFRASTRUCTURE</span><h2>Live CrakNode capacity.</h2><p>Health and capacity are read from enabled nodes. Missing telemetry stays unavailable instead of being invented.</p></div><Link href="/locations" className="publicBtn">All locations <ArrowRight size={13}/></Link></div>
      <div className="v49NodeList">{nodes.map((n:any)=>{const fresh=!!n.last_seen_at&&now-new Date(n.last_seen_at).getTime()<=90000;return <article className="v49Node" key={n.id}><div className={`v49NodeIcon ${fresh?'online':''}`}><MapPin size={22}/></div><div className="v49NodeIdentity"><div><h3>{n.name}</h3><span className={`v49Status ${fresh?'online':'stale'}`}>{fresh?'ONLINE':'STALE'}</span></div><p>{n.location||'Location not configured'}{n.agent_version?` · Agent ${n.agent_version}`:''}</p></div><div className="v49NodeSpecs"><span><Cpu size={13}/><b>{Number(n.capacity_cpu||0)||'—'}</b> vCPU</span><span><MemoryStick size={13}/><b>{n.capacity_memory_mb?formatGb(n.capacity_memory_mb):'—'}</b> RAM</span><span><HardDrive size={13}/><b>{n.capacity_disk_mb?formatGb(n.capacity_disk_mb):'—'}</b> disk</span></div></article>})}{nodes.length===0&&<div className="v49Empty">No enabled registered nodes are currently published.</div>}</div>
    </section>

    <section className="v49Section" id="support"><div className="v49Support"><div className="v49BigIcon"><Headphones size={28}/></div><div><div className="v49Eyebrow">SUPPORT CENTER</div><h2>Need help?</h2><p>Sign in to open a ticket linked to your account and services. Staff replies stay in the same conversation and can trigger transactional email notifications.</p></div><div className="v49SupportActions"><Link href="/support" className="publicBtn primary">Open Support <ArrowRight size={13}/></Link><Link href="/login" className="publicBtn">Client Area</Link></div></div></section>

    <footer className="v49Footer"><Link className="publicBrand" href="/"><img className="publicLogo" src={LOGO} alt="CrakHost"/><span>CRAK<b>HOST</b></span></Link><p>© 2026 CrakHost Control Plane · Powered by CrakNode.</p><div><Link href="/games">Games</Link><Link href="/locations">Nodes</Link><Link href="/support">Support</Link></div></footer>
  </main>
}

function Stat({value,label,live=false}:{value:string|number;label:string;live?:boolean}){return <div className="v49Stat"><strong className={live?'live':''}>{value}</strong><span>{label}</span></div>}
function formatGb(v:any){const mb=Number(v||0);if(!Number.isFinite(mb)||mb<=0)return '—';const gb=mb/1024;return `${Number(gb.toFixed(gb<10?1:0))} GB`}
