import {notFound} from 'next/navigation';
import ServerWorkspace from '../../../../components/ServerWorkspace';
import {requireServer} from '@/lib/server-access';

export const dynamic='force-dynamic';

export default async function ServerPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  try{
    const {server,permissions}=await requireServer(id);
    const nodeOnline=!!server.node_last_seen&&(Date.now()-new Date(server.node_last_seen).getTime()<120000);
    return <ServerWorkspace id={id} meta={{name:server.name||id,address:`${server.primary_ip||'0.0.0.0'}:${server.primary_port||'-'}`,nodeName:server.node_name||'Unassigned',nodeLocation:server.node_location||'',nodeOnline,status:server.status||'unknown',memoryMb:Number(server.memory_mb||0),cpu:Number(server.cpu_limit||0),diskMb:Number(server.disk_mb||0)}} permissions={permissions}/>;
  }catch(e:any){if(e?.message==='NOT_FOUND')notFound();throw e}
}
