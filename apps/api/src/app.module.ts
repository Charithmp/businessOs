import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { IdentityModule } from './modules/identity/identity.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ObservabilityModule } from './modules/observability/observability.module';

@Module({ imports: [IdentityModule, CatalogModule, ObservabilityModule], controllers: [HealthController] })
export class AppModule {}
