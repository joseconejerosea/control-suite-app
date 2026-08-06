import {
  Controller, Get, Put, Post, Param, Body, UseGuards, Req,
  ParseUUIDPipe, BadRequestException, PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { ProjectInboxService } from './project-inbox.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { StorageService } from '../../common/storage/storage.service';
import { FastifyRequest } from 'fastify';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB — coincide con el límite del plugin multipart (main.ts)

// Allow-list de MIME para briefs: documentos con texto (sin imágenes/video).
const ALLOWED_MIME = new Set<string>([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.ms-powerpoint', // .ppt
]);

@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard, RolesGuard)
@Controller('v1/app/project-inbox')
export class ProjectInboxController {
  constructor(
    private readonly svc: ProjectInboxService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN, UserRole.OPERATOR)
  findAll(@CurrentUser() user: JwtPayload) {
    return this.svc.findAll(user.client_id);
  }

  @Get(':id')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN, UserRole.OPERATOR)
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.findOne(user.client_id, id);
  }

  @Post('upload')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  @AuditAction({ action: 'UPLOAD_BRIEF', entity: 'project_inbox' })
  async upload(@CurrentUser() user: JwtPayload, @Req() req: FastifyRequest) {
    const data = await (req as any).file();
    if (!data) throw new BadRequestException('No se subió ningún archivo.');

    // 1) Allow-list de MIME (disponible antes de consumir el stream).
    if (!ALLOWED_MIME.has(data.mimetype)) {
      throw new UnsupportedMediaTypeException(
        `Tipo de archivo no permitido: ${data.mimetype}. Permitidos: PDF, Excel/CSV, Word, PPT.`,
      );
    }

    // 2) Leer el stream con tope de tamaño. El plugin multipart trunca en silencio
    //    al pasar el límite; rechazamos explícitamente en vez de guardar un corte.
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of data.file) chunks.push(chunk);
    } catch {
      throw new PayloadTooLargeException(
        `El archivo supera el límite de ${MAX_FILE_BYTES / (1024 * 1024)} MB.`,
      );
    }
    if (data.file.truncated) {
      throw new PayloadTooLargeException(
        `El archivo supera el límite de ${MAX_FILE_BYTES / (1024 * 1024)} MB.`,
      );
    }
    const buffer = Buffer.concat(chunks);

    const ext = path.extname(data.filename).toLowerCase();
    const fileName = `${randomUUID()}${ext}`;

    const uploaded = await this.storage.upload(
      user.client_id,
      'documents',
      fileName,
      buffer,
      data.mimetype,
    );

    return this.svc.createFromUpload(user.client_id, 'UPLOAD', {
      filename: data.filename,
      mime_type: data.mimetype,
      storage_path: uploaded.path,
      size: buffer.length,
    });
  }

  @Put(':id/approve')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  @AuditAction({ action: 'APPROVE_INBOX', entity: 'project_inbox' })
  approve(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.approve(user.client_id, id, user.sub, body, req.ip);
  }

  @Put(':id/reject')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  @AuditAction({ action: 'REJECT_INBOX', entity: 'project_inbox' })
  reject(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.reject(user.client_id, id, user.sub, reason ?? '', req.ip);
  }
}
