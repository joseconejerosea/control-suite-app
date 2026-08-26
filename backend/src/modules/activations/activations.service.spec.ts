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
function makeService(record: Record<string, unknown>) {
  const saved: Record<string, unknown>[] = [];
  const repo = {
    findOne: jest.fn(async () => record),
    save: jest.fn(async (r: Record<string, unknown>) => {
      saved.push({ ...r });
      return r;
    }),
    create: jest.fn(),
    find: jest.fn(),
    remove: jest.fn(),
  };
  const ds = {
    getRepository: jest.fn(() => repo),
  } as unknown as DataSource;
  return { svc: new ActivationsService(ds), repo, saved };
}

describe('ActivationsService.update — T2 reactivation (estado_f5 reset)', () => {
  it('reopens a CLOSED activation on status=in_progress: estado_f5 → pendiente, cerrada_at → null', async () => {
    const record = { id: ID, status: 'completed', estado_f5: 'cerrada', cerrada_at: new Date() };
    const { svc, saved } = makeService(record);

    await svc.update(CLIENT, ID, { status: 'in_progress' } as UpdateActivationDto);

    const persisted = saved[saved.length - 1];
    expect(persisted.status).toBe('in_progress');
    expect(persisted.estado_f5).toBe('pendiente');
    expect(persisted.cerrada_at).toBeNull();
  });

  it('reopens a CLOSED activation on status=scheduled too', async () => {
    const record = { id: ID, status: 'completed', estado_f5: 'cerrada', cerrada_at: new Date() };
    const { svc, saved } = makeService(record);

    await svc.update(CLIENT, ID, { status: 'scheduled' } as UpdateActivationDto);

    const persisted = saved[saved.length - 1];
    expect(persisted.estado_f5).toBe('pendiente');
    expect(persisted.cerrada_at).toBeNull();
  });

  it('does NOT touch estado_f5 when the F5 was NOT closed (preserves en_vivo on a normal edit)', async () => {
    const record = { id: ID, status: 'in_progress', estado_f5: 'en_vivo', cerrada_at: null };
    const { svc, saved } = makeService(record);

    // Editing while keeping it in progress must not clobber a live F5.
    await svc.update(CLIENT, ID, { status: 'in_progress' } as UpdateActivationDto);

    const persisted = saved[saved.length - 1];
    expect(persisted.estado_f5).toBe('en_vivo');
  });

  it('does NOT reset estado_f5 for a terminal status change (status=completed)', async () => {
    const record = { id: ID, status: 'in_progress', estado_f5: 'en_vivo', cerrada_at: null };
    const { svc, repo, saved } = makeService(record);

    await svc.update(CLIENT, ID, { status: 'completed' } as UpdateActivationDto);

    // No reactivation lookup beyond TenantRepository.update's own findOne.
    expect(repo.findOne).toHaveBeenCalledTimes(1);
    expect(saved[saved.length - 1].estado_f5).toBe('en_vivo');
  });

  it('does NOT reset estado_f5 on an edit without a status change (e.g. notes only)', async () => {
    const record = { id: ID, status: 'scheduled', estado_f5: 'cerrada', cerrada_at: new Date() };
    const { svc, repo, saved } = makeService(record);

    await svc.update(CLIENT, ID, { notes: 'nota nueva' } as unknown as UpdateActivationDto);

    // Guard didn't fire (no status in dto): only TenantRepository.update's findOne ran.
    expect(repo.findOne).toHaveBeenCalledTimes(1);
    // estado_f5 stays as-is (a no-status edit is not a reactivation).
    expect(saved[saved.length - 1].estado_f5).toBe('cerrada');
  });
});
