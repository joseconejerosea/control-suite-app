import 'reflect-metadata';
import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { DocumentIngestionController } from '../src/modules/document-ingestion/document-ingestion.controller';

/**
 * Audit H11 — upload de documentos: tope de tamaño (rechaza truncados),
 * allow-list de MIME y target_table validado contra el enum.
 * Se prueba el método del controller con un `req.file()` falso (sin Fastify).
 */
describe('H11 — document upload limits', () => {
  let registerUpload: jest.Mock;
  let storageUpload: jest.Mock;
  let ctrl: DocumentIngestionController;

  beforeEach(() => {
    registerUpload = jest.fn(async () => ({ id: 'doc-1' }));
    storageUpload = jest.fn(async () => ({ path: 'documents/x.pdf' }));
    ctrl = new DocumentIngestionController(
      { registerUpload } as any,
      { upload: storageUpload } as any,
    );
  });

  /** Stream async de chunks, con flag de truncado opcional. */
  function fileStream(chunks: Buffer[], truncated = false) {
    const gen = (async function* () {
      for (const c of chunks) yield c;
    })();
    (gen as any).truncated = truncated;
    return gen;
  }

  function req(opts: {
    mimetype: string;
    truncated?: boolean;
    target_table?: string;
    filename?: string;
  }) {
    const data = {
      mimetype: opts.mimetype,
      filename: opts.filename ?? 'archivo.pdf',
      file: fileStream([Buffer.from('contenido')], opts.truncated ?? false),
      fields: {
        target_table: { value: opts.target_table ?? 'promoters' },
        project_id: { value: null },
      },
    };
    return {
      file: async () => data,
      user: { client_id: 'client-1', id: 'user-1' },
    } as any;
  }

  it('MIME no permitido → 415', async () => {
    await expect(
      ctrl.upload(req({ mimetype: 'application/x-msdownload' })),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('archivo truncado (supera 10MB) → 413', async () => {
    await expect(
      ctrl.upload(req({ mimetype: 'application/pdf', truncated: true })),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('target_table fuera del enum → 400', async () => {
    await expect(
      ctrl.upload(req({ mimetype: 'application/pdf', target_table: 'users' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('PDF válido con target_table válido → almacena y registra', async () => {
    const res = await ctrl.upload(
      req({ mimetype: 'application/pdf', target_table: 'promoters' }),
    );
    expect(storageUpload).toHaveBeenCalled();
    expect(registerUpload).toHaveBeenCalledWith(
      'client-1',
      expect.objectContaining({ targetTable: 'promoters', mimeType: 'application/pdf' }),
    );
    expect(res).toEqual({ id: 'doc-1' });
  });

  it('acepta imágenes, Excel y Word (allow-list)', async () => {
    for (const mimetype of [
      'image/jpeg',
      'image/png',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword',
    ]) {
      await expect(ctrl.upload(req({ mimetype }))).resolves.toEqual({ id: 'doc-1' });
    }
  });
});
