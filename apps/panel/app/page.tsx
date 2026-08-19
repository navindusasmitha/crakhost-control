import Link from 'next/link';
import {Rocket,Gamepad2,Server,ShieldCheck,MapPin,Headphones,ArrowRight,Check,Cpu,Database,Zap} from 'lucide-react';
import {db} from '@/lib/db';

export const dynamic='force-dynamic';

export default async function Home(){
  const [planQ,nodeQ]=await Promise.all([
    db.query(`select slug,name,description,memory_mb,cpu_limit,disk_mb,price_monthly,currency,featured,template_slug from plans where enabled=true order by sort_order,price_monthly`),
    db.query(`select name,location,capacity_cpu,capacity_memory_mb from nodes where enabled=true order by name limit 6`)
  ]);
  const plans=planQ.rows;
  const nodes=nodeQ.rows;
  return <main className="marketingRoot">
    <header className="marketingNav">
      <Link className="marketingBrand" href="/"><span className="marketingLogo"><Rocket size={20}/></span><span>CRAK<b>HOST</b></span></Link>
      <nav className="marketingLinks"><a href="#home">Home</a><a href="#games">Games</a><a href="#vps">VPS</a><a href="#locations">Locations</a><a href="#features">Features</a><a href="#support">Support</a></nav>
      <div className="marketingActions"><Link href="/login" className="marketingGhost">Login</Link><Link href="#plans" className="marketingPrimary">Get Started</Link></div>
    </header>

    <section id="home" className="hero53">
      <div className="heroBadge">🔥 PREMIUM HOSTING REINVENTED</div>
      <h1>Elite Infrastructure.<br/><span>Built for Players.</span></h1>
      <p>Fast game hosting with automatic deployment, a real CrakNode backend, isolated containers and a clean customer control panel.</p>
      <div className="heroActions"><a href="#games" className="marketingPrimary big">View Game Servers</a><Link href="/login" className="marketingGhost big">Open Client Panel</Link></div>
      <div className="marketingStats">
        <div><strong>{nodes.length}</strong><span>Active Nodes</span></div>
        <div><strong>{plans.length}</strong><span>Hosting Plans</span></div>
        <div><strong>24/7</strong><span>Panel Access</span></div>
        <div><strong>Auto</strong><span>Provisioning</span></div>
      </div>
    </section>

    <section id="features" className="marketingSection">
      <div className="sectionEyebrow">WHY CRAKHOST</div><h2>Hosting without the clutter.</h2><p className="sectionLead">The visual direction follows the supplied dark purple reference while the data comes from the real CrakHost backend.</p>
      <div className="featureGrid53">
        <article><span><Cpu/></span><h3>Real Resource Limits</h3><p>CPU, memory and disk limits are enforced by the selected CrakNode workload instead of simulated dashboard values.</p></article>
        <article><span><ShieldCheck/></span><h3>Isolated Workloads</h3><p>Each purchased service receives its own managed container, allocation and customer ownership record.</p></article>
        <article><span><Zap/></span><h3>Instant Workflow</h3><p>Choose a plan, create an account, complete checkout and CrakHost automatically starts provisioning.</p></article>
      </div>
    </section>

    <section id="games" className="marketingSection marketingDarkBand">
      <div className="sectionEyebrow">GAME SERVERS</div><h2>Choose your workload.</h2>
      <div className="gameGrid53">
        <article className="gameCard53"><div className="gameVisual minecraft"><Gamepad2 size={42}/></div><div className="gameBody"><div className="gameTop"><h3>Minecraft Java</h3><span className="livePill">ACTIVE</span></div><p>Managed Java server, dedicated memory limits, persistent storage and full panel controls.</p><a href="#plans" className="marketingPrimary smallBtn">Configure</a></div></article>
        <article className="gameCard53"><div className="gameVisual fivem"><Server size={42}/></div><div className="gameBody"><div className="gameTop"><h3>FiveM / GTA</h3><span className="livePill">READY</span></div><p>Template-ready game hosting flow designed for dedicated FiveM workloads on CrakNode.</p><a href="#plans" className="marketingPrimary smallBtn">Order</a></div></article>
      </div>
    </section>

    <section id="plans" className="marketingSection">
      <div className="sectionEyebrow">PLANS</div><h2>Pick a server plan.</h2><p className="sectionLead">Plans below are loaded from the live CrakHost database.</p>
      <div className="planGrid53">{plans.map((p:any)=><article className={`planCard53 ${p.featured?'featured':''}`} key={p.slug}>{p.featured&&<div className="popular53">MOST POPULAR</div>}<div className="planIcon"><Database size={20}/></div><h3>{p.name}</h3><p>{p.description||'Managed CrakHost service'}</p><div className="price53"><span>{p.currency}</span>{Number(p.price_monthly).toLocaleString()}<small>/mo</small></div><ul><li><Check/> {Math.round(Number(p.memory_mb)/1024)} GB RAM</li><li><Check/> {Number(p.cpu_limit)} vCPU</li><li><Check/> {Math.round(Number(p.disk_mb)/1024)} GB disk</li><li><Check/> Automatic deployment</li></ul><Link className="marketingPrimary planBuy" href={`/register?plan=${encodeURIComponent(p.slug)}`}>Choose {p.name}<ArrowRight size={16}/></Link></article>)}</div>
    </section>

    <section id="locations" className="marketingSection marketingDarkBand">
      <div className="sectionEyebrow">LOCATIONS</div><h2>Live CrakHost nodes.</h2>
      <div className="locations53">{nodes.length?nodes.map((n:any)=><article key={n.name}><MapPin/><div><h3>{n.location||n.name}</h3><p>{n.name} · {Number(n.capacity_cpu)} vCPU · {Math.round(Number(n.capacity_memory_mb)/1024)} GB RAM</p></div><span className="livePill">ONLINE</span></article>):<article><MapPin/><div><h3>No public nodes</h3><p>Nodes will appear here after registration.</p></div></article>}</div>
    </section>

    <section id="vps" className="marketingSection"><div className="vpsBanner53"><div><div className="sectionEyebrow">CLOUD VPS</div><h2>More products, same control experience.</h2><p>VPS plans can use the same storefront, billing and customer-area flow as game servers once a virtualization backend is connected.</p></div><Link href="#plans" className="marketingPrimary big">Browse Plans</Link></div></section>

    <section id="support" className="marketingSection"><div className="support53"><Headphones size={34}/><div><div className="sectionEyebrow">SUPPORT</div><h2>Need help with your service?</h2><p>Signed-in customers can open support tickets directly from their CrakPanel account.</p></div><Link href="/support" className="marketingGhost big">Open Support</Link></div></section>

    <footer className="marketingFooter"><div className="marketingBrand"><span className="marketingLogo"><Rocket size={18}/></span><span>CRAK<b>HOST</b></span></div><p>Premium game hosting infrastructure powered by CrakNode.</p><div><a href="#games">Games</a><a href="#plans">Plans</a><Link href="/login">Client Area</Link></div></footer>
  </main>
}
