import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { parseDocument } from 'htmlparser2';
import * as sanitizeHtml from 'sanitize-html';

export type ComponentType = 'Hero'|'Text'|'Image'|'Button'|'StaticHtml';
export type SiteComponent = { id:string; type:ComponentType; props:Record<string,string> };
export type SitePage = { id:string; path:string; title:string; components:SiteComponent[] };
export type SiteTree = { pages:SitePage[] };
const types = new Set<ComponentType>(['Hero','Text','Image','Button','StaticHtml']);
const textKeys:Record<ComponentType,string[]> = {
  Hero:['heading','body','buttonText','buttonHref'],Text:['heading','body'],
  Image:['src','alt'],Button:['text','href'],StaticHtml:['html'],
};
const importTags = ['main','article','section','header','footer','div','span','h1','h2','h3','h4','p','strong','em','b','i','ul','ol','li','blockquote','a','img','br','hr'];

export function sanitizeImportedHtml(html:string):string {
  if (html.length>200_000) throw new BadRequestException('HTML import exceeds 200 KB');
  return sanitizeHtml(html,{ allowedTags:importTags,
    allowedAttributes:{ a:['href','title'],img:['src','alt','width','height'] },
    allowedSchemes:['https'], allowProtocolRelative:false,
    nonTextTags:['script','style','textarea','option','xmp','noscript','iframe','svg','math'],
    disallowedTagsMode:'discard',
  });
}
function validUrl(value:string,kind:'link'|'image') {
  if (value.startsWith('//') || value.startsWith('\\')) return false;
  if (kind==='link' && (value.startsWith('#') || value.startsWith('/'))) return true;
  if (kind==='image' && value.startsWith('/')) return true;
  try { const parsed=new URL(value); return parsed.protocol==='https:'; } catch { return false; }
}
export function validateTree(value:unknown):SiteTree {
  if (!value || typeof value!=='object' || !('pages' in value) || !Array.isArray(value.pages) || value.pages.length<1 || value.pages.length>20) throw new BadRequestException('A site needs 1–20 pages');
  const paths=new Set<string>(); const ids=new Set<string>(); let total=0;
  const pages:SitePage[] = value.pages.map((raw:unknown)=>{
    if (!raw || typeof raw!=='object') throw new BadRequestException('Invalid page');
    const page=raw as Record<string,unknown>;
    if (typeof page.id!=='string' || !/^[a-z0-9-]{1,40}$/.test(page.id) || typeof page.path!=='string' || !/^\/(?:[a-z0-9-]+\/)*[a-z0-9-]*$/.test(page.path) || typeof page.title!=='string' || page.title.length>120 || !Array.isArray(page.components)) throw new BadRequestException('Invalid page fields');
    if (paths.has(page.path) || ids.has(page.id)) throw new BadRequestException('Duplicate page path or ID');
    paths.add(page.path); ids.add(page.id);
    if (page.components.length>100) throw new BadRequestException('Too many components');
    total+=page.components.length;
    const components:SiteComponent[]=page.components.map((entry:unknown)=>{
      if (!entry || typeof entry!=='object') throw new BadRequestException('Invalid component');
      const component=entry as Record<string,unknown>;
      if (typeof component.id!=='string' || !/^[a-zA-Z0-9-]{1,50}$/.test(component.id) || ids.has(component.id) || !types.has(component.type as ComponentType) || !component.props || typeof component.props!=='object' || Array.isArray(component.props)) throw new BadRequestException('Invalid component fields');
      ids.add(component.id); const type=component.type as ComponentType; const input=component.props as Record<string,unknown>;
      if (Object.keys(input).some((key)=>!textKeys[type].includes(key))) throw new BadRequestException('Unsupported component property');
      const props:Record<string,string>={};
      for (const key of textKeys[type]) {
        const val=input[key];
        if (val===undefined) continue;
        if (typeof val!=='string' || val.length>(key==='html'?200_000:2000)) throw new BadRequestException('Invalid component text');
        props[key]=key==='html'?sanitizeImportedHtml(val):val;
      }
      if (props.src && !validUrl(props.src,'image')) throw new BadRequestException('Image URL must be HTTPS or site-relative');
      if (props.href && !validUrl(props.href,'link')) throw new BadRequestException('Link URL must be HTTPS or site-relative');
      if (props.buttonHref && !validUrl(props.buttonHref,'link')) throw new BadRequestException('Button URL must be HTTPS or site-relative');
      return { id:component.id,type,props };
    });
    return { id:page.id,path:page.path,title:page.title,components };
  });
  if (!paths.has('/') || total>300) throw new BadRequestException('A home page and no more than 300 components are required');
  return { pages };
}
export const checksum = (tree:SiteTree) => createHash('sha256').update(JSON.stringify(tree)).digest('hex');
const escape = (value:string) => value.replace(/[&<>"']/g,(char)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]!);
function componentHtml(item:SiteComponent) {
  const p=item.props;
  switch (item.type) {
    case 'Hero': return `<section class="hero" id="${escape(item.id)}"><h1>${escape(p.heading ?? '')}</h1><p>${escape(p.body ?? '')}</p>${p.buttonText && p.buttonHref?`<a class="button" href="${escape(p.buttonHref)}">${escape(p.buttonText)}</a>`:''}</section>`;
    case 'Text': return `<section id="${escape(item.id)}"><h2>${escape(p.heading ?? '')}</h2><p>${escape(p.body ?? '')}</p></section>`;
    case 'Image': return `<figure id="${escape(item.id)}"><img src="${escape(p.src ?? '')}" alt="${escape(p.alt ?? '')}" loading="lazy" /></figure>`;
    case 'Button': return `<p id="${escape(item.id)}"><a class="button" href="${escape(p.href ?? '#')}">${escape(p.text ?? '')}</a></p>`;
    case 'StaticHtml': return `<section id="${escape(item.id)}">${sanitizeImportedHtml(p.html ?? '')}</section>`;
  }
}
export function renderSite(tree:SiteTree,path='/',preview=false):string {
  const page=tree.pages.find((item)=>item.path===path);
  if (!page) throw new BadRequestException('Page not found');
  const nav=tree.pages.map((item)=>`<a href="${escape(item.path)}">${escape(item.title)}</a>`).join('');
  const css=':root{font-family:system-ui,sans-serif;color:#162338;background:#fff}*{box-sizing:border-box}body{margin:0}header,main,footer{max-width:1100px;margin:auto;padding:1.5rem}nav{display:flex;gap:1rem;flex-wrap:wrap}a{color:#1657ac}section{padding:2rem 0;border-bottom:1px solid #e5e7eb}.hero{padding:5rem 0}.hero h1{font-size:clamp(2.4rem,6vw,5rem);line-height:1.05}.hero p{font-size:1.2rem;max-width:38rem}.button{display:inline-block;background:#1657ac;color:white;padding:.8rem 1.2rem;border-radius:.4rem;text-decoration:none}img{max-width:100%;height:auto}p{line-height:1.65}@media(max-width:600px){header,main,footer{padding:1rem}.hero{padding:3rem 0}}';
  const csp="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${escape(page.title)}</title><style>${css}</style></head><body>${preview?'<div style="padding:.5rem;background:#fff3cd;text-align:center">Draft preview</div>':''}<header><nav>${nav}</nav></header><main>${page.components.map(componentHtml).join('')}</main><footer>Powered by Business OS</footer></body></html>`;
}

type ParsedNode = { type:string; name?:string; data?:string; attribs?:Record<string,string>; children?:ParsedNode[] };
function text(node:ParsedNode):string { return node.type==='text' ? (node.data ?? '') : (node.children ?? []).map(text).join(''); }
export function importHtml(html:string):{ tree:SiteTree; mode:'CONVERTED'|'STATIC_FALLBACK'; sanitizedHtml:string } {
  const clean=sanitizeImportedHtml(html);
  const nodes:SiteComponent[]=[]; let complex=false;
  function visit(node:ParsedNode) {
    if (node.type!=='tag') { if (node.children) node.children.forEach(visit); return; }
    const name=node.name ?? '';
    if (['h1','h2','h3'].includes(name)) { nodes.push({id:`import-${nodes.length+1}`,type:'Text',props:{ heading:text(node).trim(),body:'' }}); return; }
    if (name==='p') { nodes.push({id:`import-${nodes.length+1}`,type:'Text',props:{ heading:'',body:text(node).trim() }}); return; }
    if (name==='img' && node.attribs?.src) { nodes.push({id:`import-${nodes.length+1}`,type:'Image',props:{src:node.attribs.src,alt:node.attribs.alt ?? ''}}); return; }
    if (['ul','ol','blockquote'].includes(name)) complex=true;
    (node.children ?? []).forEach(visit);
  }
  (parseDocument(clean).children as ParsedNode[]).forEach(visit);
  const converted = !complex && nodes.length>0 && nodes.length<=30;
  const components = converted?nodes:[{id:'import-static',type:'StaticHtml' as const,props:{html:clean}}];
  return { mode:converted?'CONVERTED':'STATIC_FALLBACK',sanitizedHtml:clean,tree:validateTree({ pages:[{id:'home',path:'/',title:'Home',components}] }) };
}
