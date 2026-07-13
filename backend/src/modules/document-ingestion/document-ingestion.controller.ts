import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  UnsupportedMediaTypeException,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { TargetTable } from './document-upload.entity';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB — debe coincidir con el límite del plugin multipart (main.ts)

// Allow-list de MIME aceptados en el upload de documentos estructurados.
// Alineado con lo que parse() del service ya interpreta (PDF, imágenes,
// Excel/CSV, Word, PPT y video), según el brief §F4.
const ALLOWED_MIME = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.ms-powerpoint', // .ppt
  'video/mp4',        // .mp4
  'video/quicktime',  // .mov
  'video/x-msvideo',  // .avi
]);

const ALLOWED_TARGET_TABLES: ReadonlySet<TargetTable> = new Set<TargetTable>([
  'promoters',
  'locations',
  'campaigns',
  'activations',
  'collaborators',
]);

import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { StorageService } from '../../common/storage/storage.service';
import { DocumentIngestionService } from './document-ingestion.service';
import { PopulateDocumentDto } from './dto/populate-document.dto';

interface AuthedRequest extends Request {
  user: { id: string; client_id: string; role: string };
}

@Controller('documents')
@UseGuards(AuthGuard, RolesGuard, ClientActiveGuard)
export class DocumentIngestionController {
  constructor(
    private readonly service: DocumentIngestionService,
    private readonly storage: StorageService,
  ) {}

  @Post('upload')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  @AuditAction({ action: 'UPLOAD_DOCUMENT', entity: 'DocumentUpload' })
  async upload(@Req() req: AuthedRequest) {
    const data = await (req as any).file();
    if (!data) {
      throw new BadRequestException('No file uploaded.');
    }

    // 1) MIME allow-list (disponible antes de consumir el stream)
    if (!ALLOWED_MIME.has(data.mimetype)) {
      throw new UnsupportedMediaTypeException(
        `Tipo de archivo no permitido: ${data.mimetype}. Permitidos: PDF, imagen (JPG/PNG), Excel/CSV, Word, PPT, video (MP4/MOV/AVI).`,
      );
    }

    // 2) Leer el stream con tope de tamaño. El plugin multipart trunca en
    //    silencio al pasar el límite; rechazamos explícitamente en vez de
    //    almacenar un archivo cortado.
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
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
    const fileBuffer = Buffer.concat(chunks);

    // 3) target_table validado contra el enum (viene del multipart sin tipar)
    const target_table = data.fields?.target_table?.value ?? 'promoters';
    if (!ALLOWED_TARGET_TABLES.has(target_table as TargetTable)) {
      throw new BadRequestException(
        `target_table inválido: ${target_table}. Permitidos: ${[...ALLOWED_TARGET_TABLES].join(', ')}.`,
      );
    }

    const ext = path.extname(data.filename).toLowerCase();
    const fileName = `${randomUUID()}${ext}`;

    const user = (req as any).user ?? (req as any).jwtPayload;
    const clientId = user?.client_id;

    const uploaded = await this.storage.upload(
      clientId,
      'documents',
      fileName,
      fileBuffer,
      data.mimetype,
    );

    const project_id = data.fields?.project_id?.value ?? null;

    return this.service.registerUpload(clientId, {
      originalName: data.filename,
      mimeType: data.mimetype,
      fileSize: fileBuffer.length,
      storagePath: uploaded.path,
      targetTable: target_table,
      projectId: project_id,
      uploadedBy: user?.id ?? user?.sub ?? 'system',
    });
  }

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN, UserRole.OPERATOR)
  findAll(
    @Req() req: AuthedRequest,
    @Query('status') status?: string,
    @Query('project_id') projectId?: string,
  ) {
    return this.service.findAll(req.user.client_id, {
      status,
      project_id: projectId,
    });
  }

  @Get(':id')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN, UserRole.OPERATOR)
  findOne(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(req.user.client_id, id);
  }

  @Post(':id/parse')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  parse(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.parse(req.user.client_id, id);
  }

  @Get(':id/preview')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN, UserRole.OPERATOR)
  preview(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.preview(req.user.client_id, id);
  }

  @Post(':id/populate')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  populate(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PopulateDocumentDto,
  ) {
    return this.service.populate(req.user.client_id, id, dto);
  }

  @Post(':id/reprocess')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  @AuditAction({ action: 'REPROCESS_DOCUMENT', entity: 'Document' })
  reprocess(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.reprocess(req.user.client_id, id);
  }
}
