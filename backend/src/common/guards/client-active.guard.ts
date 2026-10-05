import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Client } from '../../modules/clients/client.entity';
import { UserRole } from '../enums/user-role.enum';

@Injectable()
export class ClientActiveGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Super admins bypass the check: operate globally and may have no active
    // tenant selected yet (client_id null), so this MUST run before the
    // "No client context" guard below — otherwise a super_admin with no active
    // tenant eats a 403 on every tenant-scoped endpoint (e.g. notifications poll).
    if (user?.role === UserRole.SUPERADMIN) {
      return true;
    }

    if (!user?.client_id) {
      throw new ForbiddenException('No client context');
    }

    const clientRepo = this.dataSource.getRepository(Client);
    const client = await clientRepo.findOneBy({ id: user.client_id });

    if (!client || client.status !== 'active') {
      throw new ForbiddenException(
        'Your organisation has not completed onboarding. ' +
          'Contact your administrator.',
      );
    }

    return true;
  }
}