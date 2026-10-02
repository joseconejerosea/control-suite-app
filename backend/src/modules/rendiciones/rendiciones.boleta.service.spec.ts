/// <reference types="jest" />
import { RendicionesService } from './rendiciones.service';

/**
 * T10 — Ver la boleta. getBoletaImagen sirve la imagen de una boleta (invoice)
 * de forma HÍBRIDA: intenta bajar los bytes de storage por doc_key y, si no hay
 * (intake que no subió a storage, o storage no configurado), cae al file_base64
 * embebido en eventos_crudos.raw_payload. 404 si no hay ninguna de las dos.
 */
describe('RendicionesService.getBoletaImagen — storage con fallback a base64', () => {
  const clientId = 'c1';
  const invoiceId = 'inv-1';

  function make(row: any, storageDownload: jest.Mock) {
    const query = jest.fn((sql: string) => {
      if (/FROM invoices/i.test(sql)) return Promise.resolve(row ? [row] : []);
      return Promise.resolve([]);
    });
    const ds = { query } as any;
    const svc = new RendicionesService(ds, {} as any, { download: storageDownload } as any);
    return { svc };
  }

  const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

  it('sirve los bytes de storage cuando el doc_key resuelve', async () => {
    const download = jest.fn().mockResolvedValue(PNG);
    const { svc } = make(
      { doc_key: 'k/1', doc_mime_type: 'image/png', raw_payload: { file_base64: 'QUJD' } },
      download,
    );
    const res = await svc.getBoletaImagen(clientId, invoiceId);
    expect(download).toHaveBeenCalledWith('k/1');
    expect(res.mimeType).toBe('image/png');
    expect(res.buffer).toEqual(PNG);
  });

  it('cae a base64 cuando storage falla', async () => {
    const download = jest.fn().mockRejectedValue(new Error('not found'));
    const { svc } = make(
      { doc_key: 'k/1', doc_mime_type: 'image/jpeg', raw_payload: { file_base64: Buffer.from('hola').toString('base64'), mime_type: 'image/jpeg' } },
      download,
    );
    const res = await svc.getBoletaImagen(clientId, invoiceId);
    expect(res.buffer.toString()).toBe('hola');
    expect(res.mimeType).toBe('image/jpeg');
  });

  it('usa base64 directo cuando no hay doc_key (sin llamar a storage)', async () => {
    const download = jest.fn();
    const { svc } = make(
      { doc_key: null, doc_mime_type: null, raw_payload: { file_base64: Buffer.from('x').toString('base64') } },
      download,
    );
    const res = await svc.getBoletaImagen(clientId, invoiceId);
    expect(download).not.toHaveBeenCalled();
    expect(res.buffer.toString()).toBe('x');
  });

  it('404 cuando la invoice o su evento crudo no existen', async () => {
    const { svc } = make(null, jest.fn());
    await expect(svc.getBoletaImagen(clientId, invoiceId)).rejects.toThrow(/no encontrada/i);
  });

  it('404 cuando no hay ni storage ni base64', async () => {
    const download = jest.fn().mockRejectedValue(new Error('miss'));
    const { svc } = make({ doc_key: 'k/1', doc_mime_type: null, raw_payload: {} }, download);
    await expect(svc.getBoletaImagen(clientId, invoiceId)).rejects.toThrow(/imagen/i);
  });
});
