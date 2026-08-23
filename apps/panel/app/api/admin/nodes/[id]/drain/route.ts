import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser,isAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
import {audit} from '@/lib/audit';
import {setNodeDrain} from '@/lib/operations-settings';

export const dynamic='force-dynamic';

export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const u=await getCurrentUser();
  if(!isAdmin(u))return NextResponse.json({error:'Admin required'},{status:403});
  const {id}=await params;
  const node=await db.query('select id,name,enabled from nodes where id=$1 limit 1',[id]);
  if(!node.rowCount)return NextResponse.json({error:'Node not found'},{status:404});

  const b=await req.json().catch(()=>({}));
  if(typeof b.draining!=='boolean')return NextResponse.json({error:'draining must be boolean'},{status:400});
  const draining=b.draining;
  if(!node.rows[0].enabled&&!draining){
    return NextResponse.json({error:'Disabled node cannot be returned to scheduling until enabled'},{status:409});
  }

  await setNodeDrain(id,draining,u.id);
  await audit(u.id,draining?'node.drain.enable':'node.drain.disable','node',id,{name:node.rows[0].name});
  return NextResponse.json({ok:true,draining},{headers:{'cache-control':'no-store'}});
}
