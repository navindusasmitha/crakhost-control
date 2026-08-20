import {db} from './db';import {getCurrentUser,isStaff} from './auth';
export type ServerPermission='console'|'files'|'backups'|'network'|'users'|'schedules'|'settings'|'databases'|'startup';
export async function requireServer(identifier:string,permission?:ServerPermission){
  const user=await getCurrentUser();if(!user)throw new Error('UNAUTHENTICATED');
  const {rows}=await db.query(`select s.*,u.email owner_email,n.name node_name,n.location node_location,n.last_seen_at node_last_seen from servers s join users u on u.id=s.owner_id left join nodes n on n.id=s.node_id where s.identifier=$1 limit 1`,[identifier]);
  const server=rows[0];if(!server)throw new Error('NOT_FOUND');
  if(isStaff(user)||server.owner_id===user.id)return {user,server,permissions:['*']};
  const {rows:access}=await db.query(`select permissions from server_users where server_id=$1 and user_id=$2 limit 1`,[server.id,user.id]);
  if(!access[0])throw new Error('NOT_FOUND');
  const permissions:Array<string>=access[0].permissions||[];
  if(permission&&!permissions.includes(permission))throw new Error('FORBIDDEN');
  return {user,server,permissions};
}
export function apiError(e:any){const m=e?.message||'';if(m==='UNAUTHENTICATED')return {status:401,error:'Unauthorized'};if(m==='FORBIDDEN')return {status:403,error:'Forbidden'};if(m==='NOT_FOUND')return {status:404,error:'Server not found'};return {status:500,error:m||'Internal error'}}
