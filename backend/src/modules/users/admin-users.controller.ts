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
  @IsIn([UserRole.OPERATOR, UserRole.MANAGER])
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
  @IsIn([UserRole.OPERATOR, UserRole.MANAGER])
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
@Roles(UserRole.SUPERADMIN)
export class AdminUsersController {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  @Get()
  async findByClient(@Query('client_id', ParseUUIDPipe) clientId: string) {
    const users = await this.userRepo.find({
      where: { client_id: clientId },
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
  async create(@Body() dto: AdminCreateUserDto) {
    const existing = await this.userRepo.findOne({
      where: { client_id: dto.client_id, email: dto.email },
    });
    if (existing) {
      throw new BadRequestException('Ya existe un usuario con ese email en este cliente');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      client_id: dto.client_id,
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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateUserDto,
  ) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

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
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    user.is_active = false;
    await this.userRepo.save(user);
    return { deactivated: true, id };
  }
}
