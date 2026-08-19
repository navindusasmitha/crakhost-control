import Sidebar from '../../components/Sidebar';import Header from '../../components/Header';
export default function PanelLayout({children}:{children:React.ReactNode}){return <div className="shell"><Sidebar/><div className="main"><Header/><main className="content">{children}</main></div></div>}
