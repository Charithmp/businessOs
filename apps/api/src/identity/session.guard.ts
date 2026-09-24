import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthRequest, IdentityService } from './identity.service';

export const Public = () => SetMetadata('public',true);

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly identity: IdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest & { url: string }>();
    if (request.url.startsWith('/api/docs') || this.reflector.getAllAndOverride<boolean>('public',[context.getHandler(),context.getClass()])) return true;
    await this.identity.authenticate(request);
    return true;
  }
}
