import Link from 'next/link';
import { Plus, Bell, Cpu, MemoryStick, HardDrive, Activity, ArrowUpRight } from 'lucide-react';
import { db } from '@/lib/db';
import { nodeFetchFor } from '@/lib/node';
import { getCurrentUser, isStaff } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function Dashboard() {
  const user = await getCurrentUser();
  if (!user) return null;

  const staff = isStaff(user);
  const params: any[] = staff ? [] : [user.id];
  const where = staff ? '' : 'where s.owner_id=$1';

  const serverQ = await db.query(
    `select s.id,s.name,s.identifier,s.status,s.memory_mb,s.cpu_limit,s.disk_mb,
            s.primary_ip,s.primary_port,s.node_id,
            n.name node_name,n.location node_location,n.base_url,n.api_token
       from servers s
       left join nodes n on n.id=s.node_id
       ${where}
       order by s.created_at desc
       limit 50`,
    params,
  );

  const nodeQ = staff
    ? await db.query(
        `select id,name,location,base_url,api_token,enabled,
                capacity_cpu,capacity_memory_mb,capacity_disk_mb
           from nodes
          where enabled=true
          order by name`,
      )
    : await db.query(
        `select distinct n.id,n.name,n.location,n.base_url,n.api_token,n.enabled,
                n.capacity_cpu,n.capacity_memory_mb,n.capacity_disk_mb
           from nodes n
           join servers s on s.node_id=n.id
          where s.owner_id=$1 and n.enabled=true
          order by n.name`,
        [user.id],
      );

  const revenueQ = staff
    ? await db.query(
        `select coalesce(sum(amount),0)::numeric amount,
                coalesce(max(currency),'LKR') currency
           from invoices
          where status='PAID'
            and paid_at>=date_trunc('month',now())`,
      )
    : await db.query(
        `select coalesce(sum(amount),0)::numeric amount,
                coalesce(max(currency),'LKR') currency
           from invoices
          where user_id=$1
            and status='PAID'
            and paid_at>=date_trunc('month',now())`,
        [user.id],
      );

  const nodes: any[] = [];
  for (const n of nodeQ.rows) {
    const started = Date.now();
    try {
      const live = await nodeFetchFor(n, '/diagnostics');
      nodes.push({ ...n, ...live, status: 'online', latencyMs: Date.now() - started });
    } catch (error: any) {
      nodes.push({
        ...n,
        status: 'offline',
        latencyMs: Date.now() - started,
        error: error?.message || 'Node unavailable',
      });
    }
  }

  const servers = await Promise.all(
    serverQ.rows.map(async (server: any) => {
      try {
        const live = await nodeFetchFor(
          server,
          `/v1/servers/${encodeURIComponent(server.identifier)}/status`,
        );
        return { ...server, status: String(live.status || server.status), live };
      } catch {
        return { ...server, status: 'offline' };
      }
    }),
  );

  const running = servers.filter((s: any) => s.status === 'running').length;
  const cpuAllocated = serverQ.rows.reduce((sum: number, s: any) => sum + Number(s.cpu_limit || 0), 0);
  const memoryAllocated = serverQ.rows.reduce((sum: number, s: any) => sum + Number(s.memory_mb || 0), 0);
  const cpuCapacity = nodeQ.rows.reduce((sum: number, n: any) => sum + Number(n.capacity_cpu || 0), 0);
  const memoryCapacity = nodeQ.rows.reduce((sum: number, n: any) => sum + Number(n.capacity_memory_mb || 0), 0);
  const revenue = Number(revenueQ.rows[0]?.amount || 0);
  const currency = String(revenueQ.rows[0]?.currency || 'LKR');

  return (
    <>
      <div className="pageHead">
        <div>
          <p>{staff ? 'CRAKHOST CLOUD' : 'CUSTOMER PANEL'}</p>
          <h1>{staff ? 'Infrastructure Overview' : 'My Hosting'}</h1>
          <p>Live data from your real CrakNode workloads.</p>
        </div>
        <div className="actions">
          {staff && (
            <Link className="btn" href="/operations">
              <Bell size={15} /> Operations
            </Link>
          )}
          <Link className="btn indigo" href="/checkout">
            <Plus size={15} /> Order Server
          </Link>
        </div>
      </div>

      <div className="grid4">
        <Metric
          icon={<Activity size={16} />}
          label="Servers"
          value={String(servers.length)}
          sub={`${running} running · ${Math.max(0, servers.length - running)} offline/stopped`}
        />
        <Metric
          icon={<Cpu size={16} />}
          label="CPU Allocated"
          value={`${fmt(cpuAllocated)} vCPU`}
          sub={staff ? `${fmt(cpuCapacity)} vCPU node capacity` : 'Across your servers'}
        />
        <Metric
          icon={<MemoryStick size={16} />}
          label="Memory Allocated"
          value={`${fmtGB(memoryAllocated)} GB`}
          sub={staff ? `${fmtGB(memoryCapacity)} GB node capacity` : 'Across your servers'}
        />
        <Metric
          icon={<HardDrive size={16} />}
          label={staff ? 'Paid This Month' : 'My Spend This Month'}
          value={`${currency} ${revenue.toLocaleString()}`}
          sub="Calculated from paid invoices"
        />
      </div>

      <section className="section">
        <div className="sectionTitle">{staff ? 'Real Servers' : 'My Servers'}</div>
        <div className="serverTable">
          {servers.length === 0 ? (
            <div className="serverRow">
              <div>
                <div className="serverName">No servers yet</div>
                <div className="serverSub">Choose a plan to provision your first real server.</div>
              </div>
            </div>
          ) : (
            servers.map((server: any) => (
              <div className="serverRow" key={server.id}>
                <div>
                  <div className="serverName">{server.name}</div>
                  <div className="serverSub">
                    {server.node_name || 'No node'} · {server.primary_ip}:{server.primary_port}
                  </div>
                </div>
                <div className="hideSm">
                  <div className="status">
                    <span className={server.status === 'running' ? 'pulse' : ''} />
                    {server.status.toUpperCase()}
                  </div>
                </div>
                <div className="hideMd">
                  <div className="small">RAM</div>
                  {server.live?.memory ? `${Math.round(Number(server.live.memory))} MB / ` : ''}
                  {fmtGB(Number(server.memory_mb))} GB
                </div>
                <div className="hideSm">
                  <div className="small">CPU</div>
                  {server.live?.cpu != null
                    ? `${Number(server.live.cpu).toFixed(1)}% live`
                    : `${fmt(Number(server.cpu_limit))} vCPU`}
                </div>
                <div className="hideMd">
                  <div className="small">DISK</div>
                  {fmtGB(Number(server.disk_mb))} GB
                </div>
                <Link className="btn" href={`/servers/${server.identifier}`}>
                  <ArrowUpRight size={15} />
                </Link>
              </div>
            ))
          )}
        </div>
      </section>

      {staff && (
        <section className="section">
          <div className="card">
            <div className="sectionTitle">Live Nodes</div>
            <div className="list">
              {nodes.length === 0 ? (
                <div className="small">No nodes registered.</div>
              ) : (
                nodes.map((node: any) => (
                  <div className="listItem" key={node.id}>
                    <div>
                      <b>{node.name}</b>
                      <div className="small">
                        {node.location} ·{' '}
                        {node.status === 'online'
                          ? `${node.latencyMs} ms · ${node.runningContainers || 0}/${node.managedContainers || 0} managed running`
                          : node.error || 'Node unavailable'}
                      </div>
                    </div>
                    <span className="badge">{node.status.toUpperCase()}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function Metric({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="card">
      <div className="metricTop">
        <span>{label}</span>
        {icon}
      </div>
      <div className="metricValue">{value}</div>
      <div className="small">{sub}</div>
    </div>
  );
}

function fmt(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(2)).toString() : '0';
}

function fmtGB(mb: number) {
  return Number.isFinite(mb) ? Number((mb / 1024).toFixed(1)).toString() : '0';
}
