import { Body, Controller, Get, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { AuthRequest } from '../identity/identity.service';
import { Public } from '../identity/session.guard';
import { WebsitesService } from './websites.service';

type HtmlResponse = { setHeader(name:string,value:string):void; send(value:string):void };
function html(response:HtmlResponse,value:string,preview=false) {
  response.setHeader('Content-Type','text/html; charset=utf-8');
  response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Content-Security-Policy',"default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors " + (preview?"'self'":"'none'"));
  response.send(value);
}

@Controller()
export class WebsitesController {
  constructor(private readonly sites:WebsitesService) {}
  @Get('website-templates') templates(@Req() req:AuthRequest) { return this.sites.templates(req); }
  @Get('websites') list(@Req() req:AuthRequest) { return this.sites.list(req); }
  @Post('websites') create(@Req() req:AuthRequest,@Body() body:{name:string;slug:string;templateId?:string}) { return this.sites.create(req,body); }
  @Get('websites/:id') get(@Req() req:AuthRequest,@Param('id') id:string) { return this.sites.get(req,id); }
  @Post('websites/:id/clone') clone(@Req() req:AuthRequest,@Param('id') id:string,@Body() body:{name:string;slug:string}) { return this.sites.clone(req,id,body); }
  @Put('websites/:id/draft') draft(@Req() req:AuthRequest,@Param('id') id:string,@Body() body:{tree:unknown;expectedRevision:number}) { return this.sites.saveDraft(req,id,body); }
  @Post('websites/:id/import-html') import(@Req() req:AuthRequest,@Param('id') id:string,@Body() body:{html:string;expectedRevision:number}) { return this.sites.import(req,id,body); }
  @Get('websites/:id/preview') async preview(@Req() req:AuthRequest,@Param('id') id:string,@Query('path') path:string,@Res() res:HtmlResponse) { html(res,await this.sites.preview(req,id,path||'/'),true); }
  @Post('websites/:id/publish') publish(@Req() req:AuthRequest,@Param('id') id:string) { return this.sites.publish(req,id); }
  @Get('websites/:id/versions') versions(@Req() req:AuthRequest,@Param('id') id:string) { return this.sites.versions(req,id); }
  @Get('websites/:id/deployments') deployments(@Req() req:AuthRequest,@Param('id') id:string) { return this.sites.deployments(req,id); }
  @Post('websites/:id/rollback') rollback(@Req() req:AuthRequest,@Param('id') id:string,@Body() body:{versionId:string}) { return this.sites.rollback(req,id,body.versionId); }
  @Public() @Get('public/sites/:slug') async publicSite(@Param('slug') slug:string,@Query('path') path:string,@Res() res:HtmlResponse) { html(res,await this.sites.publicBySlug(slug,path||'/')); }
  @Public() @Get('public/domain') async publicDomain(@Req() req:AuthRequest,@Query('path') path:string,@Res() res:HtmlResponse) { html(res,await this.sites.publicByDomain(req.headers.host||'',path||'/')); }
}
