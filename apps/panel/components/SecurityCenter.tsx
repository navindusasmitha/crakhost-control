'use client';
import {useEffect,useState} from 'react';
export default function SecurityCenter(){
 const [me,setMe]=useState<any>(null); const [data,setData]=useState<any>(null);
 useEffect(()=>{fetch('/api/auth/me').then(r=>r.json()).then(setMe);fetch('/api/security').then(r=>r.json()).then(setData)},[]);
 return <div className="stack"><div className="pageHeader"><div><div className="eyebrow">ACCOUNT SECURITY</div><h1>Security Center</h1><p className="muted">Session, 2FA readiness and infrastructure security status.</p></div></div>
 <div className="grid3">
 <div className="card"><div className="cardTitle">Signed-in account</div><h3>{me?.user?.email||'Loading...'}</h3><p className="muted">Role: {me?.user?.role||'-'}</p></div>
 <div className="card"><div className="cardTitle">Two-factor authentication</div><h3>{data?.totp_enabled?'Enabled':'Ready to configure'}</h3><p className="muted">TOTP database foundation is installed in v0.12. Enrollment UI is staged for the hardened auth release.</p></div>
 <div className="card"><div className="cardTitle">SFTP</div><h3>{data?.sftpEnabled?'Enabled':'Disabled by default'}</h3><p className="muted">Credential model is installed; keep disabled until a dedicated SFTP transport is configured.</p></div>
 </div>
 <div className="card"><div className="cardTitle">Production checklist</div><p className="muted">Rotate SESSION_SECRET and node tokens, enable TLS, use non-default database passwords, revoke exposed API keys, restrict CrakNode ports, and enable 2FA before public launch.</p></div>
 </div>
}