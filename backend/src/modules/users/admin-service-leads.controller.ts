import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { IsEmail, IsString, MinLength, IsUUID, IsOptional } from 'class-validator';

import { User } from './user.entity';
import { Client } from '../clients/client.entity';
import { ServiceLeadTenant } from '../auth/entities/service-lead-tenant.entity';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

class CreateServiceLeadDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  full_name?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

class AssignTenantDto {
  @IsUUID()
  tenantId!: string;
}

/**
 * Provisioning de SERVICE_LEAD — SOLO SUPERADMIN.
 *
 * El SERVICE_LEAD es un usuario PLATFORM-LEVEL (client_id = NULL): no pertenece a
 * ningún tenant fijo, elige la agencia activa al loguear (AuthService.selectTenant).
 * Este controller es el ÚNICO punto de creación de SLs y de asignación de agencias.
 * NO se expone en el CRUD de tenant (AdminUsersController @IsIn excluye SERVICE_LEAD
 * a propósito — anti-escalación de privilegios).
 *
 * `users` está FUERA de RLS (ver migración 040), así que crear/leer filas con
 * client_id NULL no requiere contexto de tenant. `service_lead_tenants` también es
 * cross-tenant sin RLS. El SUPERADMIN, además, típicamente no tiene tenant activo,
 * por lo que el TenantInterceptor no abre contexto para estas requests.
 */
@Controller('v1/app/admin/service-leads')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.SUPERADMIN)
export class AdminServiceLeadsController {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(ServiceLeadTenant)
    private readonly slTenantRepo: Repository<ServiceLeadTenant>,
    @InjectRepository(Client)
    private readonly clientRepo: Repository<Client>,
  ) {}

  private readonly safeSelect = [
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
  ] as const;

  /** Crea un usuario SERVICE_LEAD platform-level (client_id = NULL). */
  @Post()
  @AuditAction({ action: 'ADMIN_CREATE_SERVICE_LEAD', entity: 'User' })
  async create(@Body() dto: CreateServiceLeadDto) {
    // `users` no tiene índice único global sobre email (el único es
    // (client_id, email)); con client_id NULL ese índice no bloquea duplicados,
    // así que validamos email único a nivel app.
    const existing = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new BadRequestException('Ya existe un usuario con ese email');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      client_id: null,
      email: dto.email,
      password: hashedPassword,
      role: UserRole.SERVICE_LEAD,
      full_name: dto.full_name ?? null,
      phone: dto.phone ?? null,
    });

    const saved = await this.userRepo.save(user);
    const { password: _password, ...result } = saved as any;
    return result;
  }

  /** Lista todos los usuarios SERVICE_LEAD (sin password). */
  @Get()
  async findAll() {
    return this.userRepo.find({
      where: { role: UserRole.SERVICE_LEAD },
      order: { created_at: 'DESC' },
      select: [...this.safeSelect],
    });
  }

  /** Lista las agencias asignadas a un SERVICE_LEAD. */
  @Get(':id/tenants')
  async listTenants(@Param('id', ParseUUIDPipe) id: string) {
    await this.assertIsServiceLead(id);

    const rows = await this.slTenantRepo.find({
      where: { user_id: id },
      relations: { tenant: true },
      order: { created_at: 'ASC' },
    });

    return rows.map((row) => ({
      id: row.tenant_id,
      nombre: row.tenant?.nombre ?? null,
    }));
  }

  /** Asigna una agencia (tenant) a un SERVICE_LEAD. Idempotente. */
  @Post(':id/tenants')
  @AuditAction({ action: 'ADMIN_ASSIGN_SERVICE_LEAD_TENANT', entity: 'ServiceLeadTenant' })
  async assignTenant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTenantDto,
  ) {
    await this.assertIsServiceLead(id);

    const client = await this.clientRepo.findOne({ where: { id: dto.tenantId } });
    if (!client) {
      throw new NotFoundException('La agencia (tenant) no existe');
    }

    const existing = await this.slTenantRepo.findOne({
      where: { user_id: id, tenant_id: dto.tenantId },
    });
    if (existing) {
      // Idempotente: la asignación ya existe, no es un error.
      return { id: existing.id, user_id: id, tenant_id: dto.tenantId, alreadyAssigned: true };
    }

    const assignment = this.slTenantRepo.create({
      user_id: id,
      tenant_id: dto.tenantId,
    });
    const saved = await this.slTenantRepo.save(assignment);
    return { id: saved.id, user_id: id, tenant_id: dto.tenantId, alreadyAssigned: false };
  }

  /** Quita la asignación de una agencia a un SERVICE_LEAD. */
  @Delete(':id/tenants/:tenantId')
  @AuditAction({ action: 'ADMIN_UNASSIGN_SERVICE_LEAD_TENANT', entity: 'ServiceLeadTenant' })
  async unassignTenant(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ) {
    await this.assertIsServiceLead(id);

    const result = await this.slTenantRepo.delete({
      user_id: id,
      tenant_id: tenantId,
    });

    return { removed: (result.affected ?? 0) > 0, user_id: id, tenant_id: tenantId };
  }

  /**
   * Valida que el user :id exista y sea SERVICE_LEAD. Evita que se asignen
   * agencias a un usuario de tenant normal (OPERATOR/MANAGER/…), lo que
   * corrompería el modelo de roles.
   */
  private async assertIsServiceLead(id: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    if (user.role !== UserRole.SERVICE_LEAD) {
      throw new BadRequestException('El usuario no es un service lead');
    }
    return user;
  }
}
