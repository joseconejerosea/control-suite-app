/// <reference types="jest" />
import { WhatsAppSessionService } from './whatsapp-session.service';

/**
 * Dedup atómico de mensajes entrantes (SET NX).
 *
 * Prueba que claimMessage se apoya en el primitivo atómico `SET key val EX ttl NX`:
 * el primero en reclamar un messageId gana (true) y los reintentos de Meta con el
 * mismo id se descartan (false). Reemplaza el chequeo racy contra la DB.
 *
 * Patrón: se inyecta un fake de ioredis en el campo privado `redis` (el mismo que
 * onModuleInit crearía en runtime), evitando levantar Redis real.
 */
describe('WhatsAppSessionService · dedup atómico', () => {
  function buildService(redis: any): WhatsAppSessionService {
    const svc = new WhatsAppSessionService({ get: jest.fn() } as any);
    // Inyectar el fake redis en el campo privado (onModuleInit no corre en el test).
    (svc as any).redis = redis;
    return svc;
  }

  it('claimMessage devuelve true la primera vez y false para el mismo id (emula NX)', async () => {
    // Fake que emula SET ... NX: escribe sólo si la clave no existe.
    const held = new Set<string>();
    const redis = {
      set: jest.fn(async (key: string, _val: string, _ex: string, _ttl: number, mode?: string) => {
        if (mode === 'NX' && held.has(key)) return null; // ya existe → NX falla
        held.add(key);
        return 'OK';
      }),
      del: jest.fn(async (key: string) => { held.delete(key); return 1; }),
    };
    const svc = buildService(redis);

    await expect(svc.claimMessage('wamid.ABC')).resolves.toBe(true);
    await expect(svc.claimMessage('wamid.ABC')).resolves.toBe(false);

    // Se usó SET con NX y un TTL (segundo llamado sigue intentando NX).
    expect(redis.set).toHaveBeenCalledTimes(2);
    const firstCall = redis.set.mock.calls[0];
    expect(firstCall[0]).toBe('wa:dedup:wamid.ABC');
    expect(firstCall[2]).toBe('EX');
    expect(firstCall[4]).toBe('NX');
  });

  it('claimMessage de otro id se reclama independientemente', async () => {
    const held = new Set<string>();
    const redis = {
      set: jest.fn(async (key: string, _v: string, _ex: string, _ttl: number, mode?: string) => {
        if (mode === 'NX' && held.has(key)) return null;
        held.add(key);
        return 'OK';
      }),
      del: jest.fn(),
    };
    const svc = buildService(redis);

    await expect(svc.claimMessage('id-1')).resolves.toBe(true);
    await expect(svc.claimMessage('id-2')).resolves.toBe(true);
  });

  it('releaseMessage borra la clave para permitir el reintento de Meta', async () => {
    const held = new Set<string>();
    const redis = {
      set: jest.fn(async (key: string, _v: string, _ex: string, _ttl: number, mode?: string) => {
        if (mode === 'NX' && held.has(key)) return null;
        held.add(key);
        return 'OK';
      }),
      del: jest.fn(async (key: string) => { held.delete(key); return 1; }),
    };
    const svc = buildService(redis);

    await expect(svc.claimMessage('id-x')).resolves.toBe(true);
    await svc.releaseMessage('id-x');
    expect(redis.del).toHaveBeenCalledWith('wa:dedup:id-x');
    // Tras liberar, se puede volver a reclamar (reintento válido).
    await expect(svc.claimMessage('id-x')).resolves.toBe(true);
  });
});
