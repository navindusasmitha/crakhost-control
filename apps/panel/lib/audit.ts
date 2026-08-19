import {db} from './db';
export async function audit(userId:string|null,event:string,subjectType?:string,subjectId?:string,metadata:Record<string,unknown>={}){
  try{await db.query('insert into audit_events(user_id,event,subject_type,subject_id,metadata) values($1,$2,$3,$4,$5::jsonb)',[userId,event,subjectType||null,subjectId||null,JSON.stringify(metadata)])}catch(e){console.error('audit failed',e)}
}
