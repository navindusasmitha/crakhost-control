import Link from 'next/link';
import {Zap,LayoutDashboard,Server,Database,HardDrive,CreditCard,Settings,Shield,Boxes,Users,Headphones,Code2,ActivitySquare,LockKeyhole,Network,Rocket,ShoppingCart} from 'lucide-react';
import {getCurrentUser,isStaff} from '@/lib/auth';

export default async function Sidebar(){
  const user=await getCurrentUser();
  const staff=isStaff(user);
  return <aside className="sidebar">
    <Link href="/dashboard" className="brand"><div className="brandMark"><Zap size={18}/></div><span>CRAK<span style={{color:'#a855f7'}}>PANEL</span></span></Link>
    <nav className="nav">
      <div className="navTitle">SERVER MANAGEMENT</div>
      <Link href="/dashboard"><LayoutDashboard size={17}/>Overview</Link>
      <Link href="/servers"><Server size={17}/>My Servers</Link>
      <Link href="/databases"><Database size={17}/>Databases</Link>
      <Link href="/backups"><HardDrive size={17}/>Backups</Link>
      <div className="navTitle">ACCOUNT</div>
      <Link href="/checkout"><ShoppingCart size={17}/>Order Server</Link>
      <Link href="/billing"><CreditCard size={17}/>Billing</Link>
      <Link href="/support"><Headphones size={17}/>Support</Link>
      <Link href="/settings"><Settings size={17}/>Settings</Link>
      <Link href="/security"><LockKeyhole size={17}/>Security</Link>
      {staff&&<><div className="navTitle">ADMINISTRATION</div><Link href="/admin"><Shield size={17}/>Admin Center</Link><Link href="/nodes"><Boxes size={17}/>Nodes</Link><Link href="/admin"><Users size={17}/>Customers</Link><Link href="/developer"><Code2 size={17}/>Developer</Link><Link href="/operations"><ActivitySquare size={17}/>Operations</Link><Link href="/infrastructure"><Network size={17}/>Infrastructure</Link><Link href="/deployment"><Rocket size={17}/>Deployment</Link></>}
    </nav>
    <div className="sidebarBottom"><div className="online"><span className="pulse"/>CrakHost Control · v0.24</div></div>
  </aside>
}
