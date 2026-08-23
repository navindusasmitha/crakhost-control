import {createHash,timingSafeEqual} from 'crypto';
import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';

export const dynamic='force-dynamic';

function safeEqual(a:string,b:string){
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}

function finitePositive(value:unknown,max:number){
  const n=Number(value);
  return Number.isFinite(n)&&n>0&&n<=max?n:null;
}

export async function POST(req:NextRequest){
  const expected=process.env.CRAKNODE_REGISTRATION_TOKEN||'';
  const token=req.headers.get('x-craknode-registration-token')||'';
  if(!expected||!token||!safeEqual(token,expected)){
    return NextResponse.json({error:'Invalid registration token'},{status:401});
  }

  const body=await req.json().catch(()=>({}));
  const name=String(body.name||'').trim().slice(0,120);
  const location=String(body.location||'').trim().slice(0,120);
  const baseUrl=String(body.baseUrl||'').trim().replace(/\/$/,'');
  const apiToken=String(body.apiToken||'').trim();
  const version=String(body.agentVersion||'').trim().slice(0,60);

  if(!/^[A-Za-z0-9._-]{2,120}$/.test(name)||!location){
    return NextResponse.json({error:'Invalid node identity'},{status:400});
  }
  if(apiToken.length<16||apiToken.length>256){
    return NextResponse.json({error:'A dedicated CrakNode API token is required'},{status:400});
  }

  let url:URL;
  try{url=new URL(baseUrl)}catch{
    return NextResponse.json({error:'Invalid baseUrl'},{status:400});
  }
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password){
    return NextResponse.json({error:'Invalid baseUrl'},{status:400});
  }

  const cpu=finitePositive(body.capacityCpu,1024);
  const memory=finitePositive(body.capacityMemoryMb,1048576);
  const disk=finitePositive(body.capacityDiskMb,1073741824);
  if(cpu===null||memory===null||disk===null){
    return NextResponse.json({error:'Node capacity metrics are missing or invalid'},{status:400});
  }

  const {rows}=await db.query(`
    insert into nodes(
      name,location,base_url,api_token,enabled,
      capacity_cpu,capacity_memory_mb,capacity_disk_mb,last_seen_at,agent_version
    ) values($1,$2,$3,$4,false,$5,$6,$7,now(),$8)
    on conflict(name) do update set
      location=case when nodes.enabled then nodes.location else excluded.location end,
      base_url=case when nodes.enabled then nodes.base_url else excluded.base_url end,
      api_token=case when nodes.api_token='' then excluded.api_token else nodes.api_token end,
      capacity_cpu=excluded.capacity_cpu,
      capacity_memory_mb=excluded.capacity_memory_mb,
      capacity_disk_mb=excluded.capacity_disk_mb,
      last_seen_at=now(),
      agent_version=excluded.agent_version
    returning id,name,location,base_url,enabled,
      capacity_cpu,capacity_memory_mb,capacity_disk_mb,last_seen_at,agent_version
  `,[name,location,baseUrl,apiToken,cpu,Math.trunc(memory),Math.trunc(disk),version]);

  const node=rows[0];
  return NextResponse.json(
    {ok:true,node,approvalRequired:!node.enabled},
    {headers:{'cache-control':'no-store'}},
  );
}
