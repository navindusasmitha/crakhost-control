import { NextRequest, NextResponse } from 'next/server';
export function middleware(req:NextRequest){
 const hasSession=Boolean(req.cookies.get('crakhost_session')?.value);
 if(!hasSession){const url=req.nextUrl.clone();url.pathname='/login';url.searchParams.set('next',req.nextUrl.pathname);return NextResponse.redirect(url)}
 return NextResponse.next();
}
export const config={matcher:['/dashboard/:path*','/servers/:path*','/nodes/:path*','/databases/:path*','/backups/:path*','/billing/:path*','/admin/:path*','/settings/:path*']};
