import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import {getCurrentUser} from '@/lib/auth';
export default async function PanelLayout({children}:{children:React.ReactNode}){const user=await getCurrentUser();if(!user)return <>{children}</>;return <div className="shell"><Sidebar/><div className="main"><Header/><main className="content">{children}</main></div></div>}
