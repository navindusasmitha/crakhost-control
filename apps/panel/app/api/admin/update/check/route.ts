import {NextResponse} from 'next/server';
import {getCurrentUser,isAdmin} from '@/lib/auth';
import rootPackage from '../../../../../../../package.json';

export const dynamic='force-dynamic';
const REPO=process.env.CRAKHOST_GITHUB_REPO||'navindusasmitha/crakhost-control';
const INSTALLED=`v${rootPackage.version}`;

function clean(v:string){return v.trim().replace(/^v/,'')}
function parts(v:string){return clean(v).split('.').map(x=>Number.parseInt(x,10)||0)}
function newer(a:string,b:string){const x=parts(a),y=parts(b);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d!==0)return d>0}return false}

export async function GET(){
 const u=await getCurrentUser();if(!isAdmin(u))return NextResponse.json({error:'Forbidden'},{status:403});
 try{
  const headers:Record<string,string>={accept:'application/vnd.github+json','user-agent':'CrakHost-Control'};
  if(process.env.GITHUB_TOKEN)headers.authorization=`Bearer ${process.env.GITHUB_TOKEN}`;
  const r=await fetch(`https://api.github.com/repos/${REPO}/releases/latest`,{headers,cache:'no-store'});
  if(r.status===404)return NextResponse.json({installed:INSTALLED,latest:null,name:null,published_at:null,update_available:false,repository:REPO,message:'No GitHub release has been published yet.'});
  if(!r.ok)return NextResponse.json({installed:INSTALLED,error:`GitHub release API returned HTTP ${r.status}`,repository:REPO},{status:502});
  const x=await r.json();const latest=String(x.tag_name||'');
  return NextResponse.json({installed:INSTALLED,latest,name:x.name||latest,published_at:x.published_at||null,release_url:x.html_url||null,repository:REPO,update_available:Boolean(latest)&&newer(latest,INSTALLED)});
 }catch(e){return NextResponse.json({installed:INSTALLED,error:e instanceof Error?e.message:'Update check failed',repository:REPO},{status:502})}
}
