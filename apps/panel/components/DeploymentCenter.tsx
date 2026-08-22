'use client';
import {useEffect,useState} from 'react';

type UpdateInfo={installed?:string;latest?:string;name?:string;published_at?:string;update_available?:boolean;release_url?:string;error?:string};

export default function DeploymentCenter(){
 const [u,setU]=useState<UpdateInfo|null>(null);const [loading,setLoading]=useState(false);
 async function check(){setLoading(true);try{const r=await fetch('/api/admin/update/check',{cache:'no-store'});const j=await r.json();setU(j)}catch{setU({error:'Unable to reach update service'})}finally{setLoading(false)}}
 useEffect(()=>{check()},[]);
 return <div className="stack">
  <div className="pageHeader"><div><div className="eyebrow">PRODUCTION CONTROL</div><h1>Deployment & Updates</h1><p className="muted">Safe release checks, production updater and rollback-ready deployment.</p></div></div>
  <div className="grid3">
   <div className="card"><div className="cardTitle">Installed</div><h2>{u?.installed||'v0.26.0'}</h2><p className="muted">CrakHost Control production channel</p></div>
   <div className="card"><div className="cardTitle">Web gateway</div><h2>Nginx + Certbot</h2><p className="muted">Uses the existing host reverse proxy; no Caddy port collision.</p></div>
   <div className="card"><div className="cardTitle">Repository</div><h2>crakhost-control</h2><p className="muted">navindusasmitha/crakhost-control · main</p></div>
  </div>
  <div className="card"><div className="cardTitle">Update Center</div><p className="muted">Checks GitHub for the newest release. Installation remains root-owned so the web panel never receives Docker or root privileges.</p>
   <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}><button className="primaryBtn" onClick={check} disabled={loading}>{loading?'Checking…':'Check for updates'}</button>{u?.update_available&&<span className="badge">UPDATE AVAILABLE · {u.latest}</span>}{u&&!u.error&&!u.update_available&&<span className="badge">UP TO DATE</span>}</div>
   {u?.error?<div className="console" style={{marginTop:14}}>Update check failed: {u.error}</div>:u&&<div className="console" style={{marginTop:14}}>Installed: {u.installed}\nLatest: {u.latest||'No GitHub release published'}\nRelease: {u.name||'-'}\nPublished: {u.published_at||'-'}\nStatus: {u.update_available?'Update available':'Up to date'}</div>}
  </div>
  <div className="card"><div className="cardTitle">Safe one-command update</div><p className="muted">Fetches main, builds before restart, runs migrations through Compose, verifies Panel + CrakNode health, and preserves the previous commit when the build fails.</p><code>cd /opt/crakhost &amp;&amp; sudo ./scripts/update-production.sh</code></div>
  <div className="card"><div className="cardTitle">Fresh VPS install</div><code>curl -fsSL https://raw.githubusercontent.com/navindusasmitha/crakhost-control/main/install.sh | sudo bash</code></div>
  <div className="card"><div className="cardTitle">Security model</div><p className="muted">Update checks are ADMIN-only. The browser can inspect releases but cannot execute shell commands, Docker, git reset or sudo. Production installation is intentionally performed by the root-owned updater.</p></div>
 </div>
}
