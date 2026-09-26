import { Body, Controller, Get, Headers, Param, Post, Req } from '@nestjs/common';
import { AuthRequest } from '../identity/identity.service';
import { Public } from '../identity/session.guard';
import { DomainsService } from './domains.service';

@Controller()
export class DomainsController {
  constructor(private readonly domains:DomainsService) {}
  @Get('websites/:id/domains') list(@Req() req:AuthRequest,@Param('id') id:string) { return this.domains.list(req,id); }
  @Post('websites/:id/domains') create(@Req() req:AuthRequest,@Param('id') id:string,@Body() body:{hostname:string}) { return this.domains.create(req,id,body.hostname); }
  @Post('website-domains/:id/verify') verify(@Req() req:AuthRequest,@Param('id') id:string) { return this.domains.verify(req,id); }
  @Public() @Post('edge/domains/:id/activate') activate(@Param('id') id:string,@Body() body:{certificateRef:string},@Headers('x-edge-secret') secret?:string) { return this.domains.activate(id,body.certificateRef,secret); }
}
