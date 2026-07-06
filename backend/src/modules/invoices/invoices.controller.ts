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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';

interface AuthedRequest extends Request {
  user: { id: string; client_id: string; role: string };
}

@Controller('invoices')
@UseGuards(AuthGuard, RolesGuard, ClientActiveGuard)
export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}

  // ─── Existing endpoints ───────────────────────────────────────────────────

  @Post()
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN, UserRole.OPERATOR)
  create(@Req() req: AuthedRequest, @Body() dto: CreateInvoiceDto) {
    return this.service.create(req.user.client_id, dto);
  }

  @Post('extract-image')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN, UserRole.OPERATOR)
  extractImage(
    @Req() req: AuthedRequest,
    @Body() body: { image_base64: string; mime_type: string },
  ) {
    return this.service.extractFromImage(
      req.user.client_id,
      body.image_base64,
      body.mime_type ?? 'image/jpeg',
    );
  }

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN, UserRole.OPERATOR)
  findAll(
    @Req() req: AuthedRequest,
    @Query('category') category?: string,
    @Query('source')   source?: string,
    @Query('status')   status?: string,
    @Query('from')     from?: string,
    @Query('to')       to?: string,
  ) {
    return this.service.findAll(req.user.client_id, { category, source, status, from, to });
  }

  @Get('report')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN, UserRole.OPERATOR)
  getReport(
    @Req() req: AuthedRequest,
    @Query('from')       from?: string,
    @Query('to')         to?: string,
    @Query('project_id') projectId?: string,
  ) {
    return this.service.getReport(req.user.client_id, { from, to, project_id: projectId });
  }

  @Get(':id')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN, UserRole.OPERATOR)
  findOne(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(req.user.client_id, id);
  }

  @Patch(':id')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN)
  update(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.service.update(req.user.client_id, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(req.user.client_id, id);
  }

  // ─── Upload — base64 JSON (Fastify compatible) ────────────────────────────
  @Post('upload')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN, UserRole.OPERATOR)
  @HttpCode(HttpStatus.ACCEPTED)
  async upload(
    @Req() req: AuthedRequest,
    @Body() body: {
      file_base64: string;
      mime_type: string;
      filename: string;
      target?: 'gastos' | 'ventas' | 'costos';
      notes?: string;
    },
  ) {
    const buffer = Buffer.from(body.file_base64, 'base64');
    return this.service.f1IngestManual(
      req.user.client_id,
      req.user.id,
      {
        buffer,
        mimetype: body.mime_type,
        originalname: body.filename,
        size: buffer.length,
      },
      body.target ?? 'gastos',
      body.notes,
    );
  }

  // ─── Eventos endpoints ────────────────────────────────────────────────────

  @Get('eventos/status/:eventoId')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN, UserRole.OPERATOR)
  async eventoStatus(
    @Req() req: AuthedRequest,
    @Param('eventoId', ParseUUIDPipe) eventoId: string,
  ) {
    return this.service.f1GetStatus(eventoId, req.user.client_id);
  }

  @Get('eventos/list')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN)
  async eventosList(@Req() req: AuthedRequest) {
    return this.service.f1ListEventos(req.user.client_id);
  }

  @Post('eventos/:eventoId/reprocess')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  async eventosReprocess(
    @Req() req: AuthedRequest,
    @Param('eventoId', ParseUUIDPipe) eventoId: string,
  ) {
    return this.service.f1Reprocess(eventoId, req.user.client_id, req.user.id);
  }
}