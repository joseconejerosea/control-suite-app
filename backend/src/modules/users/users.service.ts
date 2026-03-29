import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // ✅ Client-isolated query
  async findAll(clientId: number): Promise<User[]> {
    return this.userRepo.find({
      where: { client_id: clientId },
    });
  }

  // ✅ Secure creation
  async create(dto: CreateUserDto): Promise<User> {
    // Extra safety (optional but strong)
    if (!dto.client_id) {
      throw new ForbiddenException('client_id is required');
    }

    const user = this.userRepo.create({
      username: dto.username,
      email: dto.email,
      password: dto.password,
      client_id: dto.client_id,
    });

    return this.userRepo.save(user);
  }
}