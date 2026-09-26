import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { AuthRequest, IdentityService } from '../identity/identity.service';
import { CommercialService } from '../commercial/commercial.service';
import { checksum, importHtml, renderSite, SiteTree, validateTree } from './site-tree';

@Injectable()
export class WebsitesService {
  private readonly db = new Pool({ connectionString:process.env.DATABASE_URL });
  constructor(private readonly identity:IdentityService,private readonly commercial:CommercialService) {}
  private org(request:AuthRequest) { const id=request.user?.organizationId; if (!id) throw new BadRequestException('Select a business first'); return id; }
  private async editor(request:AuthRequest,feature='website.builder') {
    const orgId=this.org(request); const actor=await this.identity.requireWebsiteEditor(request,orgId);
    if (!await this.commercial.hasFeature(orgId,feature)) throw new ForbiddenException(`${feature} entitlement required`);
    return { orgId,actor };
  }
  private async audit(db:PoolClient,orgId:string,actor:string,action:string,id:string,before?:unknown,after?:unknown) {
    await db.query('INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id,before_state,after_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),orgId,actor,action,'website',id,before??null,after??null]);
  }
  private async tx<T>(fn:(db:PoolClient)=>Promise<T>) { const db=await this.db.connect(); try { await db.query('BEGIN'); const result=await fn(db); await db.query('COMMIT'); return result; } catch(error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); } }
  private async site(request:AuthRequest,id:string,edit=false) {
    const row=(await this.db.query('SELECT * FROM websites WHERE id=$1 AND organization_id=$2',[id,this.org(request)])).rows[0];
    if (!row) throw new NotFoundException('Website not found');
    if (edit) await this.editor(request); else await this.identity.requireBusinessRead(request,row.organization_id);
    return row;
  }
  async templates(request:AuthRequest) { await this.identity.requireBusinessRead(request,this.org(request)); return (await this.db.query('SELECT id,key,name,description,tree FROM website_templates ORDER BY name')).rows; }
  async list(request:AuthRequest) { await this.identity.requireBusinessRead(request,this.org(request)); return (await this.db.query('SELECT id,name,slug,draft_revision,draft_source,published_version_id,created_at,updated_at FROM websites WHERE organization_id=$1 ORDER BY updated_at DESC',[this.org(request)])).rows; }
  async get(request:AuthRequest,id:string) { return this.site(request,id); }
  async create(request:AuthRequest,input:{name:string;slug:string;templateId?:string;tree?:unknown}) {
    const {orgId,actor}=await this.editor(request);
    if (!input.name?.trim() || input.name.length>120 || !/^[a-z0-9-]{3,80}$/.test(input.slug)) throw new BadRequestException('Invalid name or slug');
    let tree:SiteTree;
    if (input.tree) tree=validateTree(input.tree);
    else { const template=(await this.db.query('SELECT tree FROM website_templates WHERE id=$1',[input.templateId??'10000000-0000-4000-8000-000000000001'])).rows[0]; if (!template) throw new NotFoundException('Template not found'); tree=validateTree(template.tree); }
    const id=randomUUID();
    try { await this.tx(async(db)=>{ await db.query('INSERT INTO websites(id,organization_id,slug,name,draft_tree) VALUES($1,$2,$3,$4,$5)',[id,orgId,input.slug,input.name.trim(),tree]); await this.audit(db,orgId,actor,'website.created',id,null,{slug:input.slug,checksum:checksum(tree)}); }); }
    catch(error) { if ((error as {code?:string}).code==='23505') throw new ConflictException('Website slug already exists'); throw error; }
    return this.site(request,id);
  }
  async clone(request:AuthRequest,id:string,input:{name:string;slug:string}) { const source=await this.site(request,id,true); return this.create(request,{...input,tree:source.draft_tree}); }
  async saveDraft(request:AuthRequest,id:string,input:{tree:unknown;expectedRevision:number;source?:string}) {
    const {orgId,actor}=await this.editor(request); const tree=validateTree(input.tree);
    return this.tx(async(db)=>{
      const row=(await db.query('SELECT organization_id,draft_revision,draft_tree FROM websites WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if (!row || row.organization_id!==orgId) throw new NotFoundException('Website not found');
      if (row.draft_revision!==input.expectedRevision) throw new ConflictException('Draft changed; reload before saving');
      const revision=row.draft_revision+1;
      await db.query('UPDATE websites SET draft_tree=$2,draft_revision=$3,draft_source=$4,updated_at=now() WHERE id=$1',[id,tree,revision,input.source??'VISUAL']);
      await this.audit(db,orgId,actor,'website.draft.saved',id,{revision:row.draft_revision,checksum:checksum(row.draft_tree)},{revision,checksum:checksum(tree)});
      return {id,draftRevision:revision,tree};
    });
  }
  async import(request:AuthRequest,id:string,input:{html:string;expectedRevision:number}) {
    await this.site(request,id,true); const result=importHtml(input.html);
    const saved=await this.saveDraft(request,id,{tree:result.tree,expectedRevision:input.expectedRevision,source:'IMPORTED_HTML'});
    return {...saved,mode:result.mode};
  }
  async preview(request:AuthRequest,id:string,path='/') { const row=await this.site(request,id); return renderSite(validateTree(row.draft_tree),path,true); }
  async publish(request:AuthRequest,id:string) {
    const {orgId,actor}=await this.editor(request);
    return this.tx(async(db)=>{
      const row=(await db.query('SELECT * FROM websites WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if (!row || row.organization_id!==orgId) throw new NotFoundException('Website not found');
      const tree=validateTree(row.draft_tree);
      const next=(await db.query('SELECT COALESCE(MAX(version),0)+1 AS version FROM website_versions WHERE website_id=$1',[id])).rows[0].version as number;
      const versionId=randomUUID(); const deploymentId=randomUUID();
      await db.query('INSERT INTO website_versions(id,website_id,version,tree,source,checksum,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[versionId,id,next,tree,row.draft_source,checksum(tree),actor]);
      await db.query('INSERT INTO website_deployments(id,website_id,version_id,action,status,created_by) VALUES($1,$2,$3,$4,$5,$6)',[deploymentId,id,versionId,'PUBLISH','READY',actor]);
      await db.query('UPDATE websites SET published_version_id=$2,updated_at=now() WHERE id=$1',[id,versionId]);
      await this.audit(db,orgId,actor,'website.published',id,{versionId:row.published_version_id},{versionId,version:next});
      return {versionId,version:next,deploymentId,status:'READY'};
    });
  }
  async versions(request:AuthRequest,id:string) { await this.site(request,id); return (await this.db.query('SELECT id,version,source,checksum,created_at FROM website_versions WHERE website_id=$1 ORDER BY version DESC',[id])).rows; }
  async deployments(request:AuthRequest,id:string) { await this.site(request,id); return (await this.db.query('SELECT id,version_id,action,status,created_at FROM website_deployments WHERE website_id=$1 ORDER BY created_at DESC',[id])).rows; }
  async rollback(request:AuthRequest,id:string,versionId:string) {
    const {orgId,actor}=await this.editor(request);
    return this.tx(async(db)=>{
      const row=(await db.query('SELECT organization_id,published_version_id FROM websites WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if (!row || row.organization_id!==orgId) throw new NotFoundException('Website not found');
      const version=(await db.query('SELECT version FROM website_versions WHERE website_id=$1 AND id=$2',[id,versionId])).rows[0];
      if (!version) throw new NotFoundException('Version not found');
      const deploymentId=randomUUID();
      await db.query("INSERT INTO website_deployments(id,website_id,version_id,action,status,created_by) VALUES($1,$2,$3,'ROLLBACK','READY',$4)",[deploymentId,id,versionId,actor]);
      await db.query('UPDATE websites SET published_version_id=$2,updated_at=now() WHERE id=$1',[id,versionId]);
      await this.audit(db,orgId,actor,'website.rolled_back',id,{versionId:row.published_version_id},{versionId});
      return {versionId,version:version.version,deploymentId,status:'READY'};
    });
  }
  async publicBySlug(slug:string,path='/') {
    const row=(await this.db.query('SELECT w.organization_id,v.tree FROM websites w JOIN website_versions v ON v.id=w.published_version_id WHERE w.slug=$1',[slug])).rows[0];
    if (!row || !await this.commercial.hasFeature(row.organization_id,'website.builder')) throw new NotFoundException('Published website not found');
    return renderSite(validateTree(row.tree),path);
  }
  async publicByDomain(host:string,path='/') {
    const hostname=host.toLowerCase().replace(/:\d+$/,'');
    const row=(await this.db.query("SELECT w.organization_id,v.tree FROM website_domains d JOIN websites w ON w.id=d.website_id JOIN website_versions v ON v.id=w.published_version_id WHERE d.hostname=$1 AND d.status='ACTIVE'",[hostname])).rows[0];
    if (!row || !await this.commercial.hasFeature(row.organization_id,'website.builder')) throw new NotFoundException('Active domain not found');
    return renderSite(validateTree(row.tree),path);
  }
}
