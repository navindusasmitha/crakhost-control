import {NextResponse} from 'next/server';
import {reconcileProvisioningOrders} from '@/lib/provisioning-reconcile';

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
    const result=await reconcileProvisioningOrders();
    return NextResponse.json({ok:true,...result,checkedAt:new Date().toISOString()},{headers:{'cache-control':'no-store'}});
  }catch(e:any){
    return NextResponse.json({ok:false,error:String(e?.message||'Provisioning reconciliation failed')},{status:500,headers:{'cache-control':'no-store'}});
  }
}
