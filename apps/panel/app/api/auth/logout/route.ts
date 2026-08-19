import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { tokenHash } from '../../../../lib/auth';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 const token=req.cookies.get('crakhost_session')?.value;
 if(token){try{await db.query('delete from sessions where token_hash=$1',[tokenHash(token)])}catch{}}
 const res=NextResponse.json({ok:true}); res.cookies.set('crakhost_session','',{path:'/',maxAge:0}); return res;
}
