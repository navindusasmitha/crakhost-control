import Link from 'next/link';
import {ArrowRight,Check,Gamepad2,Headphones,MapPin,Server,ShieldCheck,Zap} from 'lucide-react';
import {db} from '@/lib/db';
import MarketingNav from '@/components/MarketingNav';
export const dynamic='force-dynamic';

function gb(mb:any){return Math.round(Number(mb||0)/1024)}

export default async function Home(){
 const [planQ,nodeQ,serverQ]=await Promise.all([
  db.query(`select slug,name,description,memory_mb,cpu_limit,disk_mb,price_monthly,currency,featured,template_slug from plans where enabled=true order by featured desc,sort_order,price_monthly limit 3`),
  db.query(`select name,location,capacity_cpu,capacity_memory_mb,capacity_disk_mb,last_seen_at,agent_version from nodes where enabled=true order by last_seen_at desc nulls last limit 3`),
  db.query(`select count(*)::int count from servers where status<>'deleted'`)
 ]);
 const plans=planQ.rows,nodes=nodeQ.rows,servers=Number(serverQ.rows[0]?.count||0);
 const onlineNodes=nodes.filter((n:any)=>n.last_seen_at&&Date.now()-new Date(n.last_seen_at).getTime()<=90000).length;
 return <main className="publicRoot"><MarketingNav/>
  <section className="publicHero">
   <div className="publicHeroCopy">
    <div className="publicEyebrow"><Zap size={11}/>ESTABLISHED 2026</div>
    <h1>Host your world.<br/><span>With real power.</span></h1>
    <p>Deploy game services through CrakNode with live runtime controls, customer billing, backups, databases, support tickets and automatic provisioning in one control plane.</p>
    <div className="publicHeroActions"><Link href="/games" className="publicBtn primary">Get Started <ArrowRight size={14}/></Link><Link href="/locations" className="publicBtn">View Nodes</Link></div>
   </div>
   <aside className="publicHeroPanel">
    <div className="publicHeroPanelHead"><span>LIVE PLATFORM</span><span className="publicLive">{onlineNodes>0?'CONTROL PLANE ONLINE':'NO LIVE NODE'}</span></div>
    <div className="publicStatList">
     <div className="publicStatRow"><span>Enabled plans</span><strong>{plans.length}</strong></div>
     <div className="publicStatRow"><span>Registered nodes</span><strong>{nodes.length}</strong></div>
     <div className="publicStatRow"><span>Managed servers</span><strong>{servers}</strong></div>
     <div className="publicStatRow"><span>Runtime</span><strong>CrakNode</strong></div>
    </div>
   </aside>
  </section>

  <section className="publicStats"><div className="publicStat"><strong>{nodes.length}</strong><span>Nodes</span></div><div className="publicStat"><strong>{plans.length}</strong><span>Plans Shown</span></div><div className="publicStat"><strong>{servers}</strong><span>Servers</span></div><div className="publicStat"><strong>{onlineNodes>0?'Live':'—'}</strong><span>Status</span></div></section>

  <section className="publicSection" id="plans">
   <div className="publicSectionHead"><div><div className="publicEyebrow"><Gamepad2 size={11}/>GAME HOSTING</div><h2>Choose your workload.</h2><p>Pricing and resource limits are read from the enabled CrakHost plan catalog. Admin changes appear here automatically.</p></div></div>
   <div className="publicPlanGrid">{plans.map((p:any)=><article className={`publicPlan ${p.featured?'featured':''}`} key={p.slug}>{p.featured&&<div className="publicPopular">FEATURED</div>}<h3>{p.name}</h3><p>{p.description||p.template_slug||'Game hosting plan'}</p><div className="publicPrice"><span>{p.currency} </span>{Number(p.price_monthly).toLocaleString()} <small>/ 30d</small></div><ul><li><Check/> {gb(p.memory_mb)} GB RAM</li><li><Check/> {Number(p.cpu_limit)} vCPU</li><li><Check/> {gb(p.disk_mb)} GB disk</li><li><Check/> Automatic provisioning</li></ul><Link className="publicBtn primary" style={{width:'100%'}} href={`/register?plan=${encodeURIComponent(p.slug)}`}>Configure Server <ArrowRight size={13}/></Link></article>)}{plans.length===0&&<div className="publicNotice">No enabled hosting plans are currently published.</div>}</div>
  </section>

  <section className="publicSection alt">
   <div className="publicSectionHead"><div><div className="publicEyebrow"><MapPin size={11}/>REGISTERED INFRASTRUCTURE</div><h2>Real node capacity, not demo counters.</h2><p>Only stored CrakNode capacity and heartbeat data is shown. Missing values stay unavailable instead of being invented.</p></div><Link href="/locations" className="publicBtn">All locations <ArrowRight size={13}/></Link></div>
   <div className="publicFeatureGrid">{nodes.map((n:any)=>{const live=!!n.last_seen_at&&Date.now()-new Date(n.last_seen_at).getTime()<=90000;return <article className="publicFeatureCard" key={n.name}><div className="publicFeatureIcon"><MapPin size={20}/></div><h3>{n.name}</h3><p>{n.location||'Location unavailable'} · {n.agent_version||'CrakNode'}</p><div className="publicStatList"><div className="publicStatRow"><span>Status</span><strong style={{color:live?'#34d399':'#9ca3af'}}>{live?'ONLINE':'OFFLINE'}</strong></div><div className="publicStatRow"><span>vCPU</span><strong>{Number(n.capacity_cpu)>0?Number(n.capacity_cpu):'—'}</strong></div><div className="publicStatRow"><span>RAM</span><strong>{Number(n.capacity_memory_mb)>0?`${gb(n.capacity_memory_mb)} GB`:'—'}</strong></div><div className="publicStatRow"><span>Disk</span><strong>{Number(n.capacity_disk_mb)>0?`${gb(n.capacity_disk_mb)} GB`:'—'}</strong></div></div></article>})}{nodes.length===0&&<div className="publicNotice">No enabled nodes are registered yet.</div>}</div>
  </section>

  <section className="publicSection"><div className="publicFeatureGrid"><article className="publicFeatureCard"><div className="publicFeatureIcon"><Server size={20}/></div><h3>Customer control panel</h3><p>Console, files, backups, databases, network, schedules, startup settings, billing and service status from the real platform.</p><Link href="/login">Open client area <ArrowRight size={13}/></Link></article><article className="publicFeatureCard"><div className="publicFeatureIcon"><Headphones size={20}/></div><h3>Account-linked tickets</h3><p>Customers can open support tickets and continue conversations while staff manage the shared support queue.</p><Link href="/support">Open support <ArrowRight size={13}/></Link></article><article className="publicFeatureCard"><div className="publicFeatureIcon"><ShieldCheck size={20}/></div><h3>Admin operations</h3><p>Plans, customers, server ownership, node operations, billing, mail and support management stay behind staff permissions.</p></article></div></section>

  <footer className="publicFooter"><Link className="publicBrand" href="/"><img src="https://i.ibb.co/sv3BkwyS/logo-Photoroom.png" alt="CrakHost"/><span>CRAK<b>HOST</b></span></Link><span>© 2026 CrakHost Control Plane · Powered by CrakNode.</span><div className="publicFooterLinks"><Link href="/games">Games</Link><Link href="/locations">Nodes</Link><Link href="/support">Support</Link><Link href="/login">Client Area</Link></div></footer>
 </main>
}
