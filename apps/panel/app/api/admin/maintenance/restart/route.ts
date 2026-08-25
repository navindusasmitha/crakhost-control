import {NextResponse} from 'next/server';
import {getCurrentUser,isAdmin} from '@/lib/auth';
import {updaterAgentRequest} from '@/lib/updater-agent';
import {audit} from '@/lib/audit';

export const dynamic='force-dynamic';
export const runtime='nodejs';

const ALLOWED=new Set(['craknode','commerce-cleanup','crakmail','roundcube']);

function sameOrigin(req:Request){
  const origin=req.headers.get('origin');
  if(!origin)return true;
  try{return new URL(origin).host===req.headers.get('host')}catch{return false}
}

export async function POST(req:Request){
  const user=await getCurrentUser();
  if(!isAdmin(user))return NextResponse.json({error:'Forbidden'},{status:403});
  if(!sameOrigin(req))return NextResponse.json({error:'Cross-origin restart request blocked.'},{status:403});
  if(req.headers.get('x-crakhost-action')!=='restart-service')return NextResponse.json({error:'Missing restart action confirmation.'},{status:400});
  const body=await req.json().catch(()=>({}));
  const service=String(body.service||'').trim().toLowerCase();
  if(!ALLOWED.has(service))return NextResponse.json({error:'This service is protected from browser restart.'},{status:400});
  try{
    const result=await updaterAgentRequest(`/service/restart/${service}`,'POST');
    await audit(user.id,'operations.service.restart','service',service,{source:'admin-panel',agentStatus:(result.data as any).status||null,httpStatus:result.status});
    return NextResponse.json(result.data,{status:result.status});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:'Updater agent unavailable.'},{status:503});
  }
}
