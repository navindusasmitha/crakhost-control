'use client';
import Link from 'next/link';
import {KeyRound,Loader2,Mail,Zap} from 'lucide-react';
import {FormEvent,useState} from 'react';
import {useRouter} from 'next/navigation';

export default function ForgotPassword(){
 const r=useRouter();const[email,setEmail]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');setMessage('');try{const res=await fetch('/api/auth/password/forgot',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email})}),d=await res.json();if(!res.ok)throw new Error(d.error||'Unable to request password reset');setMessage(d.message||'If the account exists, a reset code was sent.');setTimeout(()=>r.push(`/reset-password?email=${encodeURIComponent(email)}`),900)}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 return <div className="authWrap"><form className="authBox" onSubmit={submit}><div className="brand authBrand"><div className="brandMark"><Zap size={18}/></div>CrakHost</div><div className="authTitle">Forgot password?</div><div className="authSub">Enter your account email. We will send a secure 6-digit OTP and a reset link if the account exists.</div>{message&&<div className="notice"><Mail size={14} style={{verticalAlign:'middle'}}/> {message}</div>}{error&&<div className="notice error">{error}</div>}<div className="field"><label>Email address</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" required/></div><button className="btn authBtn" disabled={busy}>{busy?<Loader2 size={15} className="spin"/>:<KeyRound size={15}/>} {busy?'Sending...':'Send reset code'}</button><div className="authFoot">Remembered your password? <Link href="/login">Back to sign in</Link></div></form></div>
}
