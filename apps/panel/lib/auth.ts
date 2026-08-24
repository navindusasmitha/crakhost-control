import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from './db';

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(password: string, encoded: string) {
  const [kind,n,r,p,saltB64,hashB64] = encoded.split('$');
  if (kind !== 'scrypt' || !n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N:+n, r:+r, p:+p });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
export function newSessionToken(){ return crypto.randomBytes(32).toString('base64url'); }
export function tokenHash(token:string){ return crypto.createHash('sha256').update(token).digest('hex'); }
export async function createSession(userId:string){
  const token = newSessionToken();
  await db.query(`insert into sessions (user_id, token_hash, expires_at) values ($1,$2,now()+interval '30 days')`,[userId,tokenHash(token)]);
  return token;
}
export async function getSessionUser(token?:string){
  if(!token) return null;
  const {rows}=await db.query(`select u.id,u.name,u.email,u.role,u.credits,u.email_verified_at from sessions s join users u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>now() limit 1`,[tokenHash(token)]);
  return rows[0] ?? null;
}
export async function getCurrentUser(){
  const jar = await cookies();
  return getSessionUser(jar.get('crakhost_session')?.value);
}
export async function requireCurrentUser(){
  const user=await getCurrentUser();
  if(!user) throw new Error('UNAUTHENTICATED');
  return user;
}
export function isStaff(user:any){ return user?.role==='ADMIN'||user?.role==='SUPPORT'; }
export function isAdmin(user:any){ return user?.role==='ADMIN'; }
