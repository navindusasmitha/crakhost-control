import crypto from 'node:crypto';
import {Client} from 'pg';
import {NextRequest,NextResponse} from 'next/server';
import {requireServer,apiError} from '@/lib/server-access';
import {db} from '@/lib/db';
import {audit} from '@/lib/audit';

function ident(v:string){if(!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(v))throw new Error('Invalid database identifier');return '"'+v.replaceAll('"','""')+'"'}
function configuredPublicHost(){const v=String(process.env.DB_PUBLIC_HOST||'').trim();return !v||v==='127.0.0.1'||v==='localhost'?'postgres':v}
function publicHost(stored?:string){const configured=configuredPublicHost();const v=String(stored||'').trim();if(!v||v==='127.0.0.1'||v==='localhost')return configured;return v}
function internalHost(){try{return new URL(String(process.env.DATABASE_URL||'')).hostname||'postgres'}catch{return 'postgres'}}
function credentialPayload(d:any,password:string){const host=publicHost(d.host);const port=Number(d.port||5432);const database=d.database_name||d.database;const username=d.username;const url=`postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;return {host,port,database,username,password,url}}
export const dynamic='force-dynamic';
export const runtime='nodejs';

async function liveTelemetry(databaseName:string,username:string){
  try{
    const stats=await db.query(`select datname,numbackends,xact_commit,xact_rollback,blks_read,blks_hit,temp_files,temp_bytes,deadlocks,tup_returned,tup_fetched,tup_inserted,tup_updated,tup_deleted,stats_reset,pg_database_size(datname)::bigint as size_bytes from pg_stat_database where datname=$1 limit 1`,[databaseName]);
    if(!stats.rows[0])return {reachable:false,error:'Database is not present in PostgreSQL'};
    const roleQ=await db.query(`select rolconnlimit from pg_roles where rolname=$1 limit 1`,[username]);
    const r=stats.rows[0];const reads=Number(r.blks_read||0),hits=Number(r.blks_hit||0);const total=reads+hits;
    const sessions=await db.query(`select pid,state,coalesce(client_addr::text,'local') client_addr,coalesce(application_name,'') application_name,backend_start,query_start,state_change,wait_event_type,wait_event from pg_stat_activity where datname=$1 and usename=$2 order by coalesce(query_start,backend_start) desc nulls last limit 8`,[databaseName,username]);
    const lastActivity=sessions.rows.length?String(sessions.rows[0].query_start||sessions.rows[0].state_change||sessions.rows[0].backend_start||''):null;
    return {reachable:true,sizeBytes:Number(r.size_bytes||0),connections:Number(r.numbackends||0),connectionLimit:Number(roleQ.rows[0]?.rolconnlimit??-1),commits:Number(r.xact_commit||0),rollbacks:Number(r.xact_rollback||0),cacheHitPct:total>0?Number(((hits/total)*100).toFixed(2)):100,tempFiles:Number(r.temp_files||0),tempBytes:Number(r.temp_bytes||0),deadlocks:Number(r.deadlocks||0),rowsReturned:Number(r.tup_returned||0),rowsFetched:Number(r.tup_fetched||0),rowsInserted:Number(r.tup_inserted||0),rowsUpdated:Number(r.tup_updated||0),rowsDeleted:Number(r.tup_deleted||0),statsReset:r.stats_reset,lastActivityAt:lastActivity,sessions:sessions.rows};
  }catch(e:any){return {reachable:false,error:e?.message||'Telemetry query failed',sessions:[]}}
}

async function findManagedDatabase(serverId:string,databaseId:string){const{rows}=await db.query('select * from server_databases where id=$1 and server_id=$2 limit 1',[databaseId,serverId]);return rows[0]}
async function testLogin(d:any){
  const started=Date.now();
  const client=new Client({host:internalHost(),port:Number(d.port||5432),database:d.database_name||d.name,user:d.username,password:d.password_cipher,connectionTimeoutMillis:3500,statement_timeout:3500,application_name:'crakhost-control-test'});
  try{
    await client.connect();
    const{rows}=await client.query(`select current_database() database,current_user username,current_schema() schema,current_setting('server_version') server_version,current_setting('transaction_read_only') transaction_read_only,inet_server_addr()::text server_addr,inet_server_port() server_port,now() checked_at`);
    let readWrite=false;
    try{
      await client.query('begin');
      await client.query('create temp table crakhost_rw_probe(value integer) on commit drop');
      await client.query('insert into crakhost_rw_probe(value) values(1)');
      const probe=await client.query('select count(*)::int count from crakhost_rw_probe');
      readWrite=Number(probe.rows[0]?.count||0)===1;
      await client.query('rollback');
    }catch(e){await client.query('rollback').catch(()=>{});throw e}
    const row=rows[0]||{};
    return {ok:true,latencyMs:Date.now()-started,readWrite,...row,version:`PostgreSQL ${row.server_version||''}`.trim()};
  }finally{await client.end().catch(()=>{})}
}

export async function GET(_:NextRequest,{params}:{params:Promise<{id:string}>}){
  try{
    const{id}=await params;const{server}=await requireServer(id);
    const{rows}=await db.query('select id,name,database_name,username,host,port,engine,status,created_at from server_databases where server_id=$1 order by created_at desc',[server.id]);
    const databases=await Promise.all(rows.map(async d=>({...d,host:publicHost(d.host),telemetry:await liveTelemetry(d.database_name||d.name,d.username)})));
    return NextResponse.json({databases,refreshedAt:new Date().toISOString(),publicHost:configuredPublicHost()},{headers:{'cache-control':'no-store'}})
  }catch(e:any){const x=apiError(e);return NextResponse.json({error:x.error},{status:x.status})}
}

export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  let username='';let dbName='';
  try{
    const{id}=await params;const{server,user}=await requireServer(id,'settings');const b=await req.json().catch(()=>({}));const suffix=crypto.randomBytes(3).toString('hex');const raw=String(b.name||`db_${suffix}`).toLowerCase().replace(/[^a-z0-9_]/g,'_').replace(/^_+/,'').slice(0,45);if(!raw)return NextResponse.json({error:'Invalid database name'},{status:400});dbName=`ch_${raw}_${suffix}`;username=`u_${suffix}_${server.identifier.replace(/[^a-z0-9]/gi,'').slice(-10)}`.slice(0,50);const password=crypto.randomBytes(18).toString('base64url');
    await db.query(`CREATE ROLE ${ident(username)} LOGIN PASSWORD '${password.replaceAll("'","''")}'`);
    try{await db.query(`CREATE DATABASE ${ident(dbName)} OWNER ${ident(username)}`)}catch(e){await db.query(`DROP ROLE IF EXISTS ${ident(username)}`).catch(()=>{});throw e}
    try{
      const host=configuredPublicHost();const{rows}=await db.query(`insert into server_databases(server_id,name,database_name,username,host,port,engine,password_cipher,status) values($1,$2,$3,$4,$5,5432,'postgres',$6,'READY') returning id,name,database_name,username,host,port,engine,status,created_at`,[server.id,raw,dbName,username,host,password]);await audit(user.id,'database.create','server',server.id,{database:dbName});return NextResponse.json({database:rows[0],credentials:credentialPayload(rows[0],password)},{status:201})
    }catch(e){await db.query(`DROP DATABASE IF EXISTS ${ident(dbName)} WITH (FORCE)`).catch(()=>{});await db.query(`DROP ROLE IF EXISTS ${ident(username)}`).catch(()=>{});throw e}
  }catch(e:any){const x=apiError(e);return NextResponse.json({error:e.message||x.error},{status:x.status===500?502:x.status})}
}

