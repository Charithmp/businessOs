import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { HealthController } from './health.controller';
import { IdentityController } from './identity/identity.controller';
import { IdentityService } from './identity/identity.service';
import { SessionGuard } from './identity/session.guard';
import { APP_GUARD } from '@nestjs/core';
import { CommercialController } from './commercial/commercial.controller';
import { CommercialService } from './commercial/commercial.service';
import { ObservabilityController } from './observability/observability.controller';
import { ObservabilityService } from './observability/observability.service';
import { RequestObservabilityMiddleware } from './observability/request-observability.middleware';
import { WebsitesController } from './websites/websites.controller';
import { WebsitesService } from './websites/websites.service';
import { DomainsController } from './websites/domains.controller';
import { DomainsService } from './websites/domains.service';
import { AiController } from './websites/ai.controller';
import { AiService } from './websites/ai.service';

@Module({ controllers: [HealthController, IdentityController, CommercialController, ObservabilityController, WebsitesController, DomainsController, AiController], providers: [IdentityService, CommercialService, ObservabilityService, WebsitesService, DomainsService, AiService, RequestObservabilityMiddleware, { provide: APP_GUARD, useClass: SessionGuard }] })
export class AppModule implements NestModule {
  configure(consumer:MiddlewareConsumer) { consumer.apply(RequestObservabilityMiddleware).forRoutes('*'); }
}
