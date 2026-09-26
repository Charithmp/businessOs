import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthRequest } from '../identity/identity.service';
import { LogFilters, ObservabilityService } from './observability.service';

class LogQueryDto implements LogFilters {
  @IsOptional() @IsUUID() organizationId?:string;
  @IsOptional() @IsString() event?:string;
  @IsOptional() @IsIn(['INFO','WARN','ERROR','LOW','MEDIUM','HIGH']) level?:string;
  @IsOptional() @IsISO8601() from?:string;
  @IsOptional() @IsISO8601() to?:string;
  @IsOptional() @IsISO8601() before?:string;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100) limit?:number;
}
class MetricsQueryDto { @IsOptional() @IsUUID() organizationId?:string; }

@ApiTags('observability')
@Controller('observability')
export class ObservabilityController {
  constructor(private readonly observability:ObservabilityService) {}
  @Get('audit') audit(@Req() request:AuthRequest,@Query() query:LogQueryDto) { return this.observability.search(request,'audit',query); }
  @Get('system') system(@Req() request:AuthRequest,@Query() query:LogQueryDto) { return this.observability.search(request,'system',query); }
  @Get('security') security(@Req() request:AuthRequest,@Query() query:LogQueryDto) { return this.observability.search(request,'security',query); }
  @Get('metrics') metrics(@Req() request:AuthRequest,@Query() query:MetricsQueryDto) { return this.observability.metrics(request,query.organizationId); }
}