export async function PUT(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  try{
    const{id}=await params;const{server,user}=await requireServer(id,'settings');const b=await req.json().catch(()=>({}));const databaseId=String(b.databaseId||'');const action=String(b.action||'');if(!databaseId)return NextResponse.json({error:'databaseId is required'},{status:400});const d=await findManagedDatabase(server.id,databaseId);if(!d)return NextResponse.json({error:'Database not found'},{status:404});
    if(action==='test'){
      try{const result=await testLogin(d);await audit(user.id,'database.test','server',server.id,{database:d.database_name||d.name,ok:true,latencyMs:result.latencyMs,readWrite:result.readWrite});return NextResponse.json({ok:true,result})}catch(e:any){await audit(user.id,'database.test','server',server.id,{database:d.database_name||d.name,ok:false});return NextResponse.json({error:e?.message||'Database login failed'},{status:502})}
    }
    if(action==='rotate-password'){
      const password=crypto.randomBytes(18).toString('base64url');await db.query(`ALTER ROLE ${ident(d.username)} PASSWORD '${password.replaceAll("'","''")}'`);await db.query('update server_databases set password_cipher=$1,status=$2 where id=$3 and server_id=$4',[password,'READY',d.id,server.id]);await audit(user.id,'database.password.rotate','server',server.id,{database:d.database_name||d.name});return NextResponse.json({ok:true,credentials:credentialPayload({...d,host:publicHost(d.host)},password)})
    }
    return NextResponse.json({error:'Unsupported database action'},{status:400})
  }catch(e:any){const x=apiError(e);return NextResponse.json({error:e.message||x.error},{status:x.status===500?502:x.status})}
}

export async function DELETE(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  try{
    const{id}=await params;const{server,user}=await requireServer(id,'settings');const databaseId=req.nextUrl.searchParams.get('database');if(!databaseId)return NextResponse.json({error:'database is required'},{status:400});const d=await findManagedDatabase(server.id,databaseId);if(!d)return NextResponse.json({error:'Database not found'},{status:404});await db.query(`DROP DATABASE IF EXISTS ${ident(d.database_name||d.name)} WITH (FORCE)`);await db.query(`DROP ROLE IF EXISTS ${ident(d.username)}`);const r=await db.query('delete from server_databases where id=$1 and server_id=$2',[d.id,server.id]);if(!r.rowCount)return NextResponse.json({error:'Database record not found'},{status:404});await audit(user.id,'database.delete','server',server.id,{database:d.database_name||d.name});return NextResponse.json({ok:true})
  }catch(e:any){const x=apiError(e);return NextResponse.json({error:e.message||x.error},{status:x.status===500?502:x.status})}
}
