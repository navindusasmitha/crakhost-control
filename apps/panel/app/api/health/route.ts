import {NextResponse} from 'next/server';
import {db} from '@/lib/db';

export const dynamic='force-dynamic';
export const runtime='nodejs';

const VERSION='0.53.1';

export async function GET(){
  const started=Date.now();
  try{
    await db.query('select 1');
    return NextResponse.json({
      ok:true,
      service:'crakhost-panel',
      version:VERSION,
      database:'ok',
      uptimeSeconds:Math.floor(process.uptime()),
      latencyMs:Date.now()-started,
      timestamp:new Date().toISOString()
    },{headers:{'cache-control':'no-store'}});
  }catch{
    return NextResponse.json({
      ok:false,
      service:'crakhost-panel',
      version:VERSION,
      database:'unavailable',
      timestamp:new Date().toISOString()
    },{status:503,headers:{'cache-control':'no-store'}});
  }
}
