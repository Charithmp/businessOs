import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AuthRequest, IdentityService } from '../identity/identity.service';

export type LogFilters = { organizationId?: string; event?: string; level?: string; from?: string; to?: string; before?: string; limit?: number };
type RequestRecord = { requestId:string; traceId:string; organizationId:string|null; actorUserId:string|null; method:string; route:string; statusCode:number; durationMs:number };

@Injectable()
export class ObservabilityService implements OnModuleInit, OnModuleDestroy {
  private readonly db = new Pool({ connectionString:process.env.DATABASE_URL });
  private retentionTimer?:NodeJS.Timeout;
  private readonly pending = new Set<Promise<void>>();
  constructor(private readonly identity:IdentityService) {}
  onModuleInit() {
    const configured = Number(process.env.SYSTEM_LOG_RETENTION_DAYS ?? 30);
    const days = Number.isInteger(configured) && configured >= 1 && configured <= 3650 ? configured : 30;
    const prune = () => { void this.db.query('SELECT prune_system_logs($1)',[days]).catch(()=>process.stderr.write('System log retention failed\n')); };
    prune();
    this.retentionTimer = setInterval(prune,24*60*60*1000);
    this.retentionTimer.unref();
  }
  async onModuleDestroy() {
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    await Promise.allSettled([...this.pending]);
    await this.db.end();
  }

  recordRequest(input:RequestRecord):Promise<void> {
    const write = this.writeRequest(input);
    this.pending.add(write);
    void write.finally(()=>this.pending.delete(write)).catch(()=>undefined);
    return write;
  }

  private async writeRequest(input:RequestRecord) {
    const level = input.statusCode >= 500 ? 'ERROR' : input.statusCode >= 400 ? 'WARN' : 'INFO';
    await this.db.query(`INSERT INTO system_logs(id,organization_id,actor_user_id,request_id,trace_id,event,level,method,route,status_code,duration_ms)
      VALUES($1,$2,$3,$4,$5,'http.request',$6,$7,$8,$9,$10)`,
      [randomUUID(),input.organizationId,input.actorUserId,input.requestId,input.traceId,level,input.method,input.route,input.statusCode,input.durationMs]);
    let event:string|undefined;
    let severity = 'LOW';
    if (input.statusCode === 401) { event='auth.denied'; severity='MEDIUM'; }
    else if (input.statusCode === 403) { event='access.denied'; severity='HIGH'; }
    else if (input.route === '/api/v1/auth/login' && input.statusCode === 201) event='auth.login.success';
    else if (input.route === '/api/v1/auth/logout' && input.statusCode === 201) event='auth.logout';
    if (event) await this.db.query(`INSERT INTO security_events(id,organization_id,actor_user_id,request_id,trace_id,event,severity,route,status_code)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [randomUUID(),input.organizationId,input.actorUserId,input.requestId,input.traceId,event,severity,input.route,input.statusCode]);
  }

  async search(request:AuthRequest, kind:'audit'|'system'|'security', filters:LogFilters) {
    await this.identity.requireLogViewer(request,filters.organizationId);
    const table = kind === 'audit' ? 'audit_logs' : kind === 'security' ? 'security_events' : 'system_logs';
    const values:unknown[] = [];
    const conditions:string[] = [];
    const add = (column:string,value:unknown,operator = '=') => { values.push(value); conditions.push(`${column} ${operator} $${values.length}`); };
    if (filters.organizationId) add('organization_id',filters.organizationId);
    if (filters.event) add(kind === 'audit' ? 'action' : 'event',filters.event);
    if (filters.level && kind !== 'audit') add(kind === 'security' ? 'severity' : 'level',filters.level);
    if (filters.from) add('created_at',filters.from,'>=');
    if (filters.to) add('created_at',filters.to,'<=');
    if (filters.before) add('created_at',filters.before,'<');
    values.push(Math.min(Math.max(filters.limit ?? 50,1),100));
    const result = await this.db.query(`SELECT * FROM ${table} ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY created_at DESC,id DESC LIMIT $${values.length}`,values);
    return { items:result.rows,nextBefore:result.rows.length === values[values.length-1] ? result.rows[result.rows.length-1].created_at : null };
  }

  async metrics(request:AuthRequest, organizationId?:string) {
    await this.identity.requireLogViewer(request,organizationId);
    const values = organizationId ? [organizationId] : [];
    const scope = organizationId ? 'AND organization_id=$1' : '';
    const summary = await this.db.query(`SELECT COUNT(*)::int AS requests,COUNT(*) FILTER(WHERE status_code>=500)::int AS errors,
      COALESCE(ROUND(AVG(duration_ms))::int,0) AS avg_duration_ms,
      COALESCE(ROUND((percentile_cont(0.95) WITHIN GROUP(ORDER BY duration_ms))::numeric)::int,0) AS p95_duration_ms
      FROM system_logs WHERE created_at>=now()-interval '24 hours' ${scope}`,values);
    const routes = await this.db.query(`SELECT route,COUNT(*)::int AS requests,COUNT(*) FILTER(WHERE status_code>=500)::int AS errors
      FROM system_logs WHERE created_at>=now()-interval '24 hours' ${scope} GROUP BY route ORDER BY requests DESC LIMIT 20`,values);
    const security = await this.db.query(`SELECT event,COUNT(*)::int AS count FROM security_events WHERE created_at>=now()-interval '24 hours' ${scope} GROUP BY event ORDER BY count DESC`,values);
    return { window:'24h',...summary.rows[0],routes:routes.rows,securityEvents:security.rows };
  }
}
