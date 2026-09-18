import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { IdentityModule } from './modules/identity/identity.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { DatabaseModule } from './database/database.module';
import { WebsiteModule } from './modules/website/website.module';

@Module({ imports: [DatabaseModule, IdentityModule, CatalogModule, ObservabilityModule, WebsiteModule], controllers: [HealthController] })
export class AppModule {}
