import {db} from './db';

type NodeLike={base_url?:string;api_token?:string|null};
function fallback(){return {base_url:(process.env.CRAKNODE_URL||'http://craknode:8088').replace(/\/$/,''),api_token:process.env.CRAKNODE_TOKEN||''}}
function timeoutSignal(ms=10000){const c=new AbortController();const timer=setTimeout(()=>c.abort(),ms);return {signal:c.signal,clear:()=>clearTimeout(timer)}}
async function request(base:string,token:string,path:string,init:RequestInit={}){
  const t=timeoutSignal(Number(process.env.CRAKNODE_TIMEOUT_MS||10000));
  try{
    const headers:Record<string,string>={'content-type':'application/json'};
    if(token)headers.authorization=`Bearer ${token}`;
    Object.assign(headers,init.headers||{});
    const r=await fetch(base.replace(/\/$/,'')+path,{...init,headers,signal:t.signal,cache:'no-store'});
    const text=await r.text();let data:any={};try{data=text?JSON.parse(text):{}}catch{data={error:text||'Invalid node response'}}
    if(!r.ok)throw new Error(data.error||`CrakNode HTTP ${r.status}`);return data;
  }catch(e:any){if(e?.name==='AbortError')throw new Error('CrakNode request timed out');throw e}finally{t.clear()}
}
export async function nodeFetch(path:string,init:RequestInit={}){const n=fallback();return request(n.base_url,n.api_token,path,init)}
export async function nodeFetchFor(node:NodeLike|null|undefined,path:string,init:RequestInit={}){const f=fallback();return request((node?.base_url||f.base_url).replace(/\/$/,''),node?.api_token||f.api_token,path,init)}
export async function nodeFetchForServer(identifier:string,path:string,init:RequestInit={}){
  const {rows}=await db.query(`select n.base_url,n.api_token from servers s left join nodes n on n.id=s.node_id where s.identifier=$1 limit 1`,[identifier]);
  if(!rows[0])throw new Error('NOT_FOUND');
  return nodeFetchFor(rows[0],path,init);
}
