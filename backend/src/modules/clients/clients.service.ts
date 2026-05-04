import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from './client.entity';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    @InjectRepository(Client)
    private readonly clientRepo: Repository<Client>,
  ) {}

  // ── CRUD ───────────────────────────────────────────────────────────────────

  async create(dto: CreateClientDto): Promise<Client> {
    const client = this.clientRepo.create({
      nombre: dto.nombre,
      rut: dto.rut ?? null,
      plan: dto.plan ?? 'basic',
      config: dto.config ?? null,
      status: 'onboarding',
      onboarding_step: 'client_created',
    });

    const saved = await this.clientRepo.save(client);
    this.logger.log(
      `Client created [clientId=${saved.id}, nombre=${saved.nombre}]`,
    );
    return saved;
  }

  async findAll(): Promise<Client[]> {
    return this.clientRepo.find({ order: { created_at: 'DESC' } });
  }

  async findOne(id: string): Promise<Client> {
    const client = await this.clientRepo.findOne({
      where: { id },
      relations: ['users', 'canales'],
    });
    if (!client) {
      throw new NotFoundException(`Client ${id} not found`);
    }
    return client;
  }

  async update(id: string, dto: UpdateClientDto): Promise<Client> {
    const client = await this.findOne(id);
    Object.assign(client, dto);
    return this.clientRepo.save(client);
  }

  // ── Onboarding status ──────────────────────────────────────────────────────

  async getOnboardingStatus(id: string): Promise<Record<string, unknown>> {
    const client = await this.clientRepo.findOne({
      where: { id },
      relations: ['users', 'canales'],
    });
    if (!client) {
      throw new NotFoundException(`Client ${id} not found`);
    }

    const STEPS = [
      'client_created',
      'channel_configured',
      'channel_verified',
      'admin_created',
      'completed',
    ];

    const currentIdx = STEPS.indexOf(client.onboarding_step);

    const activeChannels = (client.canales ?? []).filter((c) => c.is_active);
    const adminUsers = (client.users ?? []).filter(
      (u) => u.role === 'admin_cliente',
    );

    return {
      client_id: client.id,
      status: client.status,
      onboarding_step: client.onboarding_step,
      onboarding_completed_at: client.onboarding_completed_at,
      steps: {
        client_created: {
          completed: currentIdx >= 0,
          completed_at: client.created_at,
        },
        channel_configured: {
          completed: currentIdx >= 1,
          channel_count: (client.canales ?? []).length,
        },
        channel_verified: {
          completed: currentIdx >= 2,
          active_channel_count: activeChannels.length,
        },
        admin_created: {
          completed: currentIdx >= 3,
          admin_count: adminUsers.length,
        },
        completed: {
          completed: client.onboarding_step === 'completed',
          completed_at: client.onboarding_completed_at,
        },
      },
    };
  }
}
