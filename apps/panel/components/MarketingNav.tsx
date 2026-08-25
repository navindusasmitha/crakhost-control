import Link from 'next/link';
import {LogIn,ArrowRight} from 'lucide-react';

const LOGO='https://i.ibb.co/sv3BkwyS/logo-Photoroom.png';

export default function MarketingNav(){return <header className="publicNav"><Link className="publicBrand" href="/"><img className="publicLogo" src={LOGO} alt="CrakHost"/><span>CRAK<b>HOST</b></span></Link><nav className="publicLinks"><Link href="/">Home</Link><Link href="/games">Games</Link><Link href="/vps">VPS</Link><Link href="/locations">Nodes</Link><Link href="/support">Support</Link></nav><div className="publicActions"><Link href="/login" className="publicBtn ghost"><LogIn size={13}/>Login</Link><Link href="/games" className="publicBtn primary">Get Started <ArrowRight size={13}/></Link></div></header>}
