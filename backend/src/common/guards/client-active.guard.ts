import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Client } from '../../modules/clients/client.entity';

@Injectable()
export class ClientActiveGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.client_id) {
      throw new ForbiddenException('No client context');
    }

    // Super admins bypass the check
    if (user.role === 'super_admin') {
      return true;
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