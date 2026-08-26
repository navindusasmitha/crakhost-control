import {NextResponse} from 'next/server';
import {recordPublicStatusSample} from '@/lib/status-page';

export const dynamic='force-dynamic';
export const runtime='nodejs';

function authorized(req:Request){
  const expected=process.env.CRAKHOST_CRON_SECRET||'';
  const got=req.headers.get('x-crakhost-cron-secret')||'';
  return !!expected&&got===expected;
}

export async function POST(req:Request){
  if(!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
  try{
    const probeNodes=new URL(req.url).searchParams.get('probe')==='1';
    const result=await recordPublicStatusSample(probeNodes);
    return NextResponse.json(result,{headers:{'cache-control':'no-store'}});
  }catch(error){
    console.error('[CrakHost Status] scheduled sample failed:',error);
    return NextResponse.json({ok:false,error:'Status sample failed'},{status:500,headers:{'cache-control':'no-store'}});
  }
}
