import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { AuthRequest } from '../identity/identity.service';
import { AiService } from './ai.service';

@Controller()
export class AiController {
  constructor(private readonly ai:AiService) {}
  @Get('ai/routes') routes(@Req() req:AuthRequest) { return this.ai.routes(req); }
  @Put('ai/routes') setRoute(@Req() req:AuthRequest,@Body() body:Parameters<AiService['setRoute']>[1]) { return this.ai.setRoute(req,body); }
  @Get('ai/settings') settings(@Req() req:AuthRequest) { return this.ai.settings(req); }
  @Put('ai/settings') setSettings(@Req() req:AuthRequest,@Body() body:Parameters<AiService['setSettings']>[1]) { return this.ai.setSettings(req,body); }
  @Put('ai/credentials/:provider') credential(@Req() req:AuthRequest,@Param('provider') provider:'OPENAI'|'ANTHROPIC'|'GEMINI',@Body() body:{secret:string}) { return this.ai.setCredential(req,provider,body.secret); }
  @Get('ai/usage') usage(@Req() req:AuthRequest) { return this.ai.usage(req); }
  @Post('websites/:id/generate') generate(@Req() req:AuthRequest,@Param('id') id:string,@Body() body:Parameters<AiService['generate']>[2]) { return this.ai.generate(req,id,body); }
}
