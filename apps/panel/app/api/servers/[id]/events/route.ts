import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {requireServer,apiError} from '@/lib/server-access';

export const dynamic='force-dynamic';

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  try{
    const {server}=await requireServer(id);
    const {rows}=await db.query(`
      select id,type,detail,created_at
      from service_events
      where server_id=$1
      order by created_at desc
      limit 40
    `,[server.id]);
    return NextResponse.json({events:rows},{headers:{'cache-control':'no-store'}});
  }catch(e:any){
    const x=apiError(e);
    return NextResponse.json({error:x.error},{status:x.status,headers:{'cache-control':'no-store'}});
  }
}
