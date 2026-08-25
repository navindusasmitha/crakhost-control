import './globals.css';
import './modern.css';
import './phase2.css';
import './public-v2.css';
import './v049.css';

export const metadata={
  title:'CrakHost | Hosting Control Plane',
  description:'CrakHost game hosting, billing, support and real-time infrastructure management powered by CrakNode',
  icons:{icon:'https://i.ibb.co/pv5zb3Q5/logo-Photoroom.png'}
};

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="en"><body>{children}</body></html>
}
