import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { IdentityController } from './identity/identity.controller';
import { IdentityService } from './identity/identity.service';
import { SessionGuard } from './identity/session.guard';
import { APP_GUARD } from '@nestjs/core';
import { CommercialController } from './commercial/commercial.controller';
import { CommercialService } from './commercial/commercial.service';

@Module({ controllers: [HealthController, IdentityController, CommercialController], providers: [IdentityService, CommercialService, { provide: APP_GUARD, useClass: SessionGuard }] })
export class AppModule {}
