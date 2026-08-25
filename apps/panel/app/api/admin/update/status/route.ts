import {NextResponse} from 'next/server';
import {getCurrentUser,isAdmin} from '@/lib/auth';
import {updaterAgentRequest} from '@/lib/updater-agent';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export async function GET(){
  const user=await getCurrentUser();
  if(!isAdmin(user))return NextResponse.json({error:'Forbidden'},{status:403});
  try{
    const result=await updaterAgentRequest('/status');
    return NextResponse.json(result.data,{status:result.status});
  }catch(error){
    return NextResponse.json({
      status:'unavailable',
      error:error instanceof Error?error.message:'Updater agent unavailable.'
    },{status:503});
  }
}
