'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {Zap,LayoutDashboard,Server,Database,HardDrive,CreditCard,Settings,Shield,Boxes,Users,Headphones,Code2,ActivitySquare,LockKeyhole,Network,Rocket,ShoppingCart,Receipt} from 'lucide-react';

type Item={href:string;label:string;icon:any};
const client:Item[]=[
 {href:'/dashboard',label:'Overview',icon:LayoutDashboard},
 {href:'/servers',label:'Servers',icon:Server},
 {href:'/databases',label:'Databases',icon:Database},
 {href:'/backups',label:'Backups',icon:HardDrive},
];
const account:Item[]=[
 {href:'/checkout',label:'Deploy Server',icon:ShoppingCart},
 {href:'/billing',label:'Billing',icon:CreditCard},
 {href:'/support',label:'Support',icon:Headphones},
 {href:'/security',label:'Security',icon:LockKeyhole},
 {href:'/settings',label:'Settings',icon:Settings},
];
const admin:Item[]=[
 {href:'/admin',label:'Admin Center',icon:Shield},
 {href:'/admin/orders',label:'Orders',icon:Receipt},
 {href:'/nodes',label:'Nodes',icon:Boxes},
 {href:'/infrastructure',label:'Infrastructure',icon:Network},
 {href:'/operations',label:'Operations',icon:ActivitySquare},
 {href:'/deployment',label:'Deployment',icon:Rocket},
 {href:'/developer',label:'Developer',icon:Code2},
];

export default function Sidebar({staff}:{staff:boolean}){
 const path=usePathname();
 const active=(href:string)=>href==='/dashboard'?path===href:path===href||path.startsWith(href+'/');
 const group=(title:string,items:Item[])=><><div className="navTitle">{title}</div>{items.map(i=>{const Icon=i.icon;return <Link key={i.href} href={i.href} className={active(i.href)?'active':''}><Icon size={17}/><span>{i.label}</span></Link>})}</>;
 return <aside className="sidebar">
   <Link href="/dashboard" className="brand"><div className="brandMark"><Zap size={18}/></div><span>CRAK<span style={{color:'#a78bfa'}}>HOST</span></span></Link>
   <nav className="nav">{group('WORKSPACE',client)}{group('ACCOUNT',account)}{staff&&group('ADMINISTRATION',admin)}</nav>
   <div className="sidebarBottom"><div className="controlVersion"><div className="online"><span className="pulse"/><div><b>CrakHost Control</b><span>v0.40 · live platform</span></div></div></div></div>
 </aside>
}
