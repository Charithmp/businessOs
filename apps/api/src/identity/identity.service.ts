import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomBytes, randomUUID, scryptSync, createHash, timingSafeEqual } from 'node:crypto';
import { Pool, PoolClient } from 'pg';

export type AuthRequest = { headers: { cookie?: string; origin?: string; host?: string }; method: string; user?: { id: string; email: string; sessionId: string; organizationId: string | null } };
const ROLE = { OWNER: '00000000-0000-4000-8000-000000000001', ADMIN: '00000000-0000-4000-8000-000000000002', MEMBER: '00000000-0000-4000-8000-000000000003' } as const;
const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
const hashPassword = (value: string) => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`; };
const verifyPassword = (value: string, stored: string) => { const [salt, hash] = stored.split(':'); if (!salt || !hash) return false; const actual = scryptSync(value, salt, 64); const expected = Buffer.from(hash, 'hex'); return actual.length === expected.length && timingSafeEqual(actual, expected); };

@Injectable()
export class IdentityService {
  private readonly db = new Pool({ connectionString: process.env.DATABASE_URL });

  private async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try { await client.query('BEGIN'); const value = await run(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async register(email: string, password: string) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 12) throw new BadRequestException('Valid email and a password of at least 12 characters are required');
    const id = randomUUID();
    try { await this.db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [id, email.toLowerCase(), hashPassword(password)]); }
    catch (error) { if ((error as { code?: string }).code === '23505') throw new ConflictException('Email already registered'); throw error; }
    return { id, email: email.toLowerCase() };
  }

  async login(email: string, password: string) {
    const result = await this.db.query<{ id: string; email: string; password_hash: string }>('SELECT id,email,password_hash FROM users WHERE email=$1', [email.toLowerCase()]);
    const user = result.rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) throw new UnauthorizedException('Invalid credentials');
    const token = randomBytes(32).toString('base64url');
    const sessionId = randomUUID();
    await this.db.query("INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '7 days')", [sessionId, user.id, hashToken(token)]);
    return { token, user: { id: user.id, email: user.email } };
  }

  async authenticate(request: AuthRequest) {
    if (!['GET','HEAD','OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) throw new ForbiddenException('Invalid origin');
    }
    const token = request.headers.cookie?.split(';').map((item) => item.trim()).find((item) => item.startsWith('bos_session='))?.slice(12);
    if (!token) throw new UnauthorizedException();
    const result = await this.db.query<{ id: string; email: string; session_id: string; organization_id: string | null }>(
      `SELECT u.id,u.email,s.id AS session_id,s.organization_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`, [hashToken(token)]);
    const row = result.rows[0];
    if (!row) throw new UnauthorizedException();
    request.user = { id: row.id, email: row.email, sessionId: row.session_id, organizationId: row.organization_id };
    return request.user;
  }

  async logout(request: AuthRequest) { const user = await this.authenticate(request); await this.db.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [user.sessionId]); return { ok: true }; }
  async refresh(request: AuthRequest) {
    const user = await this.authenticate(request);
    const token = randomBytes(32).toString('base64url');
    await this.transaction(async (client) => {
      const old = await client.query('UPDATE sessions SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING user_id,organization_id', [user.sessionId]);
      if (!old.rows[0]) throw new UnauthorizedException();
      await client.query("INSERT INTO sessions(id,user_id,token_hash,organization_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '7 days')", [randomUUID(),user.id,hashToken(token),old.rows[0].organization_id]);
    });
    return { token, user: { id:user.id,email:user.email,organizationId:user.organizationId } };
  }
  async me(request: AuthRequest) { const user = await this.authenticate(request); return { id: user.id, email: user.email, organizationId: user.organizationId }; }

  private async membership(userId: string, orgId: string) {
    const result = await this.db.query<{ role: string; type: string; parent_id: string | null }>(
      `SELECT r.key AS role,o.type,o.parent_id FROM organization_members m JOIN roles r ON r.id=m.role_id JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=$1 AND m.organization_id=$2 AND o.status='ACTIVE'`, [userId, orgId]);
    return result.rows[0];
  }

  async requirePlatformOwner(request: AuthRequest) {
    const user = request.user ?? await this.authenticate(request);
    const result = await this.db.query("SELECT o.id FROM organizations o JOIN organization_members m ON m.organization_id=o.id JOIN roles r ON r.id=m.role_id WHERE o.type='PLATFORM' AND o.status='ACTIVE' AND m.user_id=$1 AND r.key='OWNER' LIMIT 1",[user.id]);
    if (!result.rows[0]) throw new ForbiddenException('Platform owner role required');
    return { userId:user.id, platformId:result.rows[0].id as string };
  }

  async requireCommercialManager(request: AuthRequest, businessId: string) {
    const user = request.user ?? await this.authenticate(request);
    const target = await this.db.query<{ parent_id: string }>("SELECT parent_id FROM organizations WHERE id=$1 AND type='BUSINESS' AND status='ACTIVE'",[businessId]);
    if (!target.rows[0]) throw new NotFoundException('Business not found');
    const platform = await this.db.query("SELECT 1 FROM organizations o JOIN organization_members m ON m.organization_id=o.id JOIN roles r ON r.id=m.role_id WHERE o.type='PLATFORM' AND o.status='ACTIVE' AND m.user_id=$1 AND r.key='OWNER' LIMIT 1",[user.id]);
    if (!platform.rowCount) {
      const agency = await this.membership(user.id,target.rows[0].parent_id);
      if (!agency || agency.type !== 'AGENCY' || agency.role !== 'OWNER') throw new ForbiddenException('Commercial manager role required');
    }
    return user.id;
  }

  async requireBusinessRead(request: AuthRequest, businessId: string) {
    const user = request.user ?? await this.authenticate(request);
    const target = await this.db.query("SELECT 1 FROM organizations WHERE id=$1 AND type='BUSINESS' AND status='ACTIVE'",[businessId]);
    if (!target.rowCount) throw new NotFoundException('Business not found');
    const platform = await this.db.query("SELECT 1 FROM organizations o JOIN organization_members m ON m.organization_id=o.id JOIN roles r ON r.id=m.role_id WHERE o.type='PLATFORM' AND o.status='ACTIVE' AND m.user_id=$1 AND r.key='OWNER' LIMIT 1",[user.id]);
    if (!platform.rowCount) await this.access(user.id,businessId,'organization.read',false);
    return user.id;
  }

  private async access(userId: string, orgId: string, permission: string, support = true) {
    const direct = await this.membership(userId, orgId);
    if (direct) {
      const found = await this.db.query('SELECT 1 FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.key=$1 AND rp.permission_key=$2', [direct.role, permission]);
      if (found.rowCount) return direct.role;
    }
    const ancestors = await this.db.query<{ id: string; type: string }>(
      `WITH RECURSIVE lineage AS (SELECT id,parent_id,type FROM organizations WHERE id=$1 UNION ALL SELECT p.id,p.parent_id,p.type FROM organizations p JOIN lineage l ON l.parent_id=p.id) SELECT id,type FROM lineage WHERE id<>$1`, [orgId]);
    for (const ancestor of ancestors.rows) {
      const member = await this.membership(userId, ancestor.id);
      if (member && ['OWNER','ADMIN'].includes(member.role) && ancestor.type === 'AGENCY') return member.role;
    }
    if (support) {
      const grant = await this.db.query('SELECT 1 FROM support_access WHERE user_id=$1 AND organization_id=$2 AND expires_at>now() AND revoked_at IS NULL', [userId, orgId]);
      if (grant.rowCount && permission === 'organization.read') return 'SUPPORT';
    }
    throw new ForbiddenException('Organization access denied');
  }

  async list(request: AuthRequest) {
    const user = await this.authenticate(request);
    const result = await this.db.query(
      `WITH RECURSIVE roots AS (SELECT o.id,o.parent_id,o.type,o.name,o.slug,o.status,r.key AS role FROM organizations o JOIN organization_members m ON m.organization_id=o.id JOIN roles r ON r.id=m.role_id WHERE m.user_id=$1), scoped AS (SELECT * FROM roots UNION SELECT c.id,c.parent_id,c.type,c.name,c.slug,c.status,p.role FROM organizations c JOIN scoped p ON c.parent_id=p.id WHERE p.type='AGENCY' AND p.role IN ('OWNER','ADMIN')) SELECT DISTINCT id,parent_id,type,name,slug,status FROM scoped ORDER BY name`, [user.id]);
    return result.rows;
  }

  async get(request: AuthRequest, id: string) {
    const user = await this.authenticate(request);
    await this.access(user.id, id, 'organization.read');
    const result = await this.db.query('SELECT id,parent_id,type,status,name,slug,country,timezone,locale,currency FROM organizations WHERE id=$1', [id]);
    if (!result.rows[0]) throw new NotFoundException();
    return result.rows[0];
  }

  async create(request: AuthRequest, input: { parentId: string; type: 'AGENCY' | 'BUSINESS'; name: string; slug: string }) {
    const user = await this.authenticate(request);
    const parent = await this.db.query<{ type: string }>('SELECT type FROM organizations WHERE id=$1 AND status=$2', [input.parentId, 'ACTIVE']);
    if (!parent.rows[0]) throw new NotFoundException('Parent organization not found');
    if (!(parent.rows[0].type === 'PLATFORM' && input.type === 'AGENCY') && !(parent.rows[0].type === 'AGENCY' && input.type === 'BUSINESS')) throw new BadRequestException('Invalid hierarchy');
    const role = await this.membership(user.id, input.parentId);
    if (!role || role.role !== 'OWNER') throw new ForbiddenException('Parent owner role required');
    const id = randomUUID();
    try {
      await this.transaction(async (client) => {
        await client.query('INSERT INTO organizations(id,parent_id,type,name,slug) VALUES($1,$2,$3,$4,$5)', [id,input.parentId,input.type,input.name,input.slug]);
        await client.query('INSERT INTO organization_members(organization_id,user_id,role_id) VALUES($1,$2,$3)', [id,user.id,ROLE.OWNER]);
        await client.query('INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(),id,user.id,'organization.created','organization',id]);
      });
    } catch (error) { if ((error as { code?: string }).code === '23505') throw new ConflictException('Slug already used'); throw error; }
    return this.get(request,id);
  }

  async addMember(request: AuthRequest, orgId: string, input: { email: string; role: 'OWNER'|'ADMIN'|'MEMBER' }) {
    const user = await this.authenticate(request);
    const actor = await this.membership(user.id, orgId);
    if (!actor || !['OWNER','ADMIN'].includes(actor.role)) throw new ForbiddenException();
    if (input.role !== 'MEMBER' && actor.role !== 'OWNER') throw new ForbiddenException('Only owners can grant elevated roles');
    const target = await this.db.query<{ id: string }>('SELECT id FROM users WHERE email=$1', [input.email.toLowerCase()]);
    if (!target.rows[0]) throw new NotFoundException('User not found');
    const existing = await this.membership(target.rows[0].id,orgId);
    if (existing?.role === 'OWNER' && actor.role !== 'OWNER') throw new ForbiddenException('Only owners can change an owner');
    await this.transaction(async (client) => {
      await client.query('INSERT INTO organization_members(organization_id,user_id,role_id) VALUES($1,$2,$3) ON CONFLICT(organization_id,user_id) DO UPDATE SET role_id=EXCLUDED.role_id', [orgId,target.rows[0].id,ROLE[input.role]]);
      await client.query('INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(),orgId,user.id,'membership.changed','user',target.rows[0].id]);
    });
    return { organizationId: orgId, userId: target.rows[0].id, role: input.role };
  }

  async switchOrganization(request: AuthRequest, orgId: string) {
    const user = await this.authenticate(request);
    await this.access(user.id,orgId,'organization.read');
    await this.db.query('UPDATE sessions SET organization_id=$1 WHERE id=$2', [orgId,user.sessionId]);
    return { organizationId: orgId };
  }

  async grantSupport(request: AuthRequest, orgId: string, reason: string, minutes: number) {
    const user = await this.authenticate(request);
    if (!reason.trim() || minutes < 1 || minutes > 60) throw new BadRequestException('Reason and duration of 1 to 60 minutes are required');
    const platform = await this.db.query("SELECT 1 FROM organizations o JOIN organization_members m ON m.organization_id=o.id JOIN roles r ON r.id=m.role_id WHERE o.type='PLATFORM' AND o.status='ACTIVE' AND m.user_id=$1 AND r.key='OWNER' LIMIT 1", [user.id]);
    if (!platform.rowCount) throw new ForbiddenException();
    const target = await this.db.query('SELECT id FROM organizations WHERE id=$1', [orgId]);
    if (!target.rowCount) throw new NotFoundException();
    const id = randomUUID();
    await this.transaction(async (client) => {
      await client.query("INSERT INTO support_access(id,user_id,organization_id,reason,expires_at) VALUES($1,$2,$3,$4,now()+($5::int * interval '1 minute'))", [id,user.id,orgId,reason,minutes]);
      await client.query('INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7)', [randomUUID(),orgId,user.id,'support_access.granted','support_access',id,reason]);
    });
    return { id, organizationId: orgId, minutes };
  }

  async revokeSupport(request: AuthRequest, id: string) {
    const user = await this.authenticate(request);
    const grant = await this.db.query<{ organization_id: string }>('SELECT organization_id FROM support_access WHERE id=$1 AND user_id=$2', [id,user.id]);
    if (!grant.rows[0]) throw new NotFoundException();
    await this.transaction(async (client) => {
      await client.query('UPDATE support_access SET revoked_at=now() WHERE id=$1', [id]);
      await client.query('INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(),grant.rows[0].organization_id,user.id,'support_access.revoked','support_access',id]);
    });
    return { ok: true };
  }
}
