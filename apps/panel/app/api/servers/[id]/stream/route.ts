import {NextRequest} from 'next/server';
import {requireServer} from '@/lib/server-access';
import {nodeFetchForServer} from '@/lib/node';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  try{await requireServer(id,'console')}catch(e:any){return new Response(JSON.stringify({error:e?.message||'Unauthorized'}),{status:e?.status||403,headers:{'content-type':'application/json'}})}
  const enc=new TextEncoder();
  let timer:ReturnType<typeof setInterval>|undefined;
  let closed=false;
  const stream=new ReadableStream<Uint8Array>({
    start(controller){
      const send=async()=>{
        if(closed)return;
        try{
          const data=await nodeFetchForServer(id,`/v1/servers/${encodeURIComponent(id)}/logs`);
          controller.enqueue(enc.encode(`event: logs\ndata: ${JSON.stringify({lines:Array.isArray(data?.lines)?data.lines:[]})}\n\n`));
        }catch(e:any){
          controller.enqueue(enc.encode(`event: node-error\ndata: ${JSON.stringify({error:String(e?.message||e)})}\n\n`));
        }
      };
      controller.enqueue(enc.encode(`retry: 1500\nevent: ready\ndata: ${JSON.stringify({ok:true,id})}\n\n`));
      void send();timer=setInterval(()=>void send(),1200);
      req.signal.addEventListener('abort',()=>{closed=true;if(timer)clearInterval(timer);try{controller.close()}catch{}},{once:true});
    },
    cancel(){closed=true;if(timer)clearInterval(timer)}
  });
  return new Response(stream,{headers:{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'}});
}
