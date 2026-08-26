import {NextResponse} from 'next/server';
import {buildPublicStatus,recordPublicStatusSample} from '@/lib/status-page';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export async function GET(){
  try{
    let collector:any=null;
    try{
      collector=await recordPublicStatusSample(false);
      if(collector&&!collector.ok)console.error('[CrakHost Status] public refresh sample reported errors:',collector.errors||[]);
    }catch(error){
      console.error('[CrakHost Status] public refresh sample failed:',error);
    }
    const data=await buildPublicStatus();
    if(!data.enabled)return NextResponse.json({error:'Status page disabled'},{status:404,headers:{'cache-control':'no-store'}});
    return NextResponse.json({...data,collector},{headers:{'cache-control':'no-store, max-age=0','access-control-allow-origin':'*'}});
  }catch(error){
    console.error('[CrakHost Status] public status build failed:',error);
    const now=new Date().toISOString();
    return NextResponse.json({
      enabled:true,
      title:'CrakHost Status',
      description:'Live availability and incident updates for CrakHost services.',
      refreshSeconds:60,
      historyMinutes:10,
      overall:'outage',
      components:[
        {id:'panel',name:'Control Panel',source:'panel',enabled:true,status:'operational',detail:'Public status endpoint is responding',latencyMs:null,uptime10m:100,sampleCount:0,trackedMinutes:0,history:[]},
        {id:'telemetry',name:'Status Telemetry',source:'manual',enabled:true,status:'outage',detail:'Platform telemetry is temporarily unavailable',latencyMs:null,uptime10m:0,sampleCount:0,trackedMinutes:0,history:[]}
      ],
      incidents:[],
      activeIncidents:[{id:'status-api',title:'Status data unavailable',message:'The public status service cannot currently read platform telemetry.',severity:'major',status:'investigating',createdAt:now,updatedAt:now}],
      generatedAt:now,
      error:'Status telemetry unavailable'
    },{status:503,headers:{'cache-control':'no-store','access-control-allow-origin':'*'}});
  }
}
