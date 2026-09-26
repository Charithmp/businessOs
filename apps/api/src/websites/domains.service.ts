import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { domainToASCII } from 'node:url';
import { Pool } from 'pg';
import { AuthRequest, IdentityService } from '../identity/identity.service';
import { CommercialService } from '../commercial/commercial.service';

@Injectable()
export class DomainsService {
  private readonly db=new Pool({connectionString:process.env.DATABASE_URL});
  constructor(private readonly identity:IdentityService,private readonly commercial:CommercialService) {}
  private async access(request:AuthRequest,websiteId:string) {
    const orgId=request.user?.organizationId;
    if (!orgId) throw new BadRequestException('Select a business first');
    const site=(await this.db.query('SELECT id FROM websites WHERE id=$1 AND organization_id=$2',[websiteId,orgId])).rows[0];
    if (!site) throw new NotFoundException('Website not found');
    const actor=await this.identity.requireWebsiteEditor(request,orgId);
    if (!await this.commercial.hasFeature(orgId,'website.domains')) throw new ForbiddenException('website.domains entitlement required');
    return {orgId,actor};
  }
  private normalize(host:string) {
    const value=domainToASCII(host.trim().toLowerCase().replace(/\.$/,''));
    if (!value || value.length>253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value) || value.endsWith('.local') || value.endsWith('.internal')) throw new BadRequestException('A valid public hostname is required');
    return value;
  }
  async list(request:AuthRequest,websiteId:string) { await this.access(request,websiteId); return (await this.db.query('SELECT id,hostname,status,verified_at,activated_at,created_at FROM website_domains WHERE website_id=$1 ORDER BY created_at DESC',[websiteId])).rows; }
  async create(request:AuthRequest,websiteId:string,hostname:string) {
    const {orgId,actor}=await this.access(request,websiteId); const host=this.normalize(hostname); const id=randomUUID(); const token=randomBytes(24).toString('hex');
    try {
      await this.db.query("INSERT INTO website_domains(id,website_id,organization_id,hostname,verification_token,status) VALUES($1,$2,$3,$4,$5,'PENDING_VERIFICATION')",[id,websiteId,orgId,host,token]);
    } catch(error) { if ((error as {code?:string}).code==='23505') throw new ConflictException('Domain is already claimed'); throw error; }
    await this.db.query('INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id,after_state) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),orgId,actor,'domain.created','website_domain',id,{hostname:host}]);
    return {id,hostname:host,status:'PENDING_VERIFICATION',txtName:`_businessos-challenge.${host}`,txtValue:token};
  }
  async verify(request:AuthRequest,id:string) {
    const row=(await this.db.query('SELECT * FROM website_domains WHERE id=$1',[id])).rows[0];
    if (!row) throw new NotFoundException('Domain not found');
    const {orgId,actor}=await this.access(request,row.website_id);
    if (row.organization_id!==orgId) throw new NotFoundException('Domain not found');
    const records=await resolveTxt(`_businessos-challenge.${row.hostname}`).catch(()=>[]);
    const expected=Buffer.from(row.verification_token); const matched=records.some((record)=>{ const actual=Buffer.from(record.join('')); return actual.length===expected.length && timingSafeEqual(actual,expected); });
    if (!matched) throw new BadRequestException('DNS TXT verification record not found');
    await this.db.query("UPDATE website_domains SET status='SSL_PENDING',verified_at=now(),updated_at=now() WHERE id=$1",[id]);
    await this.db.query('INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),orgId,actor,'domain.verified','website_domain',id]);
    return {id,status:'SSL_PENDING',next:'Provision a certificate, then activate through the trusted edge callback'};
  }
  async activate(id:string,certificateRef:string,secret:string|undefined) {
    const configured=process.env.DOMAIN_EDGE_SHARED_SECRET;
    const supplied=Buffer.from(secret??''); const expected=Buffer.from(configured??'');
    if (!configured || supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) throw new ForbiddenException('Trusted edge callback required');
    if (!certificateRef || certificateRef.length>256) throw new BadRequestException('Certificate reference required');
    const row=(await this.db.query("UPDATE website_domains SET status='ACTIVE',certificate_ref=$2,activated_at=now(),updated_at=now() WHERE id=$1 AND status='SSL_PENDING' RETURNING organization_id",[id,certificateRef])).rows[0];
    if (!row) throw new ConflictException('Domain is not awaiting SSL activation');
    await this.db.query('INSERT INTO audit_logs(id,organization_id,action,resource_type,resource_id,after_state) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),row.organization_id,'domain.activated','website_domain',id,{certificateRef}]);
    return {id,status:'ACTIVE'};
  }
}
