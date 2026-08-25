import Link from 'next/link';
import {Gamepad2,Server,ShieldCheck,MapPin,Headphones,ArrowRight,Zap,Activity,Database,CreditCard,LifeBuoy} from 'lucide-react';
import {db} from '@/lib/db';
import MarketingNav from '@/components/MarketingNav';
export const dynamic='force-dynamic';
const logo='https://i.ibb.co/pv5zb3Q5/logo-Photoroom.png';

export default async function Home(){
 const [p,n,s,h]=await Promise.all([
  db.query(`select count(*)::int count from plans where enabled=true`),
  db.query(`select count(*)::int count from nodes where enabled=true`),
  db.query(`select count(*)::int count from servers where status<>'deleted'`),
  db.query(`select count(*)::int count from nodes where enabled=true and last_seen_at>=now()-interval '90 seconds'`)
 ]);
 const plans=Number(p.rows[0]?.count||0),nodes=Number(n.rows[0]?.count||0),servers=Number(s.rows[0]?.count||0),online=Number(h.rows[0]?.count||0);
 const platformState=nodes===0?'Unavailable':online>0?'Online':'Offline';
 return <main className="crakLanding"><MarketingNav/><div className="landingWrap">
  <section className="landingHero"><div className="landingEyebrow"><Zap size={11}/>ESTABLISHED 2026 · CRAKHOST CONTROL</div><h1>Host your world<br/><span>with real power.</span></h1><p>Deploy game services through CrakNode with automatic provisioning, billing, live runtime controls, backups, databases and account-linked support in one platform.</p><div className="landingActions"><Link href="/games" className="publicBtn primary">Get Started <ArrowRight size={14}/></Link><Link href="/locations" className="publicBtn">View Nodes</Link><Link href="/login" className="publicBtn">Client Panel</Link></div></section>

  <section className="landingStats"><div className="landingStat"><strong>{nodes}</strong><span>Registered Nodes</span></div><div className="landingStat"><strong>{plans}</strong><span>Enabled Plans</span></div><div className="landingStat"><strong>{servers}</strong><span>Managed Services</span></div><div className={`landingStat ${online>0?'live':''}`}><strong>{platformState}</strong><span>{online}/{nodes} Nodes Online</span></div></section>

  <section className="landingSection"><div className="landingSectionHead"><div className="landingEyebrow">HOSTING PRODUCTS</div><h2>Everything connects to the real control plane.</h2><p>Public pricing, customer checkout and the dashboard use the same database and provisioning services. No demo counters are used on this page.</p></div><div className="landingGrid"><article className="landingCard"><div className="landingCardIcon"><Gamepad2/></div><h3>Game Hosting</h3><p>Choose an enabled plan, create your account, complete checkout and manage the provisioned service from the client panel.</p><Link href="/games">Explore game hosting <ArrowRight size={13}/></Link></article><article className="landingCard pink"><div className="landingCardIcon"><Server/></div><h3>Cloud VPS</h3><p>The VPS storefront stays gated until a supported virtualization backend is connected, so the panel never pretends a VM can be provisioned.</p><Link href="/vps">View VPS status <ArrowRight size={13}/></Link></article><article className="landingCard green"><div className="landingCardIcon"><MapPin/></div><h3>Registered Nodes</h3><p>Public locations and health are read from enabled CrakNode registrations and their real heartbeat state.</p><Link href="/locations">Inspect nodes <ArrowRight size={13}/></Link></article></div></section>

  <section className="landingSection"><div className="landingSectionHead"><div className="landingEyebrow">CLIENT AREA</div><h2>A complete customer workspace.</h2><p>Customers only see the controls their account and server permissions allow.</p></div><div className="landingGrid"><article className="landingCard"><div className="landingCardIcon"><Activity/></div><h3>Service Control</h3><p>Console, power actions, live status, files, networking, schedules, startup variables and server settings.</p><Link href="/login">Open client area <ArrowRight size={13}/></Link></article><article className="landingCard pink"><div className="landingCardIcon"><Database/></div><h3>Data & Backups</h3><p>Manage service databases and backups from account-scoped APIs backed by the same production records.</p><Link href="/login">Manage services <ArrowRight size={13}/></Link></article><article className="landingCard green"><div className="landingCardIcon"><CreditCard/></div><h3>Billing & Orders</h3><p>Customers can review orders, invoices and wallet activity while provisioning follows the configured plan catalog.</p><Link href="/login">Open billing <ArrowRight size={13}/></Link></article></div></section>

  <section className="landingSection"><div className="landingNotice"><div style={{display:'flex',alignItems:'center',gap:15}}><LifeBuoy size={27}/><div><strong>Need help with an order or service?</strong><p>Sign in to open an account-linked ticket and continue the full support conversation.</p></div></div><Link href="/support" className="publicBtn primary"><Headphones size={14}/> Support</Link></div></section>

  <section className="landingSection"><div className="landingGrid"><article className="landingCard"><div className="landingCardIcon"><ShieldCheck/></div><h3>Account Security</h3><p>Email verification, password-reset OTPs and administrator account moderation protect customer access.</p></article><article className="landingCard pink"><div className="landingCardIcon"><Zap/></div><h3>Automatic Provisioning</h3><p>Enabled catalog plans feed the scheduler, capacity checks and CrakNode provisioning workflow.</p></article><article className="landingCard green"><div className="landingCardIcon"><Headphones/></div><h3>Ticket Workflow</h3><p>Customers create tickets, staff answer from the shared queue and support replies can trigger transactional email.</p></article></div></section>

  <footer className="landingFooter"><div style={{display:'flex',alignItems:'center',gap:10}}><img className="landingFooterLogo" src={logo} alt="CrakHost"/><b>CRAKHOST</b></div><span>© 2026 CRAKHOST CONTROL PLANE · BUILT IN SRI LANKA</span><div style={{display:'flex',gap:16}}><Link href="/games">Games</Link><Link href="/support">Support</Link><Link href="/login">Client Area</Link></div></footer>
 </div></main>
}
