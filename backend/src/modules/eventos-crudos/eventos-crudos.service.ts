import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Between, DataSource, FindManyOptions } from 'typeorm';
import { EventProducer } from '../queue/producers/event.producer';
import { EventoCrudo } from './evento-crudo.entity';
import { QueryEventosCrudosDto } from './dto/evento-crudo.dto';
import { tenantManager } from '../../common/tenant/tenant-context';

@Injectable()
export class EventosCrudosService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly eventProducer: EventProducer,
  ) {}

  async findAll(
    clientId: string,
    query: QueryEventosCrudosDto,
  ): Promise<EventoCrudo[]> {
    const repo = tenantManager(this.dataSource).getRepository(EventoCrudo);

    const where: FindManyOptions<EventoCrudo>['where'] = { client_id: clientId };

    if (query.status) {
      (where as any).status = query.status;
    }

    if (query.source) {
      (where as any).source = query.source;
    }

    if (query.from && query.to) {
      (where as any).created_at = Between(
        new Date(query.from),
        new Date(query.to),
      );
    }

    return repo.find({
      where,
      order: { created_at: 'DESC' },
      take: 200,
    });
  }

  async findOne(clientId: string, id: string): Promise<EventoCrudo> {
    const repo = tenantManager(this.dataSource).getRepository(EventoCrudo);
    const event = await repo.findOne({
      where: { id, client_id: clientId },
    });

    if (!event) {
      throw new NotFoundException(`EventoCrudo with id ${id} not found`);
    }

    return event;
  }

  async retry(clientId: string, id: string): Promise<Record<string, unknown>> {
    const event = await this.findOne(clientId, id);

    if (event.status !== 'error') {
      throw new BadRequestException(
        `Solo se pueden reintentar eventos con estado 'error'. Estado actual: ${event.status}`,
      );
    }

    const repo = tenantManager(this.dataSource).getRepository(EventoCrudo);

    
    // Old code published to queue first — if DB update failed after,
    // the processor would see status 'error' while the job was already running

    // 1. Update DB status first
    await repo.update(
      { id: event.id, client_id: clientId },
      {
        status: 'queued',
        queued_at: new Date(),
        error_message: null,
      },
    );

    // 2. Then publish to queue
    const job = await this.eventProducer.publishProcessEvent(event.id);

    // 3. Update job_id after publish
    await repo.update(
      { id: event.id, client_id: clientId },
      { job_id: String(job.id) },
    );

    return { retried: true, eventId: event.id, jobId: String(job.id), status: 'queued' };
  }
}