import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser,isAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
import {nodeFetchFor} from '@/lib/node';
import {audit} from '@/lib/audit';

export const dynamic='force-dynamic';

function positive(value:unknown,max:number){
  const n=Number(value);
  return Number.isFinite(n)&&n>0&&n<=max?n:null;
}

export async function GET(){
  const u=await getCurrentUser();
  if(!u)return NextResponse.json({error:'Unauthorized'},{status:401});
  const {rows}=await db.query(`
    select n.id,n.name,n.location,n.base_url,n.enabled,
      n.capacity_memory_mb,n.capacity_disk_mb,n.capacity_cpu,
      n.last_seen_at,n.agent_version,
      (select count(*) from servers s where s.node_id=n.id and s.status<>'deleted') server_count
    from nodes n order by n.created_at
  `);
  return NextResponse.json({nodes:rows},{headers:{'cache-control':'no-store'}});
}

export async function POST(req:NextRequest){
  const u=await getCurrentUser();
  if(!isAdmin(u))return NextResponse.json({error:'Forbidden'},{status:403});

  try{
    const b=await req.json();
    const name=String(b.name||'').trim().slice(0,120);
    const location=String(b.location||'').trim().slice(0,120);
    const baseUrl=String(b.baseUrl||'').trim().replace(/\/$/,'');
    const token=String(b.token||'').trim();
    const memory=positive(b.memoryMb,1048576);
    const disk=positive(b.diskMb,1073741824);
    const cpu=positive(b.cpu,1024);

    if(!/^[A-Za-z0-9._-]{2,120}$/.test(name)||!location){
      return NextResponse.json({error:'A valid node name and location are required'},{status:400});
    }
    let url:URL;
    try{url=new URL(baseUrl)}catch{
      return NextResponse.json({error:'Enter a valid http(s) node URL'},{status:400});
    }
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password){
      return NextResponse.json({error:'Enter a valid http(s) node URL without embedded credentials'},{status:400});
    }
    if(token.length<16||token.length>256){
      return NextResponse.json({error:'A dedicated CrakNode token is required'},{status:400});
    }
    if(memory===null||disk===null||cpu===null){
      return NextResponse.json({error:'Explicit CPU, memory and disk capacity values are required'},{status:400});
    }

    const node={base_url:baseUrl,api_token:token};
    const health=await nodeFetchFor(node,'/health');
    const {rows}=await db.query(`
      insert into nodes(
        name,location,base_url,api_token,enabled,
        capacity_memory_mb,capacity_disk_mb,capacity_cpu,last_seen_at,agent_version
      ) values($1,$2,$3,$4,true,$5,$6,$7,now(),$8)
      returning id,name,enabled
    `,[name,location,baseUrl,token,Math.trunc(memory),Math.trunc(disk),cpu,String(health.version||'').slice(0,60)]);

    await audit(u.id,'node.create','node',rows[0].id,{name:rows[0].name});
    return NextResponse.json({ok:true,node:rows[0],health},{status:201,headers:{'cache-control':'no-store'}});
  }catch(e:any){
    const message=String(e?.message||'Node registration failed');
    if(message.includes('duplicate key'))return NextResponse.json({error:'A node with that name already exists'},{status:409});
    return NextResponse.json({error:message},{status:502});
  }
}
