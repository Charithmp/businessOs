const assert = require('node:assert/strict');
const { randomUUID, randomBytes, scryptSync } = require('node:crypto');
const { Client } = require('pg');
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { AppModule } = require('../dist/app.module');
const { redisCommand } = require('../dist/commercial/redis-cache');

async function main() {
  const db = new Client({ connectionString:process.env.DATABASE_URL });
  await db.connect();
  const tag = randomUUID().slice(0,8);
  const ids = { platform:randomUUID(),agency:randomUUID(),business:randomUUID(),other:randomUUID(),platformUser:randomUUID(),agencyUser:randomUUID(),businessUser:randomUUID() };
  const password = 'CommercialTest123!';
  const salt = randomBytes(16).toString('hex');
  const hash = `${salt}:${scryptSync(password,salt,64).toString('hex')}`;
  let app;
  const catalog = { products:[],features:[],packages:[],addOns:[] };
  try {
    for (const [role,id] of [['platform',ids.platformUser],['agency',ids.agencyUser],['business',ids.businessUser]]) await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[id,`${role}-${tag}@example.test`,hash]);
    await db.query("INSERT INTO organizations(id,type,name,slug) VALUES($1,'PLATFORM','Commercial Test',$2)",[ids.platform,`platform-${tag}`]);
    await db.query("INSERT INTO organizations(id,parent_id,type,name,slug) VALUES($1,$2,'AGENCY','Commercial Agency',$3)",[ids.agency,ids.platform,`agency-${tag}`]);
    for (const [id,slug] of [[ids.business,`business-${tag}`],[ids.other,`other-${tag}`]]) await db.query("INSERT INTO organizations(id,parent_id,type,name,slug) VALUES($1,$2,'BUSINESS','Commercial Business',$3)",[id,ids.agency,slug]);
    for (const [org,user] of [[ids.platform,ids.platformUser],[ids.agency,ids.agencyUser],[ids.business,ids.businessUser]]) await db.query('INSERT INTO organization_members(organization_id,user_id,role_id) VALUES($1,$2,$3)',[org,user,'00000000-0000-4000-8000-000000000001']);
    app = await NestFactory.create(AppModule,{logger:false});
    app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));
    await app.listen(0,'127.0.0.1');
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    async function call(method,path,body,cookie) {
      const response = await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
      return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
    }
    async function login(role) { const result=await call('POST','/auth/login',{email:`${role}-${tag}@example.test`,password}); assert.equal(result.status,201); return result.cookie; }
    const platform = await login('platform'); const agency = await login('agency'); const business = await login('business');
    const product = await call('POST','/products',{key:`crm-${tag}`,name:'CRM'},platform); assert.equal(product.status,201,JSON.stringify(product.data)); catalog.products.push(product.data.id);
    const feature = await call('POST','/features',{productId:product.data.id,key:`contacts-${tag}`,name:'Contacts'},platform); assert.equal(feature.status,201,JSON.stringify(feature.data)); catalog.features.push(feature.data.id);
    assert.equal((await call('POST','/products',{key:`bad-${tag}`,name:'Bad'},business)).status,403);
    const pkg = await call('POST','/packages',{key:`starter-${tag}`,name:'Starter',features:[{key:feature.data.key,limit:2}]},platform); assert.equal(pkg.status,201,JSON.stringify(pkg.data)); catalog.packages.push(pkg.data.id);
    const addOn = await call('POST','/add-ons',{key:`more-${tag}`,name:'More contacts',features:[{key:feature.data.key,limit:3}]},platform); assert.equal(addOn.status,201,JSON.stringify(addOn.data)); catalog.addOns.push(addOn.data.id);
    const subscription = await call('PUT','/subscriptions',{organizationId:ids.business,packageVersionId:pkg.data.version.id,status:'ACTIVE',reason:'E2E test'},agency); assert.equal(subscription.status,200,JSON.stringify(subscription.data));
    assert.equal((await call('PUT','/subscriptions',{organizationId:ids.other,packageVersionId:pkg.data.version.id,status:'ACTIVE'},business)).status,403);
    assert.equal((await call('POST','/organizations/switch',{organizationId:ids.business},business)).status,201);
    const entitlement = await call('GET','/entitlements/me',undefined,business); assert.equal(entitlement.status,200); assert.deepEqual(entitlement.data.features,[{key:feature.data.key,enabled:true,limit:2,used:0}]);
    assert.ok(await redisCommand(['GET',`business-os:entitlements:${ids.business}`]));
    const first = await call('POST','/usage',{featureKey:feature.data.key,quantity:2,idempotencyKey:'first'},business); assert.equal(first.status,201,JSON.stringify(first.data));
    assert.equal((await call('POST','/usage',{featureKey:feature.data.key,quantity:2,idempotencyKey:'first'},business)).data.duplicate,true);
    assert.equal((await call('POST','/usage',{featureKey:feature.data.key,quantity:1,idempotencyKey:'second'},business)).status,403);
    const version2 = await call('POST',`/packages/${pkg.data.id}/versions`,{features:[]},platform); assert.equal(version2.status,201);
    assert.equal((await call('GET','/entitlements/me',undefined,business)).data.features[0].limit,2);
    assert.equal((await call('PUT',`/subscriptions/${ids.business}/add-ons`,{addOnId:addOn.data.id,enabled:true},agency)).status,200);
    assert.equal((await call('GET','/entitlements/me',undefined,business)).data.features[0].limit,5);
    assert.equal((await call('POST','/usage',{featureKey:feature.data.key,quantity:3,idempotencyKey:'second'},business)).status,201);
    assert.equal((await call('PUT',`/subscriptions/${ids.business}/overrides`,{featureKey:feature.data.key,enabled:false,reason:'Stop access'},agency)).status,200);
    assert.equal((await call('POST','/usage',{featureKey:feature.data.key,quantity:1,idempotencyKey:'third'},business)).status,403);
    assert.equal((await call('PUT','/subscriptions',{organizationId:ids.business,packageVersionId:pkg.data.version.id,status:'SUSPENDED',reason:'Test suspension'},agency)).status,200);
    const history = await db.query('SELECT action FROM subscription_history WHERE subscription_id=$1',[subscription.data.id]); assert.equal(history.rowCount,4);
    const audit = await db.query("SELECT action FROM audit_logs WHERE organization_id=$1 AND action LIKE 'subscription.%'",[ids.business]); assert.equal(audit.rowCount,4);
    console.log('Phase 2 end-to-end checks passed: catalog authorization, package version pinning, subscriptions, tenant isolation, entitlement resolution, add-ons, overrides, usage limits/idempotency, suspension, history and audit');
  } finally {
    if (app) await app.close();
    try { await redisCommand(['DEL',`business-os:entitlements:${ids.business}`]); } catch { /* Redis may be unavailable. */ }
    await db.query('DELETE FROM usage_records WHERE organization_id=ANY($1::uuid[])',[[ids.business,ids.other]]);
    await db.query('DELETE FROM subscription_history WHERE subscription_id IN (SELECT id FROM subscriptions WHERE organization_id=ANY($1::uuid[]))',[[ids.business,ids.other]]);
    await db.query('DELETE FROM subscription_overrides WHERE subscription_id IN (SELECT id FROM subscriptions WHERE organization_id=ANY($1::uuid[]))',[[ids.business,ids.other]]);
    await db.query('DELETE FROM subscription_add_ons WHERE subscription_id IN (SELECT id FROM subscriptions WHERE organization_id=ANY($1::uuid[]))',[[ids.business,ids.other]]);
    await db.query('DELETE FROM subscriptions WHERE organization_id=ANY($1::uuid[])',[[ids.business,ids.other]]);
    await db.query('DELETE FROM audit_logs WHERE organization_id=ANY($1::uuid[])',[[ids.platform,ids.agency,ids.business,ids.other]]);
    await db.query('DELETE FROM add_on_features WHERE add_on_id=ANY($1::uuid[])',[catalog.addOns]);
    await db.query('DELETE FROM add_ons WHERE id=ANY($1::uuid[])',[catalog.addOns]);
    await db.query('DELETE FROM package_features WHERE package_version_id IN (SELECT id FROM package_versions WHERE package_id=ANY($1::uuid[]))',[catalog.packages]);
    await db.query('DELETE FROM package_versions WHERE package_id=ANY($1::uuid[])',[catalog.packages]);
    await db.query('DELETE FROM packages WHERE id=ANY($1::uuid[])',[catalog.packages]);
    await db.query('DELETE FROM features WHERE id=ANY($1::uuid[])',[catalog.features]);
    await db.query('DELETE FROM products WHERE id=ANY($1::uuid[])',[catalog.products]);
    await db.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])',[[ids.platformUser,ids.agencyUser,ids.businessUser]]);
    await db.query('DELETE FROM organization_members WHERE organization_id=ANY($1::uuid[])',[[ids.platform,ids.agency,ids.business,ids.other]]);
    for (const id of [ids.business,ids.other,ids.agency,ids.platform]) await db.query('DELETE FROM organizations WHERE id=$1',[id]);
    await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[ids.platformUser,ids.agencyUser,ids.businessUser]]);
    await db.end();
  }
}
main().catch((error)=>{ console.error(error); process.exitCode=1; });
