import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class ClientIsolationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const paramClientId = request.params?.clientId;

    if (paramClientId && paramClientId !== user?.clientId) {
      throw new ForbiddenException('Access to this client is not allowed');
    }

    return true;
  }
}