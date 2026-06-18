import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard'; // ── M4
import { CurrentClientId } from '../../common/decorators/current-client.decorator';
import { EventosCrudosService } from './eventos-crudos.service';
import { QueryEventosCrudosDto } from './dto/evento-crudo.dto';

@Controller('eventos-crudos')
@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard)
export class EventosCrudosController {
  constructor(private readonly service: EventosCrudosService) {}

  @Get()
  findAll(
    @CurrentClientId() clientId: string,
    @Query() query: QueryEventosCrudosDto,
  ) {
    return this.service.findAll(clientId, query);
  }

  @Get(':id')
  findOne(
    @CurrentClientId() clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(clientId, id);
  }

  /**
   * POST /api/eventos-crudos/:id/retry
   * Re-publishes the event to the queue. Only works for status = 'error'.
   */
  @Post(':id/retry')
  retry(
    @CurrentClientId() clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.retry(clientId, id);
  }
}