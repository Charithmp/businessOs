const assert = require('node:assert/strict');
const { randomUUID, randomBytes, scryptSync } = require('node:crypto');
const { createServer } = require('node:http');
const { Client } = require('pg');
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { AppModule } = require('../dist/app.module');
const { startTelemetry, stopTelemetry } = require('../dist/observability/telemetry');

async function main() {
  const db = new Client({ connectionString:process.env.DATABASE_URL }); await db.connect();
  const tag = randomUUID().slice(0,8);
  const ids = { platform:randomUUID(),agency:randomUUID(),businessA:randomUUID(),businessB:randomUUID(),platformUser:randomUUID(),userA:randomUUID(),userB:randomUUID() };
  const password = 'ObservabilityTest123!'; const salt = randomBytes(16).toString('hex');
  const hash = `${salt}:${scryptSync(password,salt,64).toString('hex')}`;
  const telemetryExports = [];
  const collector = createServer((request,response)=>{
    const chunks=[]; request.on('data',(chunk)=>chunks.push(chunk)); request.on('end',()=>{ telemetryExports.push({path:request.url,body:Buffer.concat(chunks)}); response.writeHead(200,{'content-type':'application/json'}); response.end('{}'); });
  });
  await new Promise((resolve)=>collector.listen(0,'127.0.0.1',resolve));
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT=`http://127.0.0.1:${collector.address().port}`;
  startTelemetry();
  let app;
  try {
    for (const [kind,id] of [['platform',ids.platformUser],['a',ids.userA],['b',ids.userB]]) await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[id,`${kind}-${tag}@example.test`,hash]);
    await db.query("INSERT INTO organizations(id,type,name,slug) VALUES($1,'PLATFORM','Observability Platform',$2)",[ids.platform,`obs-platform-${tag}`]);
    await db.query("INSERT INTO organizations(id,parent_id,type,name,slug) VALUES($1,$2,'AGENCY','Observability Agency',$3)",[ids.agency,ids.platform,`obs-agency-${tag}`]);
    for (const [id,name] of [[ids.businessA,'A'],[ids.businessB,'B']]) await db.query("INSERT INTO organizations(id,parent_id,type,name,slug) VALUES($1,$2,'BUSINESS',$3,$4)",[id,ids.agency,`Business ${name}`,`obs-${name.toLowerCase()}-${tag}`]);
    for (const [org,user] of [[ids.platform,ids.platformUser],[ids.businessA,ids.userA],[ids.businessB,ids.userB]]) await db.query('INSERT INTO organization_members(organization_id,user_id,role_id) VALUES($1,$2,$3)',[org,user,'00000000-0000-4000-8000-000000000001']);
    app = await NestFactory.create(AppModule,{logger:false}); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true})); await app.listen(0,'127.0.0.1');
    const base=`http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    async function call(method,path,body,cookie) {
      const response=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
      return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0],requestId:response.headers.get('x-request-id')};
    }
    async function login(kind) { const result=await call('POST','/auth/login',{email:`${kind}-${tag}@example.test`,password}); assert.equal(result.status,201); return result.cookie; }
    const platform=await login('platform'); const a=await login('a'); const b=await login('b');
    assert.equal((await call('POST','/organizations/switch',{organizationId:ids.businessA},a)).status,201);
    assert.equal((await call('POST','/organizations/switch',{organizationId:ids.businessB},b)).status,201);
    const secret='SecretQueryValue123';
    const me=await call('GET',`/me?token=${secret}`,undefined,a); assert.equal(me.status,200); assert.match(me.requestId,/^[0-9a-f-]{36}$/);
    assert.equal((await call('GET',`/organizations/${ids.businessB}`,undefined,a)).status,403);
    const support=await call('POST',`/organizations/${ids.businessA}/support-access`,{reason:'password=SecretReasonValue123',minutes:5},platform); assert.equal(support.status,201);
    async function until(check) { for(let i=0;i<40;i++){const value=await check();if(value)return value;await new Promise((resolve)=>setTimeout(resolve,100));}throw new Error('Timed out waiting for async log'); }
    const system=await until(async()=>{const result=await call('GET',`/observability/system?organizationId=${ids.businessA}&event=http.request`,undefined,a);return result.data.items?.some((item)=>item.request_id===me.requestId)?result:null;});
    assert.equal(system.status,200); assert.equal(JSON.stringify(system.data).includes(secret),false);
    assert.ok(system.data.items.some((item)=>item.request_id===me.requestId && item.route==='/api/v1/me' && item.actor_user_id===ids.userA));
    const security=await until(async()=>{const result=await call('GET',`/observability/security?organizationId=${ids.businessA}&event=access.denied`,undefined,a);return result.data.items?.length?result:null;});
    assert.equal(security.status,200); assert.equal(security.data.items[0].severity,'HIGH');
    const audit=await call('GET',`/observability/audit?organizationId=${ids.businessA}&event=support_access.granted`,undefined,a); assert.equal(audit.status,200);
    assert.equal(audit.data.items[0].reason,'[REDACTED]'); assert.equal(JSON.stringify(audit.data).includes('SecretReasonValue123'),false);
    assert.equal((await call('GET',`/observability/audit?organizationId=${ids.businessA}`,undefined,b)).status,403);
    assert.equal((await call('GET','/observability/audit',undefined,a)).status,403);
    assert.equal((await call('GET','/observability/audit',undefined,platform)).status,200);
    const metric=await call('GET',`/observability/metrics?organizationId=${ids.businessA}`,undefined,a); assert.equal(metric.status,200); assert.ok(metric.data.requests>=2);
    await assert.rejects(db.query('UPDATE audit_logs SET reason=$1 WHERE id=$2',['tampered',audit.data.items[0].id]),(error)=>error.code==='55000');
    await assert.rejects(db.query('DELETE FROM audit_logs WHERE id=$1',[audit.data.items[0].id]),(error)=>error.code==='55000');
    await assert.rejects(db.query('DELETE FROM security_events WHERE id=$1',[security.data.items[0].id]),(error)=>error.code==='55000');
    const oldId=randomUUID();
    await db.query("INSERT INTO system_logs(id,request_id,event,level,created_at) VALUES($1,$2,'test.old','INFO',now()-interval '40 days')",[oldId,randomUUID()]);
    await db.query('SELECT prune_system_logs(30)');
    assert.equal((await db.query('SELECT 1 FROM system_logs WHERE id=$1',[oldId])).rowCount,0);
    assert.equal((await db.query('SELECT 1 FROM system_logs WHERE request_id=$1',[me.requestId])).rowCount,1);
    console.log('Phase 3 end-to-end checks passed: scoped search, security events, redaction, audit immutability, request correlation, metrics and retention');
  } finally {
    if (app) await app.close();
    await stopTelemetry();
    await new Promise((resolve)=>collector.close(resolve));
    const users=[ids.platformUser,ids.userA,ids.userB]; const orgs=[ids.platform,ids.agency,ids.businessA,ids.businessB];
    await db.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])',[users]);
    await db.query('DELETE FROM support_access WHERE organization_id=ANY($1::uuid[])',[orgs]);
    await db.query('DELETE FROM organization_members WHERE organization_id=ANY($1::uuid[])',[orgs]);
    for (const id of [ids.businessA,ids.businessB,ids.agency,ids.platform]) await db.query('DELETE FROM organizations WHERE id=$1',[id]);
    await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);
    await db.end();
  }
  assert.ok(telemetryExports.some((item)=>item.path==='/v1/traces' && item.body.length>0),'OTLP traces were not exported');
  assert.ok(telemetryExports.some((item)=>item.path==='/v1/metrics' && item.body.length>0),'OTLP metrics were not exported');
  assert.equal(telemetryExports.some((item)=>item.body.includes('SecretQueryValue123')),false);
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
