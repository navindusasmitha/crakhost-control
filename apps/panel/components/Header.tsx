'use client';
import Link from 'next/link';
import {Menu,LogOut,X,LayoutDashboard,Server,ShoppingCart,CreditCard,Headphones,Shield,Boxes,Network,Settings} from 'lucide-react';
import {useEffect,useState} from 'react';
import {useRouter,usePathname} from 'next/navigation';

type U={name:string;role:string;credits:string|number};
export default function Header(){
 const[u,setU]=useState<U|null>(null),[open,setOpen]=useState(false);const r=useRouter(),path=usePathname();
 useEffect(()=>{fetch('/api/auth/me',{cache:'no-store'}).then(x=>x.ok?x.json():null).then(d=>d?.user&&setU(d.user)).catch(()=>{})},[]);
 useEffect(()=>setOpen(false),[path]);
 async function logout(){await fetch('/api/auth/logout',{method:'POST'});r.push('/login');r.refresh()}
 const initials=(u?.name||'CH').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();const staff=u?.role==='ADMIN'||u?.role==='SUPPORT';
 const mobile=[['/dashboard','Overview',LayoutDashboard],['/servers','My Servers',Server],['/checkout','Deploy Server',ShoppingCart],['/billing','Billing & Invoices',CreditCard],['/support','Support Tickets',Headphones],['/settings','Settings',Settings]] as const;
 const admin=[['/admin','Business Admin',Shield],['/nodes','Nodes',Boxes],['/infrastructure','Infrastructure',Network]] as const;
 const brand=<><img src="https://i.ibb.co/pv5zb3Q5/logo-Photoroom.png" alt="CrakHost" style={{height:31,width:'auto',objectFit:'contain'}}/><span>CRAK<span style={{color:'#a78bfa'}}>HOST</span></span></>;
 return <>
  <div className="mobileTop"><Link href="/dashboard" className="brand" style={{height:'auto',padding:0}}>{brand}</Link><button className="iconBtn" onClick={()=>setOpen(true)} aria-label="Open navigation"><Menu size={20}/></button></div>
  {open&&<><div className="mobileDrawerBackdrop" onClick={()=>setOpen(false)}/><aside className="mobileDrawer open"><div style={{display:'flex',alignItems:'center',gap:10}}><img src="https://i.ibb.co/pv5zb3Q5/logo-Photoroom.png" alt="CrakHost" style={{height:34,width:'auto'}}/><b>CrakHost Control</b><button className="iconBtn mobileDrawerClose" onClick={()=>setOpen(false)}><X size={18}/></button></div><nav className="nav"><div className="navTitle">WORKSPACE</div>{mobile.map(([href,label,Icon])=><Link key={href} href={href} className={path===href||path.startsWith(href+'/')?'active':''}><Icon size={17}/>{label}</Link>)}{staff&&<><div className="navTitle">ADMINISTRATION</div>{admin.map(([href,label,Icon])=><Link key={href} href={href} className={path===href||path.startsWith(href+'/')?'active':''}><Icon size={17}/>{label}</Link>)}</>}</nav></aside></>}
  <header className="header"><div className="crumbs"><span>CrakHost</span><span>/</span><span className="crumbActive">Control</span></div><div className="headerRight"><div className="headerContext"><i/>Connected session</div><div className="profile"><div className="profileText"><b>{u?.name||'Loading account...'}</b><div className="credits">{u?`LKR ${Number(u.credits).toLocaleString()} · ${u.role}`:'Secure session'}</div></div><div className="avatar">{initials}</div><button className="iconBtn" onClick={logout} title="Sign out"><LogOut size={15}/></button></div></div></header>
 </>
}
