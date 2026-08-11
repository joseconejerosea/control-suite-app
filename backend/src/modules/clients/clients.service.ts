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
import { UserRole } from '../../common/enums/user-role.enum';
import { AffiliationCodeService } from './affiliation-code.service';

// Postgres unique_violation — retried when a freshly generated code collides.
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    @InjectRepository(Client)
    private readonly clientRepo: Repository<Client>,
    private readonly codes: AffiliationCodeService,
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

    const saved = await this.saveWithUniqueCode(client);
    this.logger.log(
      `Client created [clientId=${saved.id}, nombre=${saved.nombre}]`,
    );
    return saved;
  }

  /** The agency affiliation code for a client (tenant-scoped read for its Manager). */
  async getAffiliationCode(id: string): Promise<{ affiliation_code: string }> {
    const client = await this.clientRepo.findOneBy({ id });
    if (!client) {
      throw new NotFoundException(`Client ${id} not found`);
    }
    return { affiliation_code: client.affiliation_code };
  }

  /** Rotates the agency affiliation code (credential → must be revocable). */
  async rotateAffiliationCode(id: string): Promise<{ affiliation_code: string }> {
    // TARGETED update of only affiliation_code — a full-entity save would carry the
    // whole (possibly stale) client object and could clobber columns changed
    // concurrently between findOne and save. We only touch the one column here.
    await this.findOne(id); // 404 if the client doesn't exist
    for (let attempt = 0; ; attempt++) {
      const code = this.codes.generate();
      try {
        await this.clientRepo.update(id, { affiliation_code: code });
        return { affiliation_code: code };
      } catch (err: any) {
        if (err?.code === PG_UNIQUE_VIOLATION && attempt < 4) continue;
        throw err;
      }
    }
  }

  /**
   * Saves the client with a fresh affiliation code, retrying on the (astronomically
   * rare) unique collision so a code clash never surfaces as a 500.
   */
  private async saveWithUniqueCode(client: Client): Promise<Client> {
    for (let attempt = 0; ; attempt++) {
      client.affiliation_code = this.codes.generate();
      try {
        return await this.clientRepo.save(client);
      } catch (err: any) {
        if (err?.code === PG_UNIQUE_VIOLATION && attempt < 4) continue;
        throw err;
      }
    }
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
      (u) => u.role === UserRole.MANAGER,
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
