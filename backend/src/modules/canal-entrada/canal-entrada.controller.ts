import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard'; // ── M4
import { CurrentClientId } from '../../common/decorators/current-client.decorator';
import { CanalEntradaService } from './canal-entrada.service';
import {
  CreateCanalEntradaDto,
  UpdateCanalEntradaDto,
} from './dto/canal-entrada.dto';

@Controller('canal-entrada')
@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard) // ── M4: ClientActiveGuard added
export class CanalEntradaController {
  constructor(private readonly canalEntradaService: CanalEntradaService) {}

  @Get()
  findAll(@CurrentClientId() clientId: string) {
    return this.canalEntradaService.findAll(clientId);
  }

  @Get(':id')
  findOne(
    @CurrentClientId() clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.canalEntradaService.findOne(clientId, id);
  }

  @Post()
  create(
    @CurrentClientId() clientId: string,
    @Body() dto: CreateCanalEntradaDto,
  ) {
    return this.canalEntradaService.create(clientId, dto);
  }

  @Patch(':id')
  update(
    @CurrentClientId() clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCanalEntradaDto,
  ) {
    return this.canalEntradaService.update(clientId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentClientId() clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.canalEntradaService.remove(clientId, id);
  }
}