// src/modules/users/users.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserController } from './users.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminServiceLeadsController } from './admin-service-leads.controller';
import { UserService } from './users.service';
import { User } from './user.entity';
import { Client } from '../clients/client.entity';
import { ServiceLeadTenant } from '../auth/entities/service-lead-tenant.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Client, ServiceLeadTenant])],
  controllers: [UserController, AdminUsersController, AdminServiceLeadsController],
  providers: [UserService],
})
export class UsersModule {}
