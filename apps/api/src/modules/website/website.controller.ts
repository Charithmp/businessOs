import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsString, Matches, MaxLength } from 'class-validator';
import { OrganizationScopeGuard, PermissionsGuard, RequiredPermissions } from '../identity/security.guards';
import { WebsiteService } from './website.service';
import { AiGatewayService } from './ai-gateway.service';
import { DomainService } from './domain.service';

class CreateWebsiteDto { @IsString() @IsNotEmpty() @MaxLength(100) name!: string; @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug!: string; @IsObject() componentTree!: Record<string, unknown>; }
class CreateVersionDto { @IsObject() componentTree!: Record<string, unknown>; }
class SitePlanDto { @IsString() @IsNotEmpty() @MaxLength(4000) brief!: string; }
class AddDomainDto { @IsString() @Matches(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/) hostname!: string; }

@ApiTags('Websites')
@ApiBearerAuth()
@UseGuards(OrganizationScopeGuard, PermissionsGuard)
@Controller('organizations/:organizationId')
export class WebsiteController {
  constructor(private readonly websites: WebsiteService, private readonly ai: AiGatewayService, private readonly domains: DomainService) {}
  @Post('websites') @RequiredPermissions('website.create')
  create(@Param('organizationId') organizationId: string, @Req() request: { user?: { id?: string } }, @Body() dto: CreateWebsiteDto) { return this.websites.create(organizationId, request.user?.id, dto); }
  @Post('websites/:websiteId/versions') @RequiredPermissions('website.edit')
  createVersion(@Param('organizationId') organizationId: string, @Param('websiteId') websiteId: string, @Req() request: { user?: { id?: string } }, @Body() dto: CreateVersionDto) { return this.websites.createVersion(organizationId, websiteId, request.user?.id, dto.componentTree); }
  @Post('websites/:websiteId/versions/:versionId/publish') @RequiredPermissions('website.publish')
  publish(@Param('organizationId') organizationId: string, @Param('websiteId') websiteId: string, @Param('versionId') versionId: string, @Req() request: { user?: { id?: string } }) { return this.websites.publish(organizationId, websiteId, versionId, request.user?.id); }
  @Post('websites/:websiteId/versions/:versionId/rollback') @RequiredPermissions('website.publish')
  rollback(@Param('organizationId') organizationId: string, @Param('websiteId') websiteId: string, @Param('versionId') versionId: string, @Req() request: { user?: { id?: string } }) { return this.websites.rollback(organizationId, websiteId, versionId, request.user?.id); }
  @Get('websites/:websiteId/published-tree') @RequiredPermissions('website.read')
  publishedTree(@Param('organizationId') organizationId: string, @Param('websiteId') websiteId: string) { return this.websites.getPublishedTree(organizationId, websiteId); }
  @Post('ai/site-plans') @RequiredPermissions('website.ai.generate')
  sitePlan(@Param('organizationId') organizationId: string, @Body() dto: SitePlanDto) { return this.ai.createSitePlan(organizationId, dto.brief); }
  @Post('websites/:websiteId/domains') @RequiredPermissions('website.domain.manage')
  addDomain(@Param('organizationId') organizationId: string, @Param('websiteId') websiteId: string, @Body() dto: AddDomainDto) { return this.domains.add(organizationId, websiteId, dto.hostname); }
  @Get('domains/:domainId/verification') @RequiredPermissions('website.domain.manage')
  verificationInstructions(@Param('organizationId') organizationId: string, @Param('domainId') domainId: string) { return this.domains.verificationInstructions(organizationId, domainId); }
  @Post('domains/:domainId/verify') @RequiredPermissions('website.domain.manage')
  verifyDomain(@Param('organizationId') organizationId: string, @Param('domainId') domainId: string) { return this.domains.verify(organizationId, domainId); }
}
