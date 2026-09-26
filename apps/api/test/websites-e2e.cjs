const assert=require('node:assert/strict');
const {randomUUID,randomBytes,scryptSync}=require('node:crypto');
const {Client}=require('pg');
require('reflect-metadata');
const {NestFactory}=require('@nestjs/core');
const {ValidationPipe}=require('@nestjs/common');
const {AppModule}=require('../dist/app.module');

async function main() {
  process.env.AI_ENABLE_MOCK='true';
  const db=new Client({connectionString:process.env.DATABASE_URL}); await db.connect();
  const tag=randomUUID().slice(0,8); const id=()=>randomUUID();
  const ids={platform:id(),agency:id(),business:id(),other:id(),owner:id(),user:id(),otherUser:id(),product:id(),pkg:id(),version:id(),subscription:id()};
  const featureIds=[id(),id(),id()]; const password='WebsiteTest123!'; const salt=randomBytes(16).toString('hex'); const hash=`${salt}:${scryptSync(password,salt,64).toString('hex')}`;
  let app; let siteId; let previousRoute; let routeTouched=false; const createdFeatures=[];
  try {
    for(const [name,user] of [['owner',ids.owner],['user',ids.user],['other',ids.otherUser]]) await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[user,`${name}-${tag}@example.test`,hash]);
    await db.query("INSERT INTO organizations(id,type,name,slug) VALUES($1,'PLATFORM','Website Platform',$2)",[ids.platform,`website-platform-${tag}`]);
    await db.query("INSERT INTO organizations(id,parent_id,type,name,slug) VALUES($1,$2,'AGENCY','Website Agency',$3)",[ids.agency,ids.platform,`website-agency-${tag}`]);
    for(const [org,slug] of [[ids.business,`website-a-${tag}`],[ids.other,`website-b-${tag}`]]) await db.query("INSERT INTO organizations(id,parent_id,type,name,slug) VALUES($1,$2,'BUSINESS','Website Business',$3)",[org,ids.agency,slug]);
    for(const [org,user] of [[ids.platform,ids.owner],[ids.business,ids.user],[ids.other,ids.otherUser]]) await db.query('INSERT INTO organization_members(organization_id,user_id,role_id) VALUES($1,$2,$3)',[org,user,'00000000-0000-4000-8000-000000000001']);
    await db.query('INSERT INTO products(id,key,name) VALUES($1,$2,$3)',[ids.product,`website-${tag}`,'Websites']);
    for(const [index,key] of ['website.builder','website.ai','website.domains'].entries()) { const inserted=await db.query('INSERT INTO features(id,product_id,key,name) VALUES($1,$2,$3,$4) ON CONFLICT(key) DO NOTHING RETURNING id',[featureIds[index],ids.product,key,key]); if(inserted.rowCount) createdFeatures.push(featureIds[index]); }
    await db.query('INSERT INTO packages(id,key,name) VALUES($1,$2,$3)',[ids.pkg,`website-pkg-${tag}`,'Websites']);
    await db.query('INSERT INTO package_versions(id,package_id,version) VALUES($1,$2,1)',[ids.version,ids.pkg]);
    for(const key of ['website.builder','website.ai','website.domains']) await db.query('INSERT INTO package_features(package_version_id,feature_id) SELECT $1,id FROM features WHERE key=$2',[ids.version,key]);
    await db.query("INSERT INTO subscriptions(id,organization_id,package_version_id,status) VALUES($1,$2,$3,'ACTIVE')",[ids.subscription,ids.business,ids.version]);
    previousRoute=(await db.query("SELECT * FROM ai_model_routes WHERE policy='CHEAP'")).rows[0];
    await db.query("INSERT INTO ai_model_routes(policy,provider,model,input_cost_micros_per_1k,output_cost_micros_per_1k) VALUES('CHEAP','MOCK','test',1000,1000) ON CONFLICT(policy) DO UPDATE SET provider='MOCK',model='test',input_cost_micros_per_1k=1000,output_cost_micros_per_1k=1000,enabled=true");
    routeTouched=true;
    await db.query("INSERT INTO ai_settings(organization_id,monthly_budget_micros,key_source,default_policy) VALUES($1,1000000,'PLATFORM_MANAGED','CHEAP')",[ids.business]);
    app=await NestFactory.create(AppModule,{logger:false}); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true})); await app.listen(0,'127.0.0.1');
    const base=`http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    async function call(method,path,body,cookie,raw=false) { const response=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined}); return {status:response.status,data:raw?await response.text():await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}; }
    async function login(name) { const response=await call('POST','/auth/login',{email:`${name}-${tag}@example.test`,password}); assert.equal(response.status,201); return response.cookie; }
    const owner=await login('owner'), user=await login('user'), other=await login('other');
    assert.equal((await call('POST','/organizations/switch',{organizationId:ids.business},user)).status,201);
    assert.equal((await call('POST','/organizations/switch',{organizationId:ids.other},other)).status,201);
    const templates=await call('GET','/website-templates',undefined,user); assert.equal(templates.status,200); assert.ok(templates.data.length>=2);
    const created=await call('POST','/websites',{name:'Test site',slug:`site-${tag}`,templateId:templates.data[0].id},user); assert.equal(created.status,201,JSON.stringify(created.data)); siteId=created.data.id;
    assert.equal((await call('GET',`/websites/${siteId}`,undefined,other)).status,404);
    assert.equal((await call('POST',`/websites/${siteId}/publish`,undefined,user)).status,201);
    const publicV1=await call('GET',`/public/sites/site-${tag}`,undefined,undefined,true); assert.equal(publicV1.status,200); assert.match(publicV1.data,/<!doctype html>/);
    const imported=await call('POST',`/websites/${siteId}/import-html`,{html:'<h1>Changed</h1><script>alert(1)</script><p>Safe text</p>',expectedRevision:1},user); assert.equal(imported.status,201,JSON.stringify(imported.data)); assert.equal(imported.data.mode,'CONVERTED');
    const preview=await call('GET',`/websites/${siteId}/preview`,undefined,user,true); assert.match(preview.data,/Changed/); assert.doesNotMatch(preview.data,/<script>/);
    const version2=await call('POST',`/websites/${siteId}/publish`,undefined,user); assert.equal(version2.status,201); assert.match((await call('GET',`/public/sites/site-${tag}`,undefined,undefined,true)).data,/Changed/);
    const versions=await call('GET',`/websites/${siteId}/versions`,undefined,user); assert.equal(versions.data.length,2);
    assert.equal((await call('POST',`/websites/${siteId}/rollback`,{versionId:versions.data[1].id},user)).status,201);
    assert.doesNotMatch((await call('GET',`/public/sites/site-${tag}`,undefined,undefined,true)).data,/Changed/);
    const clone=await call('POST',`/websites/${siteId}/clone`,{name:'Clone',slug:`clone-${tag}`},user); assert.equal(clone.status,201);
    const domain=await call('POST',`/websites/${siteId}/domains`,{hostname:`www.example-${tag}.com`},user); assert.equal(domain.status,201); assert.equal(domain.data.status,'PENDING_VERIFICATION');
    assert.equal((await call('GET','/public/domain',undefined,undefined,true)).status,404);
    const generation=await call('POST',`/websites/${siteId}/generate`,{prompt:'Friendly bakery',expectedRevision:2,idempotencyKey:`gen-${tag}`,policy:'CHEAP'},user); assert.equal(generation.status,201,JSON.stringify(generation.data)); assert.equal(generation.data.status,'SUCCEEDED');
    const repeated=await call('POST',`/websites/${siteId}/generate`,{prompt:'Friendly bakery',expectedRevision:2,idempotencyKey:`gen-${tag}`,policy:'CHEAP'},user); assert.equal(repeated.data.requestId,generation.data.requestId);
    assert.equal((await call('POST',`/websites/${siteId}/generate`,{prompt:'Different',expectedRevision:2,idempotencyKey:`gen-${tag}`,policy:'CHEAP'},user)).status,409);
    assert.equal((await call('GET','/ai/usage',undefined,user)).data[0].status,'SUCCEEDED');
    assert.equal((await call('GET',`/websites/${siteId}/deployments`,undefined,user)).data.length,3);
    console.log('Phase 4 E2E passed: templates, tenant scope, preview, sanitized import, immutable versions, publish/rollback, clone, domain gating, AI routing/budget/idempotency');
  } finally {
    if(app) await app.close();
    await db.query('DELETE FROM ai_requests WHERE organization_id=$1',[ids.business]);
    await db.query('DELETE FROM ai_settings WHERE organization_id=$1',[ids.business]);
    await db.query('DELETE FROM website_domains WHERE organization_id=$1',[ids.business]);
    await db.query('UPDATE websites SET published_version_id=NULL WHERE organization_id=$1',[ids.business]);
    await db.query('DELETE FROM website_deployments WHERE website_id IN (SELECT id FROM websites WHERE organization_id=$1)',[ids.business]);
    await db.query('DELETE FROM website_versions WHERE website_id IN (SELECT id FROM websites WHERE organization_id=$1)',[ids.business]);
    await db.query('DELETE FROM websites WHERE organization_id=$1',[ids.business]);
    await db.query('DELETE FROM subscriptions WHERE id=$1',[ids.subscription]);
    await db.query('DELETE FROM package_features WHERE package_version_id=$1',[ids.version]);
    await db.query('DELETE FROM package_versions WHERE id=$1',[ids.version]);
    await db.query('DELETE FROM packages WHERE id=$1',[ids.pkg]);
    if(routeTouched && previousRoute) await db.query('UPDATE ai_model_routes SET provider=$2,model=$3,input_cost_micros_per_1k=$4,output_cost_micros_per_1k=$5,enabled=$6 WHERE policy=$1',['CHEAP',previousRoute.provider,previousRoute.model,previousRoute.input_cost_micros_per_1k,previousRoute.output_cost_micros_per_1k,previousRoute.enabled]);
    else if(routeTouched) await db.query("DELETE FROM ai_model_routes WHERE policy='CHEAP'");
    if(createdFeatures.length) await db.query('DELETE FROM features WHERE id=ANY($1::uuid[])',[createdFeatures]);
    await db.query('DELETE FROM products WHERE id=$1',[ids.product]);
    await db.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])',[[ids.owner,ids.user,ids.otherUser]]);
    await db.query('DELETE FROM organization_members WHERE organization_id=ANY($1::uuid[])',[[ids.platform,ids.agency,ids.business,ids.other]]);
    for(const org of [ids.business,ids.other,ids.agency,ids.platform]) await db.query('DELETE FROM organizations WHERE id=$1',[org]);
    await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[ids.owner,ids.user,ids.otherUser]]);
    await db.end();
  }
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
