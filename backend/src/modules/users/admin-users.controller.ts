import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './user.entity';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import {
  IsEmail,
  IsString,
  MinLength,
  IsUUID,
  IsOptional,
  IsIn,
  IsBoolean,
} from 'class-validator';

class AdminCreateUserDto {
  @IsUUID()
  client_id!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @IsIn([UserRole.OPERATOR, UserRole.MANAGER, UserRole.SUPERVISOR])
  role!: UserRole;

  @IsOptional()
  @IsString()
  full_name?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

class AdminUpdateUserDto {
  @IsOptional()
  @IsString()
  @IsIn([UserRole.OPERATOR, UserRole.MANAGER, UserRole.SUPERVISOR])
  role?: UserRole;

  @IsOptional()
  @IsString()
  full_name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsEmail()
  email?: string;
}

@Controller('v1/app/admin/users')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
export class AdminUsersController {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * Tenant-scoping helper.
   * Si el caller NO es SUPERADMIN, fuerza que solo opere sobre su propio tenant.
   * - Para queries: devuelve el client_id que debe usarse (siempre el del caller).
   * - Para operaciones sobre un target existente: lanza 403 si el target pertenece
   *   a un tenant distinto al del caller.
   */
  private assertTenantAccess(caller: JwtPayload, targetClientId: string): void {
    if (caller.role !== UserRole.SUPERADMIN && caller.client_id !== targetClientId) {
      throw new ForbiddenException('No tenés acceso a usuarios de otro tenant.');
    }
  }

  @Get()
  async findByClient(
    @CurrentUser() caller: JwtPayload,
    @Query('client_id', ParseUUIDPipe) clientId: string,
  ) {
    // MANAGER solo puede listar usuarios de su propio tenant.
    // SUPERADMIN puede listar cualquier tenant.
    const effectiveClientId =
      caller.role === UserRole.SUPERADMIN ? clientId : caller.client_id;

    if (caller.role !== UserRole.SUPERADMIN && clientId !== caller.client_id) {
      throw new ForbiddenException('No tenés acceso a usuarios de otro tenant.');
    }

    const users = await this.userRepo.find({
      where: { client_id: effectiveClientId },
      order: { created_at: 'DESC' },
      select: [
        'id',
        'client_id',
        'email',
        'role',
        'full_name',
        'phone',
        'is_active',
        'language',
        'created_at',
        'updated_at',
      ],
    });
    return users;
  }

  @Post()
  @AuditAction({ action: 'ADMIN_CREATE_USER', entity: 'User' })
  async create(
    @CurrentUser() caller: JwtPayload,
    @Body() dto: AdminCreateUserDto,
  ) {
    // MANAGER siempre crea en su propio tenant (ignora dto.client_id).
    // SUPERADMIN usa el dto.client_id del request.
    const effectiveClientId =
      caller.role === UserRole.SUPERADMIN ? dto.client_id : caller.client_id;

    const existing = await this.userRepo.findOne({
      where: { client_id: effectiveClientId, email: dto.email },
    });
    if (existing) {
      throw new BadRequestException('Ya existe un usuario con ese email en este cliente');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      client_id: effectiveClientId,
      email: dto.email,
      password: hashedPassword,
      role: dto.role,
      full_name: dto.full_name ?? null,
      phone: dto.phone ?? null,
    });

    const saved = await this.userRepo.save(user);
    const { password: _, ...result } = saved as any;
    return result;
  }

  @Patch(':id')
  @AuditAction({ action: 'ADMIN_UPDATE_USER', entity: 'User' })
  async update(
    @CurrentUser() caller: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateUserDto,
  ) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // Verificar que el target pertenece al mismo tenant del caller.
    this.assertTenantAccess(caller, user.client_id);

    if (dto.role !== undefined) user.role = dto.role;
    if (dto.full_name !== undefined) user.full_name = dto.full_name;
    if (dto.phone !== undefined) user.phone = dto.phone;
    if (dto.is_active !== undefined) user.is_active = dto.is_active;
    if (dto.email !== undefined) user.email = dto.email;

    await this.userRepo.save(user);
    const { password: _, ...result } = user as any;
    return result;
  }

  @Delete(':id')
  @AuditAction({ action: 'ADMIN_DEACTIVATE_USER', entity: 'User' })
  async deactivate(
    @CurrentUser() caller: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // Verificar que el target pertenece al mismo tenant del caller.
    this.assertTenantAccess(caller, user.client_id);

    user.is_active = false;
    await this.userRepo.save(user);
    return { deactivated: true, id };
  }
}
