import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { User } from '../users/user.entity';
import { Client } from '../clients/client.entity';
import { ServiceLeadTenant } from './entities/service-lead-tenant.entity';
import { UserRole } from '../../common/enums/user-role.enum';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(ServiceLeadTenant)
    private readonly serviceLeadTenantRepo: Repository<ServiceLeadTenant>,
    @InjectRepository(Client) private readonly clientRepo: Repository<Client>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.userRepo.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already registered');

    const hashed = await bcrypt.hash(dto.password, 12);
    const user = this.userRepo.create({
      email: dto.email,
      password: hashed,
      client_id: dto.client_id,
    });
    await this.userRepo.save(user);

    return this.generateTokens(user);
  }

  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.generateTokens(user);
  }

  async refreshToken(token: string) {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
      const user = await this.userRepo.findOne({ where: { id: payload.sub } });
      if (!user) throw new UnauthorizedException();
      return this.generateTokens(user);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /**
   * Devuelve las agencias (clients) que un usuario puede operar. El SERVICE_LEAD ve
   * las asignadas vía service_lead_tenants; el SUPERADMIN (intervención global) ve
   * TODAS. Se usa en GET /auth/my-tenants para elegir el tenant activo antes de operar.
   */
  async getAssignedTenants(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    // SUPERADMIN interviene en cualquier agencia → el selector le muestra todas.
    if (user.role === UserRole.SUPERADMIN) {
      const clients = await this.clientRepo.find({ order: { nombre: 'ASC' } });
      return clients.map((c) => ({ id: c.id, nombre: c.nombre ?? null }));
    }

    const rows = await this.serviceLeadTenantRepo.find({
      where: { user_id: userId },
      relations: { tenant: true },
      order: { created_at: 'ASC' },
    });

    return rows.map((row) => ({
      id: row.tenant_id,
      nombre: row.tenant?.nombre ?? null,
    }));
  }

  /**
   * Elige la agencia activa. El SERVICE_LEAD sólo puede elegir una agencia asignada
   * (service_lead_tenants). El SUPERADMIN (intervención global) puede elegir CUALQUIER
   * agencia existente. Si OK re-emite el JWT con client_id = tenantId y el marcador
   * activeTenantId (Diseño B) — así el audit registra el tenant intervenido.
   */
  async selectTenant(userId: string, tenantId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    // SUPERADMIN: intervención global — puede entrar a cualquier agencia existente.
    if (user.role === UserRole.SUPERADMIN) {
      const tenant = await this.clientRepo.findOne({ where: { id: tenantId } });
      if (!tenant) throw new ForbiddenException('La agencia no existe');
      return this.generateTokens(user, tenantId);
    }

    if (user.role !== UserRole.SERVICE_LEAD) {
      throw new ForbiddenException(
        'Sólo un service lead o el superadmin pueden seleccionar agencia',
      );
    }

    const assignment = await this.serviceLeadTenantRepo.findOne({
      where: { user_id: userId, tenant_id: tenantId },
    });
    if (!assignment) {
      throw new ForbiddenException('No estás asignado a esa agencia');
    }

    return this.generateTokens(user, tenantId);
  }

  private generateTokens(user: User, activeTenantId?: string) {
    const payload = {
      sub: user.id,
      email: user.email,
      client_id: activeTenantId ?? user.client_id,
      role: user.role,
      ...(activeTenantId ? { activeTenantId } : {}),
    };

    const accessToken = this.jwtService.sign(payload);

    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');

    const refreshToken = this.jwtService.sign(
      { sub: user.id },
      {
        secret: refreshSecret,
        expiresIn: 60 * 60 * 24 * 7,
      },
    );

    return { accessToken, refreshToken };
  }
}