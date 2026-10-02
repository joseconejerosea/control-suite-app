/// <reference types="jest" />
import { DataSource } from 'typeorm';
import { ActivationsService } from './activations.service';
import { UpdateActivationDto } from './dto/activation.dto';

const CLIENT = 'client-1';
const ID = 'act-1';

/**
 * Builds a service whose TenantRepository is backed by a mock TypeORM repo. `findOne`
 * always returns the SAME `record` object (so TenantRepository.update's internal
 * Object.assign + save mutates and persists it); `save` echoes it back.
 */
function makeService(opts: {
  record?: Record<string, unknown>;
  clashRows?: Record<string, unknown>[];
  currentRow?: Record<string, unknown> | null;
} = {}) {
  const { record = {}, clashRows = [], currentRow = null } = opts;
  const saved: Record<string, unknown>[] = [];
  const repo = {
    findOne: jest.fn(async () => record),
    save: jest.fn(async (r: Record<string, unknown>) => {
      saved.push({ ...r });
      return r;
    }),
    create: jest.fn((o: Record<string, unknown>) => o),
    find: jest.fn(),
    remove: jest.fn(),
  };
  // Raw this.dataSource.query: rutea por el SQL. La query del anti-choque (T6) hace
  // LEFT JOIN promoters → devuelve clashRows; la de fallback del update (promotor/fecha
  // actual) → currentRow.
  const queryMock = jest.fn(async (sql: string) => {
    if (String(sql).includes('LEFT JOIN promoters')) return clashRows;
    if (String(sql).includes('SELECT promoter_id, activation_date::text')) {
      return currentRow ? [currentRow] : [];
    }
    return [];
  });
  const ds = {
    getRepository: jest.fn(() => repo),
    query: queryMock,
  } as unknown as DataSource;
  return { svc: new ActivationsService(ds), repo, saved, queryMock };
}

describe('ActivationsService.update — T2 reactivation (estado_f5 reset)', () => {
  it('reopens a CLOSED activation on status=in_progress: estado_f5 → pendiente, cerrada_at → null', async () => {
    const record = { id: ID, status: 'completed', estado_f5: 'cerrada', cerrada_at: new Date() };
    const { svc, saved } = makeService({ record });

    await svc.update(CLIENT, ID, { status: 'in_progress' } as UpdateActivationDto);

    const persisted = saved[saved.length - 1];
    expect(persisted.status).toBe('in_progress');
    expect(persisted.estado_f5).toBe('pendiente');
    expect(persisted.cerrada_at).toBeNull();
  });

  it('reopens a CLOSED activation on status=scheduled too', async () => {
    const record = { id: ID, status: 'completed', estado_f5: 'cerrada', cerrada_at: new Date() };
    const { svc, saved } = makeService({ record });

    await svc.update(CLIENT, ID, { status: 'scheduled' } as UpdateActivationDto);

    const persisted = saved[saved.length - 1];
    expect(persisted.estado_f5).toBe('pendiente');
    expect(persisted.cerrada_at).toBeNull();
  });

  it('does NOT touch estado_f5 when the F5 was NOT closed (preserves en_vivo on a normal edit)', async () => {
    const record = { id: ID, status: 'in_progress', estado_f5: 'en_vivo', cerrada_at: null };
    const { svc, saved } = makeService({ record });

    // Editing while keeping it in progress must not clobber a live F5.
    await svc.update(CLIENT, ID, { status: 'in_progress' } as UpdateActivationDto);

    const persisted = saved[saved.length - 1];
    expect(persisted.estado_f5).toBe('en_vivo');
  });

  it('does NOT reset estado_f5 for a terminal status change (status=completed)', async () => {
    const record = { id: ID, status: 'in_progress', estado_f5: 'en_vivo', cerrada_at: null };
    const { svc, repo, saved } = makeService({ record });

    await svc.update(CLIENT, ID, { status: 'completed' } as UpdateActivationDto);

    // No reactivation lookup beyond TenantRepository.update's own findOne.
    expect(repo.findOne).toHaveBeenCalledTimes(1);
    expect(saved[saved.length - 1].estado_f5).toBe('en_vivo');
  });

  it('does NOT reset estado_f5 on an edit without a status change (e.g. notes only)', async () => {
    const record = { id: ID, status: 'scheduled', estado_f5: 'cerrada', cerrada_at: new Date() };
    const { svc, repo, saved } = makeService({ record });

    await svc.update(CLIENT, ID, { notes: 'nota nueva' } as unknown as UpdateActivationDto);

    // Guard didn't fire (no status in dto): only TenantRepository.update's findOne ran.
    expect(repo.findOne).toHaveBeenCalledTimes(1);
    // estado_f5 stays as-is (a no-status edit is not a reactivation).
    expect(saved[saved.length - 1].estado_f5).toBe('cerrada');
  });
});

describe('ActivationsService — T6 anti-choque de anfitrión', () => {
  const dtoBase = { campaign_id: 'camp-1', activation_date: '2026-08-20' };

  it('create BLOQUEA si el promotor ya está en otra activación esa fecha (mensaje claro)', async () => {
    const { svc, repo } = makeService({ clashRows: [{ dia: '2026-08-20', promotor: 'Ana Pérez' }] });

    await expect(
      svc.create(CLIENT, { ...dtoBase, promoter_id: 'prom-1' } as any),
    ).rejects.toThrow(/Ana Pérez.*2026-08-20/);
    // No creó la activación.
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('create OK cuando no hay choque', async () => {
    const { svc, repo } = makeService({ clashRows: [] });

    await svc.create(CLIENT, { ...dtoBase, promoter_id: 'prom-1' } as any);

    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('create SIN promotor no chequea choque (no corre la query de clash)', async () => {
    const { svc, repo, queryMock } = makeService({});

    await svc.create(CLIENT, { ...dtoBase } as any); // sin promoter_id

    expect(repo.create).toHaveBeenCalledTimes(1);
    const ranClash = queryMock.mock.calls.some(([sql]: [string]) => String(sql).includes('LEFT JOIN promoters'));
    expect(ranClash).toBe(false);
  });

  it('update BLOQUEA al cambiar el promotor a uno que ya está esa fecha', async () => {
    const { svc } = makeService({
      record: { estado_f5: 'pendiente' },
      currentRow: { promoter_id: 'old', dia: '2026-08-20' },
      clashRows: [{ dia: '2026-08-20', promotor: 'Ana Pérez' }],
    });

    await expect(
      svc.update(CLIENT, ID, { promoter_id: 'prom-nuevo' } as UpdateActivationDto),
    ).rejects.toThrow(/Ana Pérez/);
  });

  it('update que NO toca promotor ni fecha no corre el check de choque', async () => {
    const { svc, queryMock } = makeService({ record: { estado_f5: 'pendiente' } });

    await svc.update(CLIENT, ID, { notes: 'algo' } as unknown as UpdateActivationDto);

    const ranClash = queryMock.mock.calls.some(([sql]: [string]) => String(sql).includes('LEFT JOIN promoters'));
    expect(ranClash).toBe(false);
  });
});
