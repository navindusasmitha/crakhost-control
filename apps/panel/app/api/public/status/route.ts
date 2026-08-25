import {NextResponse} from 'next/server';
import {buildPublicStatus} from '@/lib/status-page';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export async function GET(){
  try{
    const data=await buildPublicStatus();
    if(!data.enabled)return NextResponse.json({error:'Status page disabled'},{status:404,headers:{'cache-control':'no-store'}});
    return NextResponse.json(data,{headers:{'cache-control':'no-store, max-age=0','access-control-allow-origin':'*'}});
  }catch(error){
    return NextResponse.json({
      enabled:true,title:'CrakHost Status',description:'Live availability and incident updates for CrakHost services.',overall:'outage',components:[],incidents:[],activeIncidents:[{id:'status-api',title:'Status data unavailable',message:'The public status service cannot currently read platform telemetry.',severity:'major',status:'investigating',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}],generatedAt:new Date().toISOString(),error:'Status telemetry unavailable'
    },{status:503,headers:{'cache-control':'no-store','access-control-allow-origin':'*'}});
  }
}
