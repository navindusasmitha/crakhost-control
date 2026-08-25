import type {Metadata} from 'next';
import PublicStatusPage from '../../components/PublicStatusPage';

export const metadata:Metadata={title:'CrakHost Status',description:'Live CrakHost service availability and incident updates.',robots:{index:true,follow:true}};
export const dynamic='force-dynamic';
export default function Page(){return <PublicStatusPage/>}
