import './globals.css';
import './modern.css';
import './phase2.css';

export const metadata={
  title:'CrakHost Control',
  description:'CrakHost game hosting, billing and real-time infrastructure management powered by CrakNode'
};

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="en"><body>{children}</body></html>
}
