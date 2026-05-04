import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Controller('clients')
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  /** Create a new client tenant. Sets status='onboarding'. */
  @Post()
  create(@Body() dto: CreateClientDto) {
    return this.clientsService.create(dto);
  }

  /** List all clients (super_admin sees every tenant). */
  @Get()
  findAll() {
    return this.clientsService.findAll();
  }

  /** Get a single client with its users and channels. */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientsService.findOne(id);
  }

  /** Update client fields (nombre, rut, plan, config). */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clientsService.update(id, dto);
  }

  /** Detailed onboarding progress for a specific client. */
  @Get(':id/onboarding-status')
  getOnboardingStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientsService.getOnboardingStatus(id);
  }
}
