import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class ClientIsolationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const paramClientId = request.params?.clientId;
    if (user?.role === 'super_admin') return true;
    if (!paramClientId) return true;
    if (paramClientId !== user?.client_id && paramClientId !== user?.clientId) {
      throw new ForbiddenException('Access to this client is not allowed');
    }
    return true;
  }
}
