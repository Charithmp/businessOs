import { BadRequestException } from '@nestjs/common';
import { importHtml, renderSite, sanitizeImportedHtml, validateTree } from './site-tree';

const tree={pages:[{id:'home',path:'/',title:'Home',components:[{id:'hero',type:'Hero',props:{heading:'Hello <script>',body:'Welcome',buttonText:'Contact',buttonHref:'#contact'}}]}]};

describe('website component tree',()=>{
  it('validates and escapes rendered content',()=>{ const html=renderSite(validateTree(tree)); expect(html).toContain('Hello &lt;script&gt;'); expect(html).not.toContain('<script>'); });
  it('rejects executable URLs and duplicate IDs',()=>{
    expect(()=>validateTree({pages:[{id:'home',path:'/',title:'Home',components:[{id:'x',type:'Button',props:{href:'javascript:alert(1)'}}]}]})).toThrow(BadRequestException);
    expect(()=>validateTree({pages:[{id:'home',path:'/',title:'Home',components:[{id:'x',type:'Text',props:{}},{id:'x',type:'Text',props:{}}]}]})).toThrow(BadRequestException);
  });
  it('sanitizes imported HTML and converts simple content',()=>{
    const result=importHtml('<h1>Welcome</h1><p>Safe</p><script>alert(1)</script><a href="javascript:alert(1)">Click</a>');
    expect(result.mode).toBe('CONVERTED'); expect(result.sanitizedHtml).not.toContain('script'); expect(result.sanitizedHtml).not.toContain('javascript:');
  });
  it('uses a sanitized static fallback for complex markup',()=>{
    const result=importHtml('<ul><li>One</li></ul><iframe src="https://evil.test"></iframe>');
    expect(result.mode).toBe('STATIC_FALLBACK'); expect(renderSite(result.tree)).not.toContain('iframe');
  });
  it('rejects oversized HTML',()=>expect(()=>sanitizeImportedHtml('x'.repeat(200001))).toThrow(BadRequestException));
});
