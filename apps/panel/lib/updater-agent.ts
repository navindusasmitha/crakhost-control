import http from 'node:http';

const SOCKET=process.env.CRAKHOST_UPDATER_SOCKET||'/run/crakhost-updater/updater.sock';

export type UpdaterHistoryItem={
  job_id?:string|null;
  job_kind?:string|null;
  status?:string;
  started_at?:string|null;
  finished_at?:string|null;
  exit_code?:number|null;
};

export type UpdaterAgentReply={
  status?:string;
  job_id?:string|null;
  job_kind?:string|null;
  pid?:number|null;
  started_at?:string|null;
  finished_at?:string|null;
  exit_code?:number|null;
  agent_version?:string;
  log_tail?:string;
  history?:UpdaterHistoryItem[];
  error?:string;
  ok?:boolean;
  [key:string]:unknown;
};

export async function updaterAgentRequest<T extends UpdaterAgentReply=UpdaterAgentReply>(path:string,method:'GET'|'POST'='GET'){
  const token=process.env.CRAKHOST_DEPLOY_TOKEN||'';
  if(token.length<32)throw new Error('In-panel updater is not configured on this host.');

  return await new Promise<{status:number;data:T}>((resolve,reject)=>{
    const req=http.request({
      socketPath:SOCKET,
      path,
      method,
      headers:{
        accept:'application/json',
        'x-crakhost-deploy-token':token,
        'user-agent':'CrakHost-Control'
      }
    },res=>{
      const chunks:Buffer[]=[];
      res.on('data',chunk=>chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)));
      res.on('end',()=>{
        const raw=Buffer.concat(chunks).toString('utf8');
        let data:UpdaterAgentReply={};
        try{data=raw?JSON.parse(raw):{}}catch{data={error:'Updater agent returned invalid JSON.'}}
        resolve({status:res.statusCode||502,data:data as T});
      });
    });
    req.setTimeout(10000,()=>req.destroy(new Error('Updater agent timed out.')));
    req.on('error',reject);
    req.end();
  });
}
