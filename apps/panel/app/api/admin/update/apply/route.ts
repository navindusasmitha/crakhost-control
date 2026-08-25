import {NextResponse} from 'next/server';
import {getCurrentUser,isAdmin} from '@/lib/auth';
import {updaterAgentRequest} from '@/lib/updater-agent';
import {audit} from '@/lib/audit';

export const dynamic='force-dynamic';
export const runtime='nodejs';

function sameOrigin(req:Request){
  const origin=req.headers.get('origin');
  if(!origin)return true;
  try{return new URL(origin).host===req.headers.get('host')}catch{return false}
}

export async function POST(req:Request){
  const user=await getCurrentUser();
  if(!isAdmin(user))return NextResponse.json({error:'Forbidden'},{status:403});
  if(!sameOrigin(req))return NextResponse.json({error:'Cross-origin update request blocked.'},{status:403});
  if(req.headers.get('x-crakhost-action')!=='apply-update'){
    return NextResponse.json({error:'Missing update action confirmation.'},{status:400});
  }
  try{
    const result=await updaterAgentRequest('/update','POST');
    await audit(user.id,'deployment.update.requested','deployment',result.data.job_id||undefined,{source:'admin-panel',agentStatus:result.data.status||null,httpStatus:result.status});
    return NextResponse.json(result.data,{status:result.status});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:'Updater agent unavailable.'},{status:503});
  }
}
