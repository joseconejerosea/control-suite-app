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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
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
  findAll(@CurrentUser() user: JwtPayload) {
    return this.canalEntradaService.findAll(user.clientId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.canalEntradaService.findOne(user.clientId, id);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCanalEntradaDto,
  ) {
    return this.canalEntradaService.create(user.clientId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCanalEntradaDto,
  ) {
    return this.canalEntradaService.update(user.clientId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.canalEntradaService.remove(user.clientId, id);
  }
}