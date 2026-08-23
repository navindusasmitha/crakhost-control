import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import {getCurrentUser,isStaff} from '@/lib/auth';

export default async function PanelLayout({children}:{children:React.ReactNode}){
 const user=await getCurrentUser();
 if(!user)return <>{children}</>;
 return <div className="shell"><Sidebar staff={isStaff(user)}/><div className="main"><Header/><main className="content">{children}</main></div></div>
}
