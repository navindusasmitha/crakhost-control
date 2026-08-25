import {NextResponse} from 'next/server';
import {getCurrentUser,isAdmin} from '@/lib/auth';
import rootPackage from '../../../../../../../package.json';

export const dynamic='force-dynamic';
export const runtime='nodejs';

const REPO=process.env.CRAKHOST_GITHUB_REPO||'navindusasmitha/crakhost-control';
const INSTALLED=`v${rootPackage.version}`;

function clean(v:string){return v.trim().replace(/^v/,'')}
function parts(v:string){return clean(v).split('.').map(x=>Number.parseInt(x,10)||0)}
function newer(a:string,b:string){
  const x=parts(a),y=parts(b);
  for(let i=0;i<Math.max(x.length,y.length);i++){
    const d=(x[i]||0)-(y[i]||0);
    if(d!==0)return d>0;
  }
  return false;
}
function validVersion(v:string){return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(clean(v))}

export async function GET(){
  const user=await getCurrentUser();
  if(!isAdmin(user))return NextResponse.json({error:'Forbidden'},{status:403});

  try{
    const headers:Record<string,string>={
      accept:'application/vnd.github+json',
      'user-agent':'CrakHost-Control'
    };
    if(process.env.GITHUB_TOKEN)headers.authorization=`Bearer ${process.env.GITHUB_TOKEN}`;

    const manifestRes=await fetch(`https://api.github.com/repos/${REPO}/contents/package.json?ref=main`,{
      headers,
      cache:'no-store'
    });
    if(!manifestRes.ok){
      return NextResponse.json({
        installed:INSTALLED,
        error:`GitHub main-branch manifest returned HTTP ${manifestRes.status}`,
        repository:REPO
      },{status:502});
    }

    const manifestData=await manifestRes.json();
    const encoded=String(manifestData.content||'').replace(/\s/g,'');
    const remotePackage=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
    const remoteVersion=String(remotePackage.version||'');
    if(!validVersion(remoteVersion))throw new Error('Main branch did not return a valid release version.');
    const latest=`v${clean(remoteVersion)}`;

    let release:any=null;
    try{
      const releaseRes=await fetch(`https://api.github.com/repos/${REPO}/releases/latest`,{headers,cache:'no-store'});
      if(releaseRes.ok){
        const candidate=await releaseRes.json();
        if(clean(String(candidate.tag_name||''))===clean(latest))release=candidate;
      }
    }catch{}

    return NextResponse.json({
      installed:INSTALLED,
      latest,
      name:release?.name||`Main branch ${latest}`,
      published_at:release?.published_at||null,
      release_url:release?.html_url||`https://github.com/${REPO}/commits/main`,
      repository:REPO,
      channel:'main',
      update_available:newer(latest,INSTALLED),
      message:release?'Published release matches main.':'Version read directly from the production main branch.'
    });
  }catch(error){
    return NextResponse.json({
      installed:INSTALLED,
      error:error instanceof Error?error.message:'Update check failed',
      repository:REPO
    },{status:502});
  }
}
