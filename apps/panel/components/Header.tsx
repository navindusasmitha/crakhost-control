'use client';
import Link from 'next/link';
import {Menu,LogOut,X,LayoutDashboard,Server,ShoppingCart,CreditCard,Headphones,Shield,Boxes,Network,Settings,BellRing,Globe2} from 'lucide-react';
import {useEffect,useState} from 'react';
import {useRouter,usePathname} from 'next/navigation';

type U={name:string;role:string;credits:string|number};
const LOGO='https://i.ibb.co/sv3BkwyS/logo-Photoroom.png';
export default function Header(){
 const[u,setU]=useState<U|null>(null),[open,setOpen]=useState(false),[alertCount,setAlertCount]=useState(0);const r=useRouter(),path=usePathname();
 useEffect(()=>{fetch('/api/auth/me',{cache:'no-store'}).then(x=>x.ok?x.json():null).then(d=>d?.user&&setU(d.user)).catch(()=>{})},[]);
 useEffect(()=>setOpen(false),[path]);
 const staff=u?.role==='ADMIN'||u?.role==='SUPPORT';
 useEffect(()=>{if(!staff)return;let dead=false;const load=()=>{if(document.hidden)return;fetch('/api/admin/alerts',{cache:'no-store'}).then(x=>x.ok?x.json():null).then(j=>{if(!dead&&j?.summary)setAlertCount(Number(j.summary.unacknowledged)||0)}).catch(()=>{})};load();const id=window.setInterval(load,30000);document.addEventListener('visibilitychange',load);return()=>{dead=true;window.clearInterval(id);document.removeEventListener('visibilitychange',load)}},[staff]);
 async function logout(){await fetch('/api/auth/logout',{method:'POST'});r.push('/login');r.refresh()}
 const initials=(u?.name||'CH').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();
 const mobile=[['/dashboard','Overview',LayoutDashboard],['/servers','My Servers',Server],['/checkout','Deploy Server',ShoppingCart],['/billing','Billing & Invoices',CreditCard],['/support','Support Tickets',Headphones],['/settings','Settings',Settings]] as const;
 const admin=[['/admin','Business Admin',Shield],['/nodes','Nodes',Boxes],['/infrastructure','Infrastructure',Network],['/alerts','Alerts',BellRing],['/status-page','Status Page',Globe2]] as const;
 const brand=<><img src={LOGO} alt="CrakHost" style={{height:34,width:'auto',objectFit:'contain'}}/><span>CRAK<span style={{color:'#a78bfa'}}>HOST</span></span></>;
 return <>
  <div className="mobileTop"><Link href="/dashboard" className="brand" style={{height:'auto',padding:0}}>{brand}</Link><button className="iconBtn" onClick={()=>setOpen(true)} aria-label="Open navigation"><Menu size={20}/></button></div>
  {open&&<><div className="mobileDrawerBackdrop" onClick={()=>setOpen(false)}/><aside className="mobileDrawer open"><div style={{display:'flex',alignItems:'center',gap:10}}><img src={LOGO} alt="CrakHost" style={{height:38,width:'auto'}}/><b>CrakHost Control</b><button className="iconBtn mobileDrawerClose" onClick={()=>setOpen(false)}><X size={18}/></button></div><nav className="nav"><div className="navTitle">WORKSPACE</div>{mobile.map(([href,label,Icon])=><Link key={href} href={href} className={path===href||path.startsWith(href+'/')?'active':''}><Icon size={17}/>{label}</Link>)}{staff&&<><div className="navTitle">ADMINISTRATION</div>{admin.map(([href,label,Icon])=><Link key={href} href={href} className={path===href||path.startsWith(href+'/')?'active':''}><Icon size={17}/>{label}{href==='/alerts'&&alertCount>0&&<span style={{marginLeft:'auto',fontSize:9,fontWeight:900,color:'#fff',background:'#ef4444',borderRadius:999,padding:'2px 6px'}}>{alertCount>99?'99+':alertCount}</span>}</Link>)}</>}</nav></aside></>}
  <header className="header"><div className="crumbs"><span>CrakHost</span><span>/</span><span className="crumbActive">Control</span></div><div className="headerRight"><div className="headerContext"><i/>Connected session</div>{staff&&<Link href="/alerts" className="iconBtn" title={alertCount?`${alertCount} unacknowledged alerts`:'No unacknowledged alerts'} style={{position:'relative'}}><BellRing size={17}/>{alertCount>0&&<span style={{position:'absolute',top:0,right:0,minWidth:15,height:15,padding:'0 3px',display:'grid',placeItems:'center',fontSize:8,fontWeight:900,color:'#fff',background:'#ef4444',borderRadius:999,border:'2px solid #080809'}}>{alertCount>99?'99+':alertCount}</span>}</Link>}<div className="profile"><div className="profileText"><b>{u?.name||'Loading account...'}</b><div className="credits">{u?`LKR ${Number(u.credits).toLocaleString()} · ${u.role}`:'Secure session'}</div></div><div className="avatar">{initials}</div><button className="iconBtn" onClick={logout} title="Sign out"><LogOut size={15}/></button></div></div></header>
 </>
}
