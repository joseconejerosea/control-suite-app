import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { StorageService } from '../../common/storage/storage.service';

const META_API = 'https://graph.facebook.com/v19.0';

export interface MediaDownloadResult {
  buffer: Buffer;
  mimeType: string;
  storagePath: string;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

type StorageFolder = 'documents' | 'photos' | 'reports' | 'evidence';

@Injectable()
export class WhatsAppMediaService {
  private readonly logger = new Logger(WhatsAppMediaService.name);
  private readonly token: string;

  constructor(
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {
    this.token = this.config.get('META_SYSTEM_USER_TOKEN')
      ?? this.config.get('WHATSAPP_ACCESS_TOKEN')
      ?? '';
  }

  /**
   * Downloads the media bytes from Meta WITHOUT persisting to storage. Used to
   * pre-capture media at tenant-selection buffer time (the tenant/clientId is not
   * yet known) so the resume path never re-fetches from Meta — Meta media ids
   * expire and would 404 by the time the sender answers "which agency?".
   */
  async download(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const mediaRes = await fetch(`${META_API}/${mediaId}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    const mediaData = await mediaRes.json() as { url?: string; mime_type?: string };

    const url = mediaData?.url;
    const mimeType = mediaData?.mime_type ?? 'application/octet-stream';

    if (!url) {
      throw new Error(`No URL returned from Meta media API for id=${mediaId}`);
    }

    const fileRes = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    const arrayBuffer = await fileRes.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), mimeType };
  }

  async downloadAndStore(
    mediaId: string,
    tenantId: string,
    folder: StorageFolder,
  ): Promise<MediaDownloadResult> {
    const { buffer, mimeType } = await this.download(mediaId);
    return this.storeBuffer(buffer, mimeType, tenantId, folder);
  }

  /**
   * Persists an already-downloaded buffer to a tenant's storage. Used on the
   * tenant-selection resume path: media was pre-captured (via `download`) at buffer
   * time before the tenant was known, and is now stored under the chosen tenant.
   */
  async storeBuffer(
    buffer: Buffer,
    mimeType: string,
    tenantId: string,
    folder: StorageFolder,
  ): Promise<MediaDownloadResult> {
    const ext = MIME_TO_EXT[mimeType] ?? '';
    const fileName = `${randomUUID()}${ext}`;

    const uploaded = await this.storage.upload(
      tenantId,
      folder,
      fileName,
      buffer,
      mimeType,
    );

    this.logger.log(
      `[WhatsAppMedia] Stored ${folder}/${fileName} (${(buffer.length / 1024).toFixed(1)}KB)`,
    );

    return { buffer, mimeType, storagePath: uploaded.path };
  }
}
