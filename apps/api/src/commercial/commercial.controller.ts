import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthRequest } from '../identity/identity.service';
import { CommercialService } from './commercial.service';

class NamedDto { @IsString() @IsNotEmpty() @MaxLength(100) key!: string; @IsString() @IsNotEmpty() name!: string; }
class FeatureDto extends NamedDto { @IsUUID() productId!: string; }
class GrantDto { @IsString() @IsNotEmpty() key!: string; @IsOptional() @IsInt() @Min(0) limit?: number | null; }
class BundleDto extends NamedDto { @IsArray() @ValidateNested({ each:true }) @Type(()=>GrantDto) features!: GrantDto[]; }
class VersionDto { @IsArray() @ValidateNested({ each:true }) @Type(()=>GrantDto) features!: GrantDto[]; }
class SubscriptionDto {
  @IsUUID() organizationId!: string; @IsUUID() packageVersionId!: string;
  @IsIn(['TRIAL','ACTIVE','PAST_DUE','SUSPENDED','CANCELLED','EXPIRED']) status!: string;
  @IsOptional() @IsString() trialEndsAt?: string; @IsOptional() @IsString() reason?: string;
}
class AddOnChangeDto { @IsUUID() addOnId!: string; @IsBoolean() enabled!: boolean; @IsOptional() @IsString() reason?: string; }
class OverrideDto { @IsString() @IsNotEmpty() featureKey!: string; @IsBoolean() enabled!: boolean; @IsOptional() @IsInt() @Min(0) limit?: number | null; @IsOptional() @IsString() reason?: string; }
class UsageDto { @IsString() @IsNotEmpty() featureKey!: string; @IsInt() @Min(1) quantity!: number; @IsString() @IsNotEmpty() idempotencyKey!: string; }

@ApiTags('commercial')
@Controller()
export class CommercialController {
  constructor(private readonly commercial: CommercialService) {}
  @Get('products') products(@Req() request: AuthRequest) { return this.commercial.products(request); }
  @Post('products') product(@Req() request: AuthRequest,@Body() body: NamedDto) { return this.commercial.createProduct(request,body); }
  @Get('features') features(@Req() request: AuthRequest) { return this.commercial.features(request); }
  @Post('features') feature(@Req() request: AuthRequest,@Body() body: FeatureDto) { return this.commercial.createFeature(request,body); }
  @Get('packages') packages(@Req() request: AuthRequest) { return this.commercial.packages(request); }
  @Post('packages') package(@Req() request: AuthRequest,@Body() body: BundleDto) { return this.commercial.createPackage(request,body); }
  @Post('packages/:id/versions') version(@Req() request: AuthRequest,@Param('id') id: string,@Body() body: VersionDto) { return this.commercial.createVersion(request,id,body.features); }
  @Get('add-ons') addOns(@Req() request: AuthRequest) { return this.commercial.addOns(request); }
  @Post('add-ons') addOn(@Req() request: AuthRequest,@Body() body: BundleDto) { return this.commercial.createAddOn(request,body); }
  @Put('subscriptions') subscriptionChange(@Req() request: AuthRequest,@Body() body: SubscriptionDto) { return this.commercial.setSubscription(request,body); }
  @Get('subscriptions/:organizationId') subscription(@Req() request: AuthRequest,@Param('organizationId') organizationId: string) { return this.commercial.subscription(request,organizationId); }
  @Put('subscriptions/:organizationId/add-ons') changeAddOn(@Req() request: AuthRequest,@Param('organizationId') organizationId: string,@Body() body: AddOnChangeDto) { return this.commercial.setAddOn(request,organizationId,body.addOnId,body.enabled,body.reason); }
  @Put('subscriptions/:organizationId/overrides') changeOverride(@Req() request: AuthRequest,@Param('organizationId') organizationId: string,@Body() body: OverrideDto) { return this.commercial.setOverride(request,organizationId,body.featureKey,body.enabled,body.limit ?? null,body.reason); }
  @Get('entitlements/me') entitlements(@Req() request: AuthRequest) { return this.commercial.entitlements(request); }
  @Post('usage') usage(@Req() request: AuthRequest,@Body() body: UsageDto) { return this.commercial.recordUsage(request,body); }
}
