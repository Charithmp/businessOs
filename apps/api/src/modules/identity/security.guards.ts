import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const RequiredPermissions = (...permissions: string[]) => SetMetadata('permissions', permissions);

/**
 * The authentication layer must attach memberships obtained server-side to request.user.
 * Browser-provided organization ids only select from that verified set.
 */
@Injectable()
export class OrganizationScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const organizationId = request.params.organizationId ?? request.headers['x-organization-id'];
    if (!organizationId) return true;
    const memberships = request.user?.memberships ?? [];
    const allowed = memberships.some((membership: { organizationId: string }) => membership.organizationId === organizationId);
    if (!allowed) throw new ForbiddenException('Organization scope is not authorized');
    request.organizationScope = { organizationId };
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>('permissions', [context.getHandler(), context.getClass()]) ?? [];
    if (!required.length) return true;
    const permissions: string[] = context.switchToHttp().getRequest().user?.permissions ?? [];
    if (!required.every((permission) => permissions.includes(permission))) throw new ForbiddenException('Missing required permission');
    return true;
  }
}
