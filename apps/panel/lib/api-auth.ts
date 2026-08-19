import crypto from 'node:crypto';
import { db } from './db';

export function apiTokenHash(token:string){return crypto.createHash('sha256').update(token).digest('hex')}

export async function getApiUser(authHeader:string|null, requiredScope?:string){
  if(!authHeader?.startsWith('Bearer ')) return null;
  const raw=authHeader.slice(7).trim(); if(!raw.startsWith('ch_')) return null;
  const {rows}=await db.query(`select k.id key_id,k.scopes,u.id,u.name,u.email,u.role,u.credits from api_keys k join users u on u.id=k.user_id where k.token_hash=$1 and k.revoked_at is null and (k.expires_at is null or k.expires_at>now()) limit 1`,[apiTokenHash(raw)]);
  const user=rows[0]; if(!user) return null;
  if(requiredScope && !(user.scopes||[]).includes(requiredScope) && !(user.scopes||[]).includes('*')) return null;
  await db.query('update api_keys set last_used_at=now() where id=$1',[user.key_id]);
  return user;
}

export async function enforceApiRateLimit(keyId:string,limit=120){
  const {rows}=await db.query(`select count(*)::int as c from api_request_log where api_key_id=$1 and created_at>now()-interval '1 minute'`,[keyId]);
  const count=Number(rows[0]?.c||0);
  return {ok:count<limit,remaining:Math.max(0,limit-count-1),limit,retryAfter:count>=limit?60:0};
}

export async function recordApiRequest(keyId:string,userId:string,method:string,path:string,status:number){
  try{
    await db.query('insert into api_request_log(api_key_id,user_id,method,path,status) values($1,$2,$3,$4,$5)',[keyId,userId,method.slice(0,12),path.slice(0,240),status]);
    await db.query(`insert into audit_events(user_id,event,subject_type,subject_id,metadata) values($1,'api.request','api_key',$2,$3::jsonb)`,[userId,keyId,JSON.stringify({method,path,status})]);
  }catch(e){console.error('api request audit failed',e)}
}
