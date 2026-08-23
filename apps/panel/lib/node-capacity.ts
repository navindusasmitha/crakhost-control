import {nodeFetchFor} from './node';

type NodeLike={name?:string;base_url?:string;api_token?:string|null};

export type NodeCapacityCheck={
  ok:boolean;
  reason:string;
  diagnostics:any;
  freeDiskMb:number|null;
  totalDiskMb:number|null;
  requiredReserveMb:number|null;
  projectedFreeDiskMb:number|null;
  pressureLevel:string;
};

const MIB=1024*1024;

function numberEnv(name:string,fallback:number,min:number,max:number){
  const n=Number(process.env[name]);
  if(!Number.isFinite(n))return fallback;
  return Math.max(min,Math.min(max,n));
}

export function nodeDiskPolicy(){
  return {
    reserveMb:numberEnv('CRAKHOST_NODE_DISK_RESERVE_MB',2048,0,1024*1024),
    minFreePercent:numberEnv('CRAKHOST_NODE_MIN_DISK_FREE_PERCENT',10,0,50),
  };
}

export async function checkNodeRuntimeCapacity(node:NodeLike,requestedDiskMb=0):Promise<NodeCapacityCheck>{
  let diagnostics:any;
  try{
    diagnostics=await nodeFetchFor(node,'/diagnostics');
  }catch(e:any){
    return {ok:false,reason:`CrakNode diagnostics failed: ${String(e?.message||'node unavailable').slice(0,220)}`,diagnostics:null,freeDiskMb:null,totalDiskMb:null,requiredReserveMb:null,projectedFreeDiskMb:null,pressureLevel:'unknown'};
  }

  if(String(diagnostics?.status||'').toLowerCase()!=='online'){
    return {ok:false,reason:'CrakNode diagnostics did not report an online runtime',diagnostics,freeDiskMb:null,totalDiskMb:null,requiredReserveMb:null,projectedFreeDiskMb:null,pressureLevel:String(diagnostics?.pressureLevel||'unknown')};
  }

  const pressureLevel=String(diagnostics?.pressureLevel||'unknown').toLowerCase();
  if(pressureLevel==='critical'){
    return {ok:false,reason:'Node is under critical host resource pressure',diagnostics,freeDiskMb:finiteMb(diagnostics?.diskFreeBytes),totalDiskMb:finiteMb(diagnostics?.diskTotalBytes),requiredReserveMb:null,projectedFreeDiskMb:null,pressureLevel};
  }

  const freeBytes=Number(diagnostics?.diskFreeBytes);
  const totalBytes=Number(diagnostics?.diskTotalBytes);
  if(!Number.isFinite(freeBytes)||freeBytes<0||!Number.isFinite(totalBytes)||totalBytes<=0){
    return {ok:false,reason:'CrakNode did not report valid backing-storage capacity',diagnostics,freeDiskMb:null,totalDiskMb:null,requiredReserveMb:null,projectedFreeDiskMb:null,pressureLevel};
  }

  const requestedBytes=Math.max(0,Number(requestedDiskMb)||0)*MIB;
  const policy=nodeDiskPolicy();
  const reserveBytes=Math.max(policy.reserveMb*MIB,totalBytes*(policy.minFreePercent/100));
  const projectedFreeBytes=freeBytes-requestedBytes;
  const freeDiskMb=freeBytes/MIB;
  const totalDiskMb=totalBytes/MIB;
  const requiredReserveMb=reserveBytes/MIB;
  const projectedFreeDiskMb=projectedFreeBytes/MIB;

  if(projectedFreeBytes<reserveBytes){
    const requested=Math.round(requestedBytes/MIB);
    const free=Math.round(freeDiskMb);
    const reserve=Math.round(requiredReserveMb);
    return {ok:false,reason:`Backing storage is too low: ${free} MB free, ${requested} MB requested, ${reserve} MB safety reserve required`,diagnostics,freeDiskMb,totalDiskMb,requiredReserveMb,projectedFreeDiskMb,pressureLevel};
  }

  return {ok:true,reason:'',diagnostics,freeDiskMb,totalDiskMb,requiredReserveMb,projectedFreeDiskMb,pressureLevel};
}

function finiteMb(bytes:any){
  const n=Number(bytes);
  return Number.isFinite(n)&&n>=0?n/MIB:null;
}
