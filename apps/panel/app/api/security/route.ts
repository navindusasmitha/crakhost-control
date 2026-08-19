import {NextResponse} from 'next/server';import {getCurrentUser} from '@/lib/auth';import {db} from '@/lib/db';
export async function GET(){const u=await getCurrentUser();if(!u)return NextResponse.json({error:'Unauthenticated'},{status:401});
 const {rows}=await db.query(`select totp_enabled from users where id=$1`,[u.id]);
 const s=await db.query(`select value from system_settings where key='security'`);
 return NextResponse.json({totp_enabled:!!rows[0]?.totp_enabled,...(s.rows[0]?.value||{})});}
