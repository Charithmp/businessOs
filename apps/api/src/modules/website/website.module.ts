import { Module } from '@nestjs/common';
import { WebsiteController } from './website.controller';
import { WebsiteService } from './website.service';
import { AiGatewayService } from './ai-gateway.service';
import { DomainService, ManualDnsVerificationProvider } from './domain.service';

@Module({ controllers: [WebsiteController], providers: [WebsiteService, AiGatewayService, DomainService, ManualDnsVerificationProvider] })
export class WebsiteModule {}
