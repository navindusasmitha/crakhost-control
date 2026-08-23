'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {Zap,LayoutDashboard,Server,Database,HardDrive,CreditCard,Settings,Shield,Boxes,Headphones,Code2,ActivitySquare,LockKeyhole,Network,Rocket,ShoppingCart,Receipt,Mail,Mailbox} from 'lucide-react';

type Item={href:string;label:string;icon:any;adminOnly?:boolean;exact?:boolean};
const client:Item[]=[
 {href:'/dashboard',label:'Overview',icon:LayoutDashboard,exact:true},
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
const adminItems:Item[]=[
 {href:'/admin',label:'Admin Center',icon:Shield,exact:true},
 {href:'/admin/orders',label:'Orders',icon:Receipt},
 {href:'/admin/mail',label:'Mail Center',icon:Mail,adminOnly:true,exact:true},
 {href:'/admin/mail/hosting',label:'Mail Hosting',icon:Mailbox,adminOnly:true},
 {href:'/nodes',label:'Nodes',icon:Boxes},
 {href:'/infrastructure',label:'Infrastructure',icon:Network},
 {href:'/operations',label:'Operations',icon:ActivitySquare},
 {href:'/deployment',label:'Deployment',icon:Rocket},
 {href:'/developer',label:'Developer',icon:Code2},
];

export default function Sidebar({staff,admin}:{staff:boolean;admin:boolean}){
 const path=usePathname();
 const active=(item:Item)=>item.exact?path===item.href:path===item.href||path.startsWith(item.href+'/');
 const group=(title:string,items:Item[])=><><div className="navTitle">{title}</div>{items.map(i=>{const Icon=i.icon;return <Link key={i.href} href={i.href} className={active(i)?'active':''}><Icon size={17}/><span>{i.label}</span></Link>})}</>;
 const visibleAdmin=adminItems.filter(i=>!i.adminOnly||admin);
 return <aside className="sidebar">
   <Link href="/dashboard" className="brand"><div className="brandMark"><Zap size={18}/></div><span>CRAK<span style={{color:'#a78bfa'}}>HOST</span></span></Link>
   <nav className="nav">{group('WORKSPACE',client)}{group('ACCOUNT',account)}{staff&&group('ADMINISTRATION',visibleAdmin)}</nav>
   <div className="sidebarBottom"><div className="controlVersion"><div className="online"><span className="pulse"/><div><b>CrakHost Control</b><span>production control plane</span></div></div></div></div>
 </aside>
}
