import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '../../../../lib/auth';
export const runtime='nodejs';
export async function GET(req:NextRequest){try{const user=await getSessionUser(req.cookies.get('crakhost_session')?.value);if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});return NextResponse.json({user})}catch{return NextResponse.json({error:'Database unavailable'},{status:503})}}
