import type {NodeCapacityCheck} from './node-capacity';

export type SchedulerRequest={memoryMb:number;cpu:number;diskMb:number};
export type SchedulerNode={
  id?:string;
  name?:string;
  capacity_memory_mb:number;
  capacity_disk_mb:number;
  capacity_cpu:number;
  used_memory?:number;
  used_disk?:number;
  used_cpu?:number;
};

export type SchedulerAssessment={
  score:number;
  schedulable:boolean;
  pressureLevel:string;
  factors:{memory:number;cpu:number;allocatedDisk:number;backingDisk:number;hostMemory:number;load:number};
  projected:{memoryFreePct:number;cpuFreePct:number;allocatedDiskFreePct:number;backingDiskFreePct:number|null};
};

const clamp=(v:number,min=0,max=100)=>Math.max(min,Math.min(max,Number.isFinite(v)?v:0));
const ratioPct=(free:number,total:number)=>total>0?clamp(free/total*100):0;

export function scoreNodeForRequest(node:SchedulerNode,request:SchedulerRequest,check:NodeCapacityCheck):SchedulerAssessment{
  const memoryTotal=Math.max(0,Number(node.capacity_memory_mb)||0);
  const cpuTotal=Math.max(0,Number(node.capacity_cpu)||0);
  const diskTotal=Math.max(0,Number(node.capacity_disk_mb)||0);
  const memoryFree=Math.max(0,memoryTotal-Number(node.used_memory||0)-Math.max(0,Number(request.memoryMb)||0));
  const cpuFree=Math.max(0,cpuTotal-Number(node.used_cpu||0)-Math.max(0,Number(request.cpu)||0));
  const diskFree=Math.max(0,diskTotal-Number(node.used_disk||0)-Math.max(0,Number(request.diskMb)||0));
  const memoryFreePct=ratioPct(memoryFree,memoryTotal);
  const cpuFreePct=ratioPct(cpuFree,cpuTotal);
  const allocatedDiskFreePct=ratioPct(diskFree,diskTotal);
  const backingDiskFreePct=check.totalDiskMb&&check.projectedFreeDiskMb!=null
    ?ratioPct(check.projectedFreeDiskMb,check.totalDiskMb)
    :null;

  const diagnostics=check.diagnostics||{};
  const hostMemoryUsed=Number(diagnostics.memoryUsedPct);
  const hostMemoryFreePct=Number.isFinite(hostMemoryUsed)?clamp(100-hostMemoryUsed):50;
  const hostCpus=Math.max(0,Number(diagnostics.hostCpus)||0);
  const load1=Math.max(0,Number(diagnostics.load1)||0);
  const loadHeadroomPct=hostCpus>0?clamp((1-load1/hostCpus)*100):50;
  const pressureLevel=String(check.pressureLevel||diagnostics.pressureLevel||'unknown').toLowerCase();
  const pressurePenalty=pressureLevel==='high'?14:pressureLevel==='elevated'||pressureLevel==='warning'?8:pressureLevel==='unknown'?3:0;

  const factors={
    memory:memoryFreePct*.30,
    cpu:cpuFreePct*.25,
    allocatedDisk:allocatedDiskFreePct*.15,
    backingDisk:(backingDiskFreePct??50)*.15,
    hostMemory:hostMemoryFreePct*.10,
    load:loadHeadroomPct*.05,
  };
  const raw=Object.values(factors).reduce((a,b)=>a+b,0)-pressurePenalty;
  return {
    score:Math.round(clamp(raw)*10)/10,
    schedulable:!!check.ok&&memoryFree>=0&&cpuFree>=0&&diskFree>=0,
    pressureLevel,
    factors:Object.fromEntries(Object.entries(factors).map(([k,v])=>[k,Math.round(v*10)/10])) as SchedulerAssessment['factors'],
    projected:{memoryFreePct:Math.round(memoryFreePct*10)/10,cpuFreePct:Math.round(cpuFreePct*10)/10,allocatedDiskFreePct:Math.round(allocatedDiskFreePct*10)/10,backingDiskFreePct:backingDiskFreePct==null?null:Math.round(backingDiskFreePct*10)/10},
  };
}
