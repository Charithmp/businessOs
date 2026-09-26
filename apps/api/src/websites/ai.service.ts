import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AuthRequest, IdentityService } from '../identity/identity.service';
import { CommercialService } from '../commercial/commercial.service';
import { SiteTree, validateTree } from './site-tree';

type Provider='OPENAI'|'ANTHROPIC'|'GEMINI'|'MOCK';
type Policy='CHEAP'|'BALANCED'|'PREMIUM'|'FAST';
type Generated={tree:SiteTree;inputTokens:number;outputTokens:number};
const system='Create a polished small-business website. Return JSON only: {"pages":[{"id":"home","path":"/","title":"Home","components":[{"id":"hero","type":"Hero","props":{"heading":"...","body":"...","buttonText":"...","buttonHref":"#contact"}}]}]}. Allowed component types: Hero, Text, Image, Button. Do not return executable code, HTML, CSS, markdown, or secrets. Keep one home page and under 12 components.';
function keyMaterial() { const raw=process.env.AI_ENCRYPTION_KEY; if (!raw || !/^[0-9a-f]{64}$/i.test(raw)) throw new ServiceUnavailableException('AI encryption key is not configured'); return Buffer.from(raw,'hex'); }
function parseTree(raw:string) { const cleaned=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/```$/,''); try { return validateTree(JSON.parse(cleaned)); } catch { throw new BadRequestException('AI provider returned an invalid component tree'); } }
async function providerGenerate(provider:Provider,model:string,prompt:string,key:string):Promise<Generated> {
  if (provider==='MOCK') {
    if (process.env.AI_ENABLE_MOCK!=='true') throw new ForbiddenException('Mock provider disabled');
    return {tree:validateTree({pages:[{id:'home',path:'/',title:'Home',components:[{id:'hero',type:'Hero',props:{heading:prompt.slice(0,80),body:'Welcome to our business',buttonText:'Contact',buttonHref:'#contact'}},{id:'contact',type:'Text',props:{heading:'Contact',body:'Get in touch today.'}}]}]}),inputTokens:30,outputTokens:80};
  }
  const endpoint=provider==='OPENAI'?'https://api.openai.com/v1/responses':provider==='ANTHROPIC'?'https://api.anthropic.com/v1/messages':'https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent';
  const headers:Record<string,string>={'content-type':'application/json'};
  let body:unknown;
  if (provider==='OPENAI') { headers.authorization=`Bearer ${key}`; body={model,input:[{role:'system',content:system},{role:'user',content:prompt}],max_output_tokens:2500,text:{format:{type:'json_object'}}}; }
  else if (provider==='ANTHROPIC') { headers['x-api-key']=key; headers['anthropic-version']='2023-06-01'; body={model,max_tokens:2500,system,messages:[{role:'user',content:prompt}]}; }
  else { headers['x-goog-api-key']=key; body={systemInstruction:{parts:[{text:system}]},contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:2500}}; }
  const started=Date.now();
  const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new ServiceUnavailableException(`AI provider request failed (${response.status})`);
  const data=await response.json() as {
    output?:{content?:{type:string;text:string}[]}[];
    content?:{type:string;text:string}[];
    candidates?:{content?:{parts?:{text?:string}[]}}[];
    usage?:{input_tokens?:number;output_tokens?:number};
    usageMetadata?:{promptTokenCount?:number;candidatesTokenCount?:number};
  };
  let output=''; let inputTokens=0; let outputTokens=0;
  if (provider==='OPENAI') { output=(data.output??[]).flatMap((item)=>item.content??[]).filter((item)=>item.type==='output_text').map((item)=>item.text).join(''); inputTokens=data.usage?.input_tokens??0; outputTokens=data.usage?.output_tokens??0; }
  else if (provider==='ANTHROPIC') { output=(data.content??[]).filter((item)=>item.type==='text').map((item)=>item.text).join(''); inputTokens=data.usage?.input_tokens??0; outputTokens=data.usage?.output_tokens??0; }
  else { output=data.candidates?.[0]?.content?.parts?.map((part)=>part.text??'').join('')??''; inputTokens=data.usageMetadata?.promptTokenCount??0; outputTokens=data.usageMetadata?.candidatesTokenCount??0; }
  void started;
  return {tree:parseTree(output),inputTokens,outputTokens};
}

@Injectable()
export class AiService {
  private readonly db=new Pool({connectionString:process.env.DATABASE_URL});
  constructor(private readonly identity:IdentityService,private readonly commercial:CommercialService) {}
  private async editor(request:AuthRequest) { const orgId=request.user?.organizationId; if (!orgId) throw new BadRequestException('Select a business first'); const actor=await this.identity.requireWebsiteEditor(request,orgId); if (!await this.commercial.hasFeature(orgId,'website.ai')) throw new ForbiddenException('website.ai entitlement required'); return {orgId,actor}; }
  async routes(request:AuthRequest) { await this.identity.requirePlatformOwner(request); return (await this.db.query('SELECT * FROM ai_model_routes ORDER BY policy')).rows; }
  async setRoute(request:AuthRequest,input:{policy:Policy;provider:Provider;model:string;inputCostMicrosPer1k:number;outputCostMicrosPer1k:number;enabled:boolean}) {
    await this.identity.requirePlatformOwner(request);
    if (!['CHEAP','BALANCED','PREMIUM','FAST'].includes(input.policy) || !['OPENAI','ANTHROPIC','GEMINI','MOCK'].includes(input.provider) || !input.model || !Number.isInteger(input.inputCostMicrosPer1k) || input.inputCostMicrosPer1k<0 || !Number.isInteger(input.outputCostMicrosPer1k) || input.outputCostMicrosPer1k<0) throw new BadRequestException('Invalid AI route');
    await this.db.query('INSERT INTO ai_model_routes(policy,provider,model,input_cost_micros_per_1k,output_cost_micros_per_1k,enabled) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(policy) DO UPDATE SET provider=$2,model=$3,input_cost_micros_per_1k=$4,output_cost_micros_per_1k=$5,enabled=$6,updated_at=now()',[input.policy,input.provider,input.model,input.inputCostMicrosPer1k,input.outputCostMicrosPer1k,input.enabled]);
    return {ok:true};
  }
  async settings(request:AuthRequest) { const {orgId}=await this.editor(request); const row=(await this.db.query('SELECT monthly_budget_micros,key_source,default_policy FROM ai_settings WHERE organization_id=$1',[orgId])).rows[0]; return row??{monthly_budget_micros:0,key_source:'PLATFORM_MANAGED',default_policy:'BALANCED'}; }
  async setSettings(request:AuthRequest,input:{monthlyBudgetMicros:number;keySource:'PLATFORM_MANAGED'|'BYO_KEY';defaultPolicy:Policy}) {
    const {orgId}=await this.editor(request);
    const actor=await this.identity.requireCommercialManager(request,orgId);
    if (!Number.isSafeInteger(input.monthlyBudgetMicros) || input.monthlyBudgetMicros<0 || !['PLATFORM_MANAGED','BYO_KEY'].includes(input.keySource) || !['CHEAP','BALANCED','PREMIUM','FAST'].includes(input.defaultPolicy)) throw new BadRequestException('Invalid AI settings');
    await this.db.query('INSERT INTO ai_settings(organization_id,monthly_budget_micros,key_source,default_policy) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id) DO UPDATE SET monthly_budget_micros=$2,key_source=$3,default_policy=$4,updated_at=now()',[orgId,input.monthlyBudgetMicros,input.keySource,input.defaultPolicy]);
    await this.db.query('INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id,after_state) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),orgId,actor,'ai.settings.updated','ai_settings',orgId,{monthlyBudgetMicros:input.monthlyBudgetMicros,keySource:input.keySource,defaultPolicy:input.defaultPolicy}]);
    return {ok:true};
  }
  async setCredential(request:AuthRequest,provider:Exclude<Provider,'MOCK'>,secret:string) {
    const {orgId,actor}=await this.editor(request); if (!['OPENAI','ANTHROPIC','GEMINI'].includes(provider) || !secret || secret.length>4096) throw new BadRequestException('Invalid provider credential');
    const nonce=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',keyMaterial(),nonce); const ciphertext=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]); const tag=cipher.getAuthTag();
    await this.db.query('INSERT INTO ai_credentials(organization_id,provider,ciphertext,nonce,auth_tag) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,provider) DO UPDATE SET ciphertext=$3,nonce=$4,auth_tag=$5,updated_at=now()',[orgId,provider,ciphertext,nonce,tag]);
    await this.db.query('INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),orgId,actor,'ai.credential.updated','ai_credential',orgId]);
    return {ok:true};
  }
  private async credential(orgId:string,provider:Provider,source:string) {
    if (provider==='MOCK') return '';
    if (source==='PLATFORM_MANAGED') { const key=process.env[`AI_${provider}_API_KEY`]; if (!key) throw new ServiceUnavailableException('Platform AI provider key is not configured'); return key; }
    const row=(await this.db.query('SELECT ciphertext,nonce,auth_tag FROM ai_credentials WHERE organization_id=$1 AND provider=$2',[orgId,provider])).rows[0];
    if (!row) throw new ServiceUnavailableException('BYO provider key is not configured');
    const decipher=createDecipheriv('aes-256-gcm',keyMaterial(),row.nonce); decipher.setAuthTag(row.auth_tag); return Buffer.concat([decipher.update(row.ciphertext),decipher.final()]).toString('utf8');
  }
  async usage(request:AuthRequest) { const {orgId}=await this.editor(request); return (await this.db.query("SELECT id,website_id,policy,provider,model,key_source,status,prompt_tokens,completion_tokens,latency_ms,actual_cost_micros,created_at FROM ai_requests WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100",[orgId])).rows; }
  async generate(request:AuthRequest,websiteId:string,input:{prompt:string;policy?:Policy;idempotencyKey:string;expectedRevision:number}) {
    const {orgId,actor}=await this.editor(request);
    if (!input.prompt?.trim() || input.prompt.length>4000 || !input.idempotencyKey || input.idempotencyKey.length>120 || !Number.isInteger(input.expectedRevision)) throw new BadRequestException('Invalid generation request');
    const site=(await this.db.query('SELECT draft_revision FROM websites WHERE id=$1 AND organization_id=$2',[websiteId,orgId])).rows[0]; if (!site) throw new NotFoundException('Website not found');
    const settings=(await this.db.query('SELECT * FROM ai_settings WHERE organization_id=$1',[orgId])).rows[0]; if (!settings) throw new ForbiddenException('AI settings and budget required');
    const policy=input.policy??settings.default_policy; const route=(await this.db.query('SELECT * FROM ai_model_routes WHERE policy=$1 AND enabled=true',[policy])).rows[0]; if (!route) throw new ServiceUnavailableException('AI policy has no enabled route');
    const fingerprint=createHash('sha256').update(JSON.stringify({orgId,websiteId,prompt:input.prompt,policy,revision:input.expectedRevision})).digest('hex');
    const prior=(await this.db.query('SELECT * FROM ai_requests WHERE organization_id=$1 AND idempotency_key=$2',[orgId,input.idempotencyKey])).rows[0];
    if (prior) { if (prior.fingerprint!==fingerprint) throw new ConflictException('Idempotency key reused with different input'); return {requestId:prior.id,status:prior.status,tree:prior.result_tree,actualCostMicros:prior.actual_cost_micros}; }
    if (site.draft_revision!==input.expectedRevision) throw new ConflictException('Draft changed; reload before generation');
    const maximumInputTokens=Buffer.byteLength(input.prompt+system,'utf8')+200;
    const reservation=Math.ceil(maximumInputTokens*route.input_cost_micros_per_1k/1000+2500*route.output_cost_micros_per_1k/1000);
    const db=await this.db.connect(); const id=randomUUID();
    try { await db.query('BEGIN'); await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[orgId]);
      const spent=(await db.query("SELECT COALESCE(SUM(COALESCE(actual_cost_micros,reserved_cost_micros)),0)::bigint AS total FROM ai_requests WHERE organization_id=$1 AND created_at>=date_trunc('month',now()) AND status IN ('PENDING','SUCCEEDED')",[orgId])).rows[0].total;
      if (Number(spent)+reservation>Number(settings.monthly_budget_micros)) throw new ForbiddenException('Monthly AI budget exceeded');
      await db.query("INSERT INTO ai_requests(id,organization_id,website_id,idempotency_key,fingerprint,policy,provider,model,key_source,status,reserved_cost_micros) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',$10)",[id,orgId,websiteId,input.idempotencyKey,fingerprint,policy,route.provider,route.model,settings.key_source,reservation]); await db.query('COMMIT');
    } catch(error) { await db.query('ROLLBACK'); if ((error as {code?:string}).code==='23505') throw new ConflictException('Generation already in progress'); throw error; } finally { db.release(); }
    const started=Date.now();
    try {
      const key=await this.credential(orgId,route.provider,settings.key_source);
      const generated=await providerGenerate(route.provider,route.model,input.prompt,key);
      const actualCost=Math.ceil(generated.inputTokens*route.input_cost_micros_per_1k/1000+generated.outputTokens*route.output_cost_micros_per_1k/1000);
      const writeDb=await this.db.connect();
      try {
        await writeDb.query('BEGIN');
        const write=await writeDb.query("UPDATE websites SET draft_tree=$2,draft_revision=draft_revision+1,draft_source='AI',updated_at=now() WHERE id=$1 AND organization_id=$3 AND draft_revision=$4 RETURNING draft_revision",[websiteId,generated.tree,orgId,input.expectedRevision]);
        if (!write.rowCount) throw new ConflictException('Draft changed during generation; result was not applied');
        await writeDb.query("UPDATE ai_requests SET status='SUCCEEDED',prompt_tokens=$2,completion_tokens=$3,latency_ms=$4,actual_cost_micros=$5,result_tree=$6,completed_at=now() WHERE id=$1",[id,generated.inputTokens,generated.outputTokens,Date.now()-started,actualCost,generated.tree]);
        await writeDb.query('INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id,after_state) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),orgId,actor,'website.ai.generated','website',websiteId,{requestId:id,provider:route.provider,model:route.model,actualCostMicros:actualCost}]);
        await writeDb.query('COMMIT');
        return {requestId:id,status:'SUCCEEDED',tree:generated.tree,draftRevision:write.rows[0].draft_revision,actualCostMicros:actualCost};
      } catch(error) { await writeDb.query('ROLLBACK'); throw error; } finally { writeDb.release(); }
    } catch(error) { await this.db.query("UPDATE ai_requests SET status='FAILED',error_code=$2,latency_ms=$3,completed_at=now() WHERE id=$1",[id,error instanceof ConflictException?'DRAFT_CONFLICT':'PROVIDER_ERROR',Date.now()-started]); throw error; }
  }
}
