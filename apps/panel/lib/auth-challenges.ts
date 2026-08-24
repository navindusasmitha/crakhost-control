import crypto from 'node:crypto';
import type {PoolClient} from 'pg';
import {db} from './db';

export type AuthChallengePurpose='EMAIL_VERIFY'|'PASSWORD_RESET';
export type ChallengeCredentials={token?:string;email?:string;otp?:string};

const MAX_ATTEMPTS=5;

function secret(){
  const value=process.env.SESSION_SECRET||'';
  if(!value)throw new Error('SESSION_SECRET is required for account challenges');
  return value;
}
function sha256(value:string){return crypto.createHash('sha256').update(value).digest('hex')}
function otpDigest(userId:string,purpose:AuthChallengePurpose,otp:string){
  return crypto.createHmac('sha256',secret()).update(`${purpose}:${userId}:${otp}`).digest('hex');
}
function safeEqualHex(a:string,b:string){
  try{const aa=Buffer.from(a,'hex'),bb=Buffer.from(b,'hex');return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb)}catch{return false}
}

export class ChallengeRateLimitError extends Error{
  retryAfterSeconds:number;
  constructor(retryAfterSeconds:number){super('Please wait before requesting another code.');this.name='ChallengeRateLimitError';this.retryAfterSeconds=retryAfterSeconds}
}

export async function issueAuthChallenge(userId:string,purpose:AuthChallengePurpose,options:{ttlMinutes?:number;minIntervalSeconds?:number}={}){
  const ttlMinutes=Math.max(5,Math.min(60,Number(options.ttlMinutes||15)));
  const minIntervalSeconds=Math.max(0,Math.min(600,Number(options.minIntervalSeconds??60)));
  const client=await db.connect();
  try{
    await client.query('begin');
    if(minIntervalSeconds>0){
      const recent=await client.query(`select created_at from auth_challenges where user_id=$1 and purpose=$2 and consumed_at is null order by created_at desc limit 1 for update`,[userId,purpose]);
      if(recent.rows[0]){
        const age=Math.max(0,(Date.now()-new Date(recent.rows[0].created_at).getTime())/1000);
        if(age<minIntervalSeconds){
          await client.query('rollback');
          throw new ChallengeRateLimitError(Math.max(1,Math.ceil(minIntervalSeconds-age)));
        }
      }
    }
    await client.query(`update auth_challenges set consumed_at=coalesce(consumed_at,now()) where user_id=$1 and purpose=$2 and consumed_at is null`,[userId,purpose]);
    const token=crypto.randomBytes(32).toString('base64url');
    const otp=String(crypto.randomInt(0,1_000_000)).padStart(6,'0');
    const expiresAt=new Date(Date.now()+ttlMinutes*60_000);
    await client.query(`insert into auth_challenges(user_id,purpose,token_hash,otp_hash,expires_at) values($1,$2,$3,$4,$5)`,[userId,purpose,sha256(token),otpDigest(userId,purpose,otp),expiresAt]);
    await client.query('commit');
    return {token,otp,expiresAt,expiresMinutes:ttlMinutes};
  }catch(e){
    await client.query('rollback').catch(()=>{});
    throw e;
  }finally{client.release()}
}

async function lockChallenge(client:PoolClient,purpose:AuthChallengePurpose,input:ChallengeCredentials){
  const token=String(input.token||'').trim();
  if(token){
    const q=await client.query(`
      select c.id,c.user_id,c.otp_hash,c.attempts,c.expires_at,u.name,u.email,u.email_verified_at
      from auth_challenges c join users u on u.id=c.user_id
      where c.purpose=$1 and c.token_hash=$2 and c.consumed_at is null and c.expires_at>now()
      limit 1 for update of c
    `,[purpose,sha256(token)]);
    return q.rows[0]||null;
  }
  const email=String(input.email||'').trim().toLowerCase();
  const otp=String(input.otp||'').trim();
  if(!email||!/^[0-9]{6}$/.test(otp))return null;
  const q=await client.query(`
    select c.id,c.user_id,c.otp_hash,c.attempts,c.expires_at,u.name,u.email,u.email_verified_at
    from auth_challenges c join users u on u.id=c.user_id
    where c.purpose=$1 and lower(u.email)=lower($2) and c.consumed_at is null and c.expires_at>now()
    order by c.created_at desc limit 1 for update of c
  `,[purpose,email]);
  const row=q.rows[0]||null;
  if(!row)return null;
  if(Number(row.attempts)>=MAX_ATTEMPTS)return null;
  const actual=otpDigest(String(row.user_id),purpose,otp);
  if(!safeEqualHex(String(row.otp_hash),actual)){
    await client.query(`update auth_challenges set attempts=least(attempts+1,10) where id=$1`,[row.id]);
    return null;
  }
  return row;
}

export async function consumeEmailVerification(input:ChallengeCredentials){
  const client=await db.connect();
  try{
    await client.query('begin');
    const row=await lockChallenge(client,'EMAIL_VERIFY',input);
    if(!row){await client.query('commit');return null}
    await client.query(`update auth_challenges set consumed_at=now() where id=$1`,[row.id]);
    const uq=await client.query(`update users set email_verified_at=coalesce(email_verified_at,now()) where id=$1 returning id,name,email,role,credits,email_verified_at`,[row.user_id]);
    await client.query('commit');
    return uq.rows[0]||null;
  }catch(e){await client.query('rollback').catch(()=>{});throw e}finally{client.release()}
}

export async function consumePasswordReset(input:ChallengeCredentials,passwordHash:string){
  const client=await db.connect();
  try{
    await client.query('begin');
    const row=await lockChallenge(client,'PASSWORD_RESET',input);
    if(!row){await client.query('commit');return null}
    await client.query(`update auth_challenges set consumed_at=now() where id=$1`,[row.id]);
    const uq=await client.query(`update users set password_hash=$2,password_changed_at=now() where id=$1 returning id,name,email,role,credits,email_verified_at`,[row.user_id,passwordHash]);
    await client.query(`delete from sessions where user_id=$1`,[row.user_id]);
    await client.query('commit');
    return uq.rows[0]||null;
  }catch(e){await client.query('rollback').catch(()=>{});throw e}finally{client.release()}
}
