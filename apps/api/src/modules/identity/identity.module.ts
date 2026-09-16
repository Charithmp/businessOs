import { Module } from '@nestjs/common';
import { OrganizationScopeGuard, PermissionsGuard } from './security.guards';
@Module({ providers: [OrganizationScopeGuard, PermissionsGuard], exports: [OrganizationScopeGuard, PermissionsGuard] })
export class IdentityModule {}
