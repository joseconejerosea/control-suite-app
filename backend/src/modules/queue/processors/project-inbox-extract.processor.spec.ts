import { ProjectInboxExtractProcessor } from './project-inbox-extract.processor';

// runWithTenant se limita a ejecutar el callback (sin GUC real en el test).
jest.mock('../../../common/tenant/tenant-context', () => ({
  runWithTenant: (_ds: any, _tenant: string, fn: () => any) => fn(),
}));

describe('ProjectInboxExtractProcessor', () => {
  let ds: { query: jest.Mock };
  let config: { get: jest.Mock };
  let storage: { download: jest.Mock };
  let briefExtractor: { extract: jest.Mock };
  let processor: ProjectInboxExtractProcessor;

  const tenant_id = 'tenant-1';
  const inbox_id = 'inbox-1';

  beforeEach(() => {
    ds = { query: jest.fn() };
    config = { get: jest.fn().mockReturnValue('fake-key') };
    storage = { download: jest.fn() };
    briefExtractor = { extract: jest.fn() };
    processor = new ProjectInboxExtractProcessor(
      ds as any,
      config as any,
      storage as any,
      briefExtractor as any,
    );

    // Respuesta IA por defecto.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              nombre_proyecto: 'Proyecto X',
              fecha_inicio: '2026-01-01',
              fecha_fin: '2026-02-01',
              presupuesto_otorgado: 1000000,
            }),
          },
        ],
      }),
    }) as any;
  });

  afterEach(() => jest.restoreAllMocks());

  it('descarga por storage_path, extrae, llama a la IA y deja el item en READY', async () => {
    const raw = { filename: 'brief.pdf', mime_type: 'application/pdf', storage_path: 'tenant-1/documents/x.pdf', size: 100 };
    ds.query
      // SELECT raw_content, status
      .mockResolvedValueOnce([{ raw_content: raw, status: 'PENDING' }])
      // UPDATE → PROCESSING
      .mockResolvedValueOnce([])
      // UPDATE → READY
      .mockResolvedValueOnce([]);

    storage.download.mockResolvedValue(Buffer.from('%PDF'));
    briefExtractor.extract.mockResolvedValue({ text: 'texto extraido del brief', warnings: [] });

    await processor.process({ data: { tenant_id, inbox_id } } as any);

    expect(storage.download).toHaveBeenCalledWith(raw.storage_path);
    expect(briefExtractor.extract).toHaveBeenCalledWith(
      expect.any(Buffer),
      raw.mime_type,
      raw.filename,
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // La última query debe escribir extracted_data + status READY.
    const lastCall = ds.query.mock.calls[ds.query.mock.calls.length - 1];
    expect(lastCall[0]).toContain("status='READY'");
    const extractedJson = lastCall[1][0];
    expect(extractedJson).toContain('Proyecto X');
  });

  it('cae al path legacy (raw_content sin storage_path) sin descargar del storage', async () => {
    const legacy = { text: 'brief pegado a mano' };
    ds.query
      .mockResolvedValueOnce([{ raw_content: legacy, status: 'PENDING' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await processor.process({ data: { tenant_id, inbox_id } } as any);

    expect(storage.download).not.toHaveBeenCalled();
    expect(briefExtractor.extract).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const lastCall = ds.query.mock.calls[ds.query.mock.calls.length - 1];
    expect(lastCall[0]).toContain("status='READY'");
  });

  it('vuelve a PENDING si algo falla', async () => {
    const raw = { filename: 'brief.pdf', mime_type: 'application/pdf', storage_path: 'p', size: 1 };
    ds.query
      .mockResolvedValueOnce([{ raw_content: raw, status: 'PENDING' }])
      .mockResolvedValueOnce([]) // PROCESSING
      .mockResolvedValueOnce([]); // PENDING (rollback)

    storage.download.mockRejectedValue(new Error('storage down'));

    await expect(processor.process({ data: { tenant_id, inbox_id } } as any)).rejects.toThrow();

    const calls = ds.query.mock.calls.map((c) => c[0]);
    expect(calls.some((q: string) => q.includes("status='PENDING'"))).toBe(true);
  });
});
