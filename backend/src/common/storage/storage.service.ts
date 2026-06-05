import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'control-suite';

export interface UploadResult {
  path: string;
  fullPath: string;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private supabase: SupabaseClient;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('SUPABASE_URL');
    const key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!url || !key) {
      this.logger.warn('Supabase Storage not configured — uploads will fail');
      return;
    }

    this.supabase = createClient(url, key);
    this.logger.log('Supabase Storage initialized');
  }

  private buildPath(tenantId: string, folder: string, fileName: string): string {
    return `${tenantId}/${folder}/${fileName}`;
  }

  async upload(
    tenantId: string,
    folder: 'documents' | 'photos' | 'reports' | 'evidence',
    fileName: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<UploadResult> {
    const path = this.buildPath(tenantId, folder, fileName);

    const { data, error } = await this.supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (error) {
      this.logger.error(`Upload failed [${path}]: ${error.message}`);
      throw new Error(`Storage upload failed: ${error.message}`);
    }

    return { path: data.path, fullPath: data.fullPath };
  }

  async getSignedUrl(path: string, expiresInSeconds = 3600): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, expiresInSeconds);

    if (error) {
      this.logger.error(`Signed URL failed [${path}]: ${error.message}`);
      throw new Error(`Signed URL failed: ${error.message}`);
    }

    return data.signedUrl;
  }

  async download(path: string): Promise<Buffer> {
    const { data, error } = await this.supabase.storage
      .from(BUCKET)
      .download(path);

    if (error) {
      this.logger.error(`Download failed [${path}]: ${error.message}`);
      throw new Error(`Storage download failed: ${error.message}`);
    }

    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async remove(path: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from(BUCKET)
      .remove([path]);

    if (error) {
      this.logger.error(`Remove failed [${path}]: ${error.message}`);
    }
  }
}
