'use client';

import {useMemo,useState} from 'react';
import {useRouter} from 'next/navigation';
import {ArrowRight,Check,Cpu,HardDrive,MapPin,MemoryStick,Server} from 'lucide-react';

type Plan={
  slug:string;
  name:string;
  description?:string;
  memory_mb:number;
  cpu_limit:number;
  disk_mb:number;
  price_monthly:number;
  currency:string;
};

type ComputeNode={name:string;location?:string};

type Props={
  game:'minecraft'|'fivem';
  plans:Plan[];
  nodes:ComputeNode[];
};

export default function GameConfigurator({game,plans,nodes}:Props){
  const router=useRouter();
  const [plan,setPlan]=useState(plans[0]?.slug||'');
  const [name,setName]=useState(game==='minecraft'?'My Minecraft Server':'My FiveM Server');
  const [location,setLocation]=useState(nodes[0]?.location||nodes[0]?.name||'auto');
  const [software,setSoftware]=useState(game==='minecraft'?'paper':'recommended');
  const selected=useMemo(()=>plans.find(p=>p.slug===plan),[plans,plan]);

  function next(){
    if(!selected||!name.trim())return;
    const query=new URLSearchParams({
      plan:selected.slug,
      serverName:name.trim(),
      game,
      location,
      software,
    });
    router.push(`/register?${query.toString()}`);
  }

  return (
    <section className="publicSection">
      <div className="publicSectionHead">
        <div>
          <div className="publicEyebrow">CONFIGURE {game.toUpperCase()}</div>
          <h2>Build the service before checkout.</h2>
          <p>Choose an enabled plan, server identity, registered location and runtime profile.</p>
        </div>
      </div>

      <div className="publicConfigurator">
        <div className="publicConfigMain">
          <div className="publicStep">
            <b>01</b>
            <div><h3>Choose resources</h3><p>Plans below are read from the enabled billing catalog.</p></div>
          </div>

          <div className="publicConfigPlans">
            {plans.map(p=>(
              <button type="button" key={p.slug} onClick={()=>setPlan(p.slug)} className={plan===p.slug?'selected':''}>
                <span style={{display:'flex',alignItems:'center',gap:7}}><Server size={15}/><strong>{p.name}</strong></span>
                <em>{p.currency} {Number(p.price_monthly).toLocaleString()}</em>
                <small><MemoryStick size={12}/>{Math.round(p.memory_mb/1024)} GB <Cpu size={12}/>{Number(p.cpu_limit)} CPU <HardDrive size={12}/>{Math.round(p.disk_mb/1024)} GB</small>
              </button>
            ))}
          </div>

          <div className="publicStep">
            <b>02</b>
            <div><h3>Server details</h3><p>Name the service and choose its deployment profile.</p></div>
          </div>

          <div className="publicConfigFields">
            <label>Server name<input value={name} onChange={e=>setName(e.target.value)} maxLength={80}/></label>
            <label>
              <span style={{display:'flex',alignItems:'center',gap:5}}><MapPin size={12}/>Location</span>
              <select value={location} onChange={e=>setLocation(e.target.value)}>
                {nodes.length?nodes.map(n=><option key={n.name} value={n.location||n.name}>{n.location||n.name}</option>):<option value="auto">Automatic placement</option>}
              </select>
            </label>
            <label>
              {game==='minecraft'?'Server software':'Runtime channel'}
              <select value={software} onChange={e=>setSoftware(e.target.value)}>
                {game==='minecraft'?
                  <><option value="paper">Paper</option><option value="vanilla">Vanilla</option><option value="purpur">Purpur</option></>:
                  <><option value="recommended">Recommended</option><option value="latest">Latest</option></>
                }
              </select>
            </label>
          </div>
        </div>

        <aside className="publicConfigSummary">
          <div className="publicEyebrow">ORDER SUMMARY</div>
          <h3>{selected?.name||'Choose a plan'}</h3>
          {selected&&(
            <>
              <div className="publicPrice"><span>{selected.currency} </span>{Number(selected.price_monthly).toLocaleString()} <small>/ 30 days</small></div>
              <ul>
                <li><Check/> {Math.round(selected.memory_mb/1024)} GB RAM</li>
                <li><Check/> {Number(selected.cpu_limit)} vCPU</li>
                <li><Check/> {Math.round(selected.disk_mb/1024)} GB disk</li>
                <li><Check/> {location}</li>
                <li><Check/> {software}</li>
              </ul>
            </>
          )}
          <button type="button" className="publicBtn primary" style={{width:'100%'}} disabled={!selected||!name.trim()} onClick={next}>
            Continue to account <ArrowRight size={13}/>
          </button>
          <p className="publicConfigNote">Account creation comes next. Payment and provisioning happen after sign-in.</p>
        </aside>
      </div>
    </section>
  );
}
