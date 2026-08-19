import {db} from './db';
export async function getApiServerForUser(identifier:string,user:any,permission?:string){
  const {rows}=await db.query(`select s.*,n.name node_name,n.base_url,n.api_token from servers s left join nodes n on n.id=s.node_id where s.identifier=$1 or s.id::text=$1 limit 1`,[identifier]);
  const server=rows[0]; if(!server)return null;
  if(user.role==='ADMIN'||user.role==='SUPPORT'||server.owner_id===user.id)return server;
  const {rows:access}=await db.query('select permissions from server_users where server_id=$1 and user_id=$2 limit 1',[server.id,user.id]);
  if(!access[0])return null;
  if(permission && !(access[0].permissions||[]).includes(permission))return null;
  return server;
}
