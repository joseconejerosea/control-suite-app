import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';
import * as path from 'path';

import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { Roles } from '../../common/decorators/roles.decorator';
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
  @Roles('admin_cliente', 'super_admin')
  @AuditAction({ action: 'UPLOAD_DOCUMENT', entity: 'DocumentUpload' })
  async upload(@Req() req: AuthedRequest) {
    const data = await (req as any).file();
    if (!data) {
      throw new BadRequestException('No file uploaded.');
    }

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    const fileBuffer = Buffer.concat(chunks);

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

    const target_table = data.fields?.target_table?.value ?? 'promoters';
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
  @Roles('admin_cliente', 'super_admin', 'user')
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
  @Roles('admin_cliente', 'super_admin', 'user')
  findOne(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(req.user.client_id, id);
  }

  @Post(':id/parse')
  @Roles('admin_cliente', 'super_admin')
  parse(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.parse(req.user.client_id, id);
  }

  @Get(':id/preview')
  @Roles('admin_cliente', 'super_admin', 'user')
  preview(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.preview(req.user.client_id, id);
  }

  @Post(':id/populate')
  @Roles('admin_cliente', 'super_admin')
  populate(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PopulateDocumentDto,
  ) {
    return this.service.populate(req.user.client_id, id, dto);
  }

  @Post(':id/reprocess')
  @Roles('admin_cliente', 'super_admin')
  reprocess(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.reprocess(req.user.client_id, id);
  }
}
