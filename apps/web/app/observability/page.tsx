'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';

type Organization = { id:string; name:string; type:string };
type LogEntry = { id:string; created_at:string; organization_id:string|null; actor_user_id:string|null; action?:string; event?:string; level?:string; severity?:string; route?:string; status_code?:number; duration_ms?:number; reason?:string|null; before_state?:unknown; after_state?:unknown };
type Metrics = { requests:number; errors:number; avg_duration_ms:number; p95_duration_ms:number; routes:{route:string;requests:number;errors:number}[]; securityEvents:{event:string;count:number}[] };
type Kind = 'audit'|'system'|'security';

export default function ObservabilityPage() {
  const [organizations,setOrganizations] = useState<Organization[]>([]);
  const [organizationId,setOrganizationId] = useState('');
  const [kind,setKind] = useState<Kind>('audit');
  const [event,setEvent] = useState('');
  const [level,setLevel] = useState('');
  const [from,setFrom] = useState('');
  const [to,setTo] = useState('');
  const [items,setItems] = useState<LogEntry[]>([]);
  const [nextBefore,setNextBefore] = useState<string|null>(null);
  const [metrics,setMetrics] = useState<Metrics|null>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);

  const load = useCallback(async (before?:string) => {
    setBusy(true); setError('');
    try {
      const query = new URLSearchParams();
      if (organizationId) query.set('organizationId',organizationId);
      if (event.trim()) query.set('event',event.trim());
      if (level) query.set('level',level);
      if (from) query.set('from',new Date(from).toISOString());
      if (to) query.set('to',new Date(to).toISOString());
      if (before) query.set('before',before);
      query.set('limit','50');
      const response = await fetch(`/api/v1/observability/${kind}?${query}`,{credentials:'same-origin'});
      if (!response.ok) throw new Error(response.status === 403 ? 'An owner role is required to view these records.' : 'Unable to load logs. Check your sign-in and filters.');
      const result = await response.json() as { items:LogEntry[]; nextBefore:string|null };
      setItems((current)=>before?[...current,...result.items]:result.items);
      setNextBefore(result.nextBefore);
      const metricQuery = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : '';
      const metricResponse = await fetch(`/api/v1/observability/metrics${metricQuery}`,{credentials:'same-origin'});
      if (metricResponse.ok) setMetrics(await metricResponse.json() as Metrics);
    } catch (cause) { setError(cause instanceof Error?cause.message:'Unable to load observability data'); }
    finally { setBusy(false); }
  },[organizationId,event,level,from,to,kind]);

  useEffect(()=>{ void fetch('/api/v1/organizations',{credentials:'same-origin'}).then(async (response)=>{ if (response.ok) setOrganizations(await response.json() as Organization[]); }); },[]);
  useEffect(()=>{ void load(); },[load]);
  function submit(eventObject:FormEvent) { eventObject.preventDefault(); void load(); }

  return <main className="wide">
    <nav><a href="/">Business OS</a> / Observability</nav>
    <h1>Logs &amp; audit</h1>
    <p>Search operational, security, and append-only audit records. A platform owner may search globally; other owners must select an authorized organization.</p>
    <form className="filter-grid" onSubmit={submit}>
      <label>Organization<select value={organizationId} onChange={(e)=>setOrganizationId(e.target.value)}><option value="">Global (platform owner)</option>{organizations.map((org)=><option key={org.id} value={org.id}>{org.name} ({org.type})</option>)}</select></label>
      <label>Record type<select value={kind} onChange={(e)=>{setKind(e.target.value as Kind);setLevel('');}}><option value="audit">Audit</option><option value="system">System</option><option value="security">Security</option></select></label>
      <label>Action / event<input value={event} onChange={(e)=>setEvent(e.target.value)} placeholder="Exact name" /></label>
      <label>Level<select value={level} onChange={(e)=>setLevel(e.target.value)} disabled={kind==='audit'}><option value="">All</option>{(kind==='security'?['LOW','MEDIUM','HIGH']:['INFO','WARN','ERROR']).map((value)=><option value={value} key={value}>{value}</option>)}</select></label>
      <label>From<input type="datetime-local" value={from} onChange={(e)=>setFrom(e.target.value)} /></label>
      <label>To<input type="datetime-local" value={to} onChange={(e)=>setTo(e.target.value)} /></label>
      <button type="submit" disabled={busy}>Search</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {metrics && <section className="metrics" aria-label="Last 24 hours">
      <div><strong>{metrics.requests}</strong><span>Requests / 24h</span></div>
      <div><strong>{metrics.errors}</strong><span>Server errors</span></div>
      <div><strong>{metrics.avg_duration_ms} ms</strong><span>Average latency</span></div>
      <div><strong>{metrics.p95_duration_ms} ms</strong><span>95th percentile</span></div>
    </section>}
    <section className="log-section">
      <h2>{kind[0].toUpperCase()+kind.slice(1)} records</h2>
      <div className="table-scroll"><table><thead><tr><th>Time</th><th>Action / event</th><th>Severity</th><th>Route / resource</th><th>Status</th><th>Actor</th><th>Details</th></tr></thead><tbody>
        {items.map((item)=><tr key={item.id}><td>{new Date(item.created_at).toLocaleString()}</td><td>{item.action ?? item.event}</td><td>{item.level ?? item.severity ?? '—'}</td><td>{item.route ?? item.id}</td><td>{item.status_code ?? '—'}</td><td>{item.actor_user_id ?? 'System / anonymous'}</td><td>{item.reason ?? (item.duration_ms!==undefined ? `${item.duration_ms} ms` : '—')}</td></tr>)}
      </tbody></table></div>
      {!items.length && !busy && <p>No records found for these filters.</p>}
      {nextBefore && <button onClick={()=>void load(nextBefore)} disabled={busy}>Load more</button>}
    </section>
  </main>;
}
