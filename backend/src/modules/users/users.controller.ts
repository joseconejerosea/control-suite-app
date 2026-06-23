import { Controller, Get, Post, Body } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { UserService } from './users.service';
import { User } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard'; 
import { CurrentClientId } from '../../common/decorators/current-client.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller('users')
@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  findAll(@CurrentClientId() clientId: string): Promise<User[]> {
    return this.userService.findAll(clientId);
  }

  @Post()
  @AuditAction({ action: 'CREATE_USER', entity: 'User' })
  create(
    @CurrentClientId() clientId: string,
    @Body() dto: CreateUserDto,
  ): Promise<User> {
    // Force client_id from JWT — ignore whatever the body sends
    // Prevents cross-tenant user creation (Client A creating users for Client B)
    return this.userService.create({ ...dto, client_id: clientId });
  }
}