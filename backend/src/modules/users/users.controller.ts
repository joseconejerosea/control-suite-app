import { Controller, Get, Post, Body } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { UserService } from './users.service';
import { User } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard'; 
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';

@Controller('users')
@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard) 
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload): Promise<User[]> {
    return this.userService.findAll(user.clientId);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateUserDto,
  ): Promise<User> {
    // Force client_id from JWT — ignore whatever the body sends
    // Prevents cross-tenant user creation (Client A creating users for Client B)
    return this.userService.create({ ...dto, client_id: user.clientId });
  }
}