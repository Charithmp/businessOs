import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { AuthRequest, IdentityService } from '../identity/identity.service';
import { redisCommand } from './redis-cache';

type FeatureGrant = { key: string; enabled: boolean; limit: number | null; used: number };
type PackageInput = { key: string; name: string; features: { key: string; limit?: number | null }[] };
type SubscriptionInput = { organizationId: string; packageVersionId: string; status: string; trialEndsAt?: string; reason?: string };

@Injectable()
export class CommercialService {
  private readonly db = new Pool({ connectionString: process.env.DATABASE_URL });
  constructor(private readonly identity: IdentityService) {}
  private key(orgId: string) { return `business-os:entitlements:${orgId}`; }
  private async invalidate(orgId: string) { try { await redisCommand(['DEL',this.key(orgId)]); } catch { /* Database remains authoritative. */ } }

  private async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try { await client.query('BEGIN'); const value = await run(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  private async audit(client: PoolClient, orgId: string, actorId: string, action: string, resourceType: string, resourceId: string, reason?: string) {
    await client.query('INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),orgId,actorId,action,resourceType,resourceId,reason ?? null]);
  }
  private conflict(error: unknown): never {
    if ((error as { code?: string }).code === '23505') throw new ConflictException('Key or version already exists');
    if ((error as { code?: string }).code === '23503') throw new NotFoundException('Referenced catalog item not found');
    throw error;
  }

  async products(request: AuthRequest) { await this.identity.requirePlatformOwner(request); return (await this.db.query('SELECT id,key,name,active FROM products ORDER BY key')).rows; }
  async createProduct(request: AuthRequest, input: { key: string; name: string }) {
    const actor = await this.identity.requirePlatformOwner(request); const id = randomUUID();
    try { await this.transaction(async (db) => { await db.query('INSERT INTO products(id,key,name) VALUES($1,$2,$3)',[id,input.key,input.name]); await this.audit(db,actor.platformId,actor.userId,'product.created','product',id); }); }
    catch (error) { this.conflict(error); }
    return { id,...input };
  }
  async features(request: AuthRequest) { await this.identity.requirePlatformOwner(request); return (await this.db.query('SELECT f.id,f.key,f.name,f.active,p.key AS product_key FROM features f JOIN products p ON p.id=f.product_id ORDER BY f.key')).rows; }
  async createFeature(request: AuthRequest, input: { productId: string; key: string; name: string }) {
    const actor = await this.identity.requirePlatformOwner(request); const id = randomUUID();
    try { await this.transaction(async (db) => { await db.query('INSERT INTO features(id,product_id,key,name) VALUES($1,$2,$3,$4)',[id,input.productId,input.key,input.name]); await this.audit(db,actor.platformId,actor.userId,'feature.created','feature',id); }); }
    catch (error) { this.conflict(error); }
    return { id,...input };
  }
  async packages(request: AuthRequest) { await this.identity.requirePlatformOwner(request); return (await this.db.query('SELECT p.id,p.key,p.name,p.active,v.id AS version_id,v.version FROM packages p LEFT JOIN package_versions v ON v.package_id=p.id ORDER BY p.key,v.version')).rows; }
  async createPackage(request: AuthRequest, input: PackageInput) {
    const actor = await this.identity.requirePlatformOwner(request); const id = randomUUID();
    if (new Set(input.features.map((item) => item.key)).size !== input.features.length) throw new BadRequestException('Duplicate feature');
    const versionId = randomUUID();
    try { await this.transaction(async (db) => {
      await db.query('INSERT INTO packages(id,key,name) VALUES($1,$2,$3)',[id,input.key,input.name]);
      await db.query('INSERT INTO package_versions(id,package_id,version) VALUES($1,$2,1)',[versionId,id]);
      for (const item of input.features) {
        const feature = await db.query('SELECT id FROM features WHERE key=$1 AND active=true',[item.key]);
        if (!feature.rowCount) throw new NotFoundException(`Feature ${item.key} not found`);
        await db.query('INSERT INTO package_features(package_version_id,feature_id,usage_limit) VALUES($1,$2,$3)',[versionId,feature.rows[0].id,item.limit ?? null]);
      }
      await this.audit(db,actor.platformId,actor.userId,'package.created','package',id);
      await this.audit(db,actor.platformId,actor.userId,'package.version.created','package_version',versionId);
    }); }
    catch (error) { this.conflict(error); }
    return { id,key:input.key,name:input.name,version:{ id:versionId,packageId:id,version:1,features:input.features } };
  }
  async createVersion(request: AuthRequest, packageId: string, features: { key: string; limit?: number | null }[]) {
    const actor = await this.identity.requirePlatformOwner(request); const id = randomUUID();
    if (new Set(features.map((item) => item.key)).size !== features.length) throw new BadRequestException('Duplicate feature');
    try {
      return await this.transaction(async (db) => {
        const pkg = await db.query('SELECT id FROM packages WHERE id=$1 AND active=true FOR UPDATE',[packageId]);
        if (!pkg.rowCount) throw new NotFoundException('Package not found');
        const next = await db.query<{ version: number }>('SELECT COALESCE(MAX(version),0)+1 AS version FROM package_versions WHERE package_id=$1',[packageId]);
        const version = next.rows[0].version;
        await db.query('INSERT INTO package_versions(id,package_id,version) VALUES($1,$2,$3)',[id,packageId,version]);
        for (const item of features) {
          const feature = await db.query('SELECT id FROM features WHERE key=$1 AND active=true',[item.key]);
          if (!feature.rowCount) throw new NotFoundException(`Feature ${item.key} not found`);
          await db.query('INSERT INTO package_features(package_version_id,feature_id,usage_limit) VALUES($1,$2,$3)',[id,feature.rows[0].id,item.limit ?? null]);
        }
        await this.audit(db,actor.platformId,actor.userId,'package.version.created','package_version',id);
        return { id,packageId,version,features };
      });
    } catch (error) { this.conflict(error); }
  }
  async addOns(request: AuthRequest) { await this.identity.requirePlatformOwner(request); return (await this.db.query('SELECT id,key,name,active FROM add_ons ORDER BY key')).rows; }
  async createAddOn(request: AuthRequest, input: PackageInput) {
    const actor = await this.identity.requirePlatformOwner(request); const id = randomUUID();
    if (new Set(input.features.map((item) => item.key)).size !== input.features.length) throw new BadRequestException('Duplicate feature');
    try { await this.transaction(async (db) => {
      await db.query('INSERT INTO add_ons(id,key,name) VALUES($1,$2,$3)',[id,input.key,input.name]);
      for (const item of input.features) {
        const feature = await db.query('SELECT id FROM features WHERE key=$1 AND active=true',[item.key]);
        if (!feature.rowCount) throw new NotFoundException(`Feature ${item.key} not found`);
        await db.query('INSERT INTO add_on_features(add_on_id,feature_id,usage_limit) VALUES($1,$2,$3)',[id,feature.rows[0].id,item.limit ?? null]);
      }
      await this.audit(db,actor.platformId,actor.userId,'add_on.created','add_on',id);
    }); } catch (error) { this.conflict(error); }
    return { id,...input };
  }
  async setSubscription(request: AuthRequest, input: SubscriptionInput) {
    const actorId = await this.identity.requireCommercialManager(request,input.organizationId);
    if (input.status === 'TRIAL' && (!input.trialEndsAt || new Date(input.trialEndsAt) <= new Date())) throw new BadRequestException('Future trial end required');
    const id = await this.transaction(async (db) => {
      const version = await db.query('SELECT 1 FROM package_versions WHERE id=$1',[input.packageVersionId]);
      if (!version.rowCount) throw new NotFoundException('Package version not found');
      const previous = await db.query('SELECT * FROM subscriptions WHERE organization_id=$1 FOR UPDATE',[input.organizationId]);
      const subscriptionId = previous.rows[0]?.id ?? randomUUID();
      await db.query(`INSERT INTO subscriptions(id,organization_id,package_version_id,status,trial_ends_at) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(organization_id) DO UPDATE SET package_version_id=EXCLUDED.package_version_id,status=EXCLUDED.status,trial_ends_at=EXCLUDED.trial_ends_at,updated_at=now()`,[subscriptionId,input.organizationId,input.packageVersionId,input.status,input.trialEndsAt ?? null]);
      const after = await db.query('SELECT * FROM subscriptions WHERE id=$1',[subscriptionId]);
      await db.query('INSERT INTO subscription_history(id,subscription_id,actor_user_id,action,before_state,after_state,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),subscriptionId,actorId,previous.rowCount?'subscription.changed':'subscription.created',previous.rows[0] ?? null,after.rows[0],input.reason ?? null]);
      await this.audit(db,input.organizationId,actorId,previous.rowCount?'subscription.changed':'subscription.created','subscription',subscriptionId,input.reason);
      return subscriptionId;
    });
    await this.invalidate(input.organizationId);
    return this.subscription(request,input.organizationId,id);
  }
  async subscription(request: AuthRequest, orgId: string, id?: string) {
    await this.identity.requireBusinessRead(request,orgId);
    const row = await this.db.query('SELECT s.id,s.organization_id,s.package_version_id,s.status,s.trial_ends_at,s.updated_at FROM subscriptions s WHERE s.organization_id=$1'+(id?' AND s.id=$2':''),id?[orgId,id]:[orgId]);
    if (!row.rows[0]) throw new NotFoundException('Subscription not found');
    return row.rows[0];
  }
  async setAddOn(request: AuthRequest, orgId: string, addOnId: string, enabled: boolean, reason?: string) {
    const actorId = await this.identity.requireCommercialManager(request,orgId);
    await this.transaction(async (db) => {
      const sub = await db.query('SELECT id FROM subscriptions WHERE organization_id=$1 FOR UPDATE',[orgId]);
      if (!sub.rowCount) throw new NotFoundException('Subscription not found');
      const addon = await db.query('SELECT id FROM add_ons WHERE id=$1 AND active=true',[addOnId]);
      if (!addon.rowCount) throw new NotFoundException('Add-on not found');
      if (enabled) await db.query('INSERT INTO subscription_add_ons(subscription_id,add_on_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[sub.rows[0].id,addOnId]);
      else await db.query('DELETE FROM subscription_add_ons WHERE subscription_id=$1 AND add_on_id=$2',[sub.rows[0].id,addOnId]);
      const after = { addOnId,enabled };
      await db.query('INSERT INTO subscription_history(id,subscription_id,actor_user_id,action,after_state,reason) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),sub.rows[0].id,actorId,'subscription.add_on.changed',after,reason ?? null]);
      await this.audit(db,orgId,actorId,'subscription.add_on.changed','subscription',sub.rows[0].id,reason);
    });
    await this.invalidate(orgId);
    return this.entitlements(request,orgId);
  }
  async setOverride(request: AuthRequest, orgId: string, featureKey: string, enabled: boolean, limit: number | null, reason?: string) {
    const actorId = await this.identity.requireCommercialManager(request,orgId);
    await this.transaction(async (db) => {
      const sub = await db.query('SELECT id FROM subscriptions WHERE organization_id=$1 FOR UPDATE',[orgId]);
      if (!sub.rowCount) throw new NotFoundException('Subscription not found');
      const feature = await db.query('SELECT id FROM features WHERE key=$1 AND active=true',[featureKey]);
      if (!feature.rowCount) throw new NotFoundException('Feature not found');
      await db.query('INSERT INTO subscription_overrides(subscription_id,feature_id,enabled,usage_limit) VALUES($1,$2,$3,$4) ON CONFLICT(subscription_id,feature_id) DO UPDATE SET enabled=EXCLUDED.enabled,usage_limit=EXCLUDED.usage_limit',[sub.rows[0].id,feature.rows[0].id,enabled,limit]);
      await db.query('INSERT INTO subscription_history(id,subscription_id,actor_user_id,action,after_state,reason) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),sub.rows[0].id,actorId,'subscription.override.changed',{ featureKey,enabled,limit },reason ?? null]);
      await this.audit(db,orgId,actorId,'subscription.override.changed','subscription',sub.rows[0].id,reason);
    });
    await this.invalidate(orgId);
    return this.entitlements(request,orgId);
  }
  private async resolve(db: Pool | PoolClient, orgId: string) {
    const sub = await db.query<{ id: string; status: string; trial_ends_at: Date | null; package_version_id: string }>('SELECT id,status,trial_ends_at,package_version_id FROM subscriptions WHERE organization_id=$1',[orgId]);
    const row = sub.rows[0];
    if (!row) return { status:'NONE',features:[] as FeatureGrant[] };
    const active = row.status === 'ACTIVE' || (row.status === 'TRIAL' && row.trial_ends_at !== null && row.trial_ends_at > new Date());
    const grants = await db.query<{ key: string; usage_limit: number | null; source: number }>(`
      SELECT f.key,pf.usage_limit,1 AS source FROM package_features pf JOIN features f ON f.id=pf.feature_id WHERE pf.package_version_id=$1 AND f.active=true
      UNION ALL SELECT f.key,af.usage_limit,2 AS source FROM subscription_add_ons sa JOIN add_on_features af ON af.add_on_id=sa.add_on_id JOIN features f ON f.id=af.feature_id WHERE sa.subscription_id=$2 AND f.active=true
      UNION ALL SELECT f.key,so.usage_limit,CASE WHEN so.enabled THEN 3 ELSE 4 END AS source FROM subscription_overrides so JOIN features f ON f.id=so.feature_id WHERE so.subscription_id=$2 AND f.active=true`,[row.package_version_id,row.id]);
    const map = new Map<string,{ limit:number|null; enabled:boolean }>();
    for (const grant of grants.rows.sort((a,b)=>a.source-b.source)) {
      if (grant.source === 4) map.set(grant.key,{ enabled:false,limit:null });
      else if (grant.source === 3) map.set(grant.key,{ enabled:true,limit:grant.usage_limit });
      else if (!map.has(grant.key)) map.set(grant.key,{ enabled:true,limit:grant.usage_limit });
      else { const old = map.get(grant.key)!; map.set(grant.key,{ enabled:true,limit:old.limit===null || grant.usage_limit===null ? null : old.limit+grant.usage_limit }); }
    }
    const usage = await db.query<{ key:string; used:string }>('SELECT f.key,COALESCE(SUM(u.quantity),0)::text AS used FROM usage_records u JOIN features f ON f.id=u.feature_id WHERE u.organization_id=$1 AND u.created_at>=date_trunc(\'month\',now()) GROUP BY f.key',[orgId]);
    const used = new Map(usage.rows.map((item)=>[item.key,Number(item.used)]));
    return { status: row.status, packageVersionId:row.package_version_id, features:[...map].map(([key,value])=>({ key,enabled:active && value.enabled,limit:value.limit,used:used.get(key) ?? 0 })).sort((a,b)=>a.key.localeCompare(b.key)) };
  }
  async entitlements(request: AuthRequest, orgId?: string) {
    const target = orgId ?? request.user?.organizationId;
    if (!target) throw new BadRequestException('Select a business organization first');
    await this.identity.requireBusinessRead(request,target);
    try {
      const cached = await redisCommand(['GET',this.key(target)]);
      if (cached) return JSON.parse(cached) as Awaited<ReturnType<CommercialService['resolve']>>;
    } catch { /* Resolve from PostgreSQL when Redis is unavailable. */ }
    const value = await this.resolve(this.db,target);
    if (value.status !== 'TRIAL') {
      try { await redisCommand(['SET',this.key(target),JSON.stringify(value),'EX','60']); } catch { /* Cache is optional. */ }
    }
    return value;
  }
  async recordUsage(request: AuthRequest, input: { featureKey: string; quantity: number; idempotencyKey: string }) {
    const orgId = request.user?.organizationId;
    if (!orgId) throw new BadRequestException('Select a business organization first');
    await this.identity.requireBusinessRead(request,orgId);
    const result = await this.transaction(async (db) => {
      const sub = await db.query('SELECT id FROM subscriptions WHERE organization_id=$1 FOR UPDATE',[orgId]);
      if (!sub.rowCount) throw new ForbiddenException('No active subscription');
      const feature = await db.query('SELECT id FROM features WHERE key=$1',[input.featureKey]);
      if (!feature.rowCount) throw new NotFoundException('Feature not found');
      const prior = await db.query('SELECT id FROM usage_records WHERE organization_id=$1 AND feature_id=$2 AND idempotency_key=$3',[orgId,feature.rows[0].id,input.idempotencyKey]);
      if (prior.rowCount) return { id:prior.rows[0].id,duplicate:true };
      const entitlements = await this.resolve(db,orgId);
      const grant = entitlements.features.find((item)=>item.key===input.featureKey);
      if (!grant?.enabled) throw new ForbiddenException('Feature not entitled');
      if (grant.limit !== null && grant.used+input.quantity>grant.limit) throw new ForbiddenException('Usage limit exceeded');
      const id = randomUUID();
      await db.query('INSERT INTO usage_records(id,organization_id,feature_id,quantity,idempotency_key) VALUES($1,$2,$3,$4,$5)',[id,orgId,feature.rows[0].id,input.quantity,input.idempotencyKey]);
      return { id,duplicate:false };
    });
    if (!result.duplicate) await this.invalidate(orgId);
    return result;
  }
}
