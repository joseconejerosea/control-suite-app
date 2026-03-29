// src/modules/users/user.controller.ts
import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { UserService } from './users.service';
import { User } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get(':clientId')
  findAll(@Param('clientId') clientId: number): Promise<User[]> {
    return this.userService.findAll(clientId);
  }

  @Post()
  create(@Body() body: CreateUserDto): Promise<User> {
    return this.userService.create(body);
  }
}