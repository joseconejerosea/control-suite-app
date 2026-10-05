import { BadRequestException } from '@nestjs/common';
import { IsNull, Repository } from 'typeorm';
import { User } from './user.entity';

/**
 * Un email que ya pertenece a un usuario platform-level (super_admin/service_lead,
 * client_id IS NULL) NO puede reusarse como miembro de una agencia.
 *
 * Sin este guard quedarían dos filas con el mismo email (una platform, una de
 * tenant): el login multi-tenant las trataría como colisión y, si comparten
 * contraseña, dejaría al super_admin sin su acceso global. Los emails
 * platform-level son exclusivos.
 *
 * Fuente única de verdad: lo usan TODAS las puertas de alta de usuarios de
 * tenant (admin-users, onboarding, users.service) para que el agujero no
 * reaparezca por una ruta sin cubrir.
 */
export async function assertEmailNotPlatform(
  userRepo: Repository<User>,
  email: string,
): Promise<void> {
  const platformUser = await userRepo.findOne({
    where: { email, client_id: IsNull() },
  });
  if (platformUser) {
    throw new BadRequestException(
      'Ese email pertenece a un usuario de plataforma y no puede agregarse como miembro de una agencia.',
    );
  }
}
