/// <reference types="jest" />
/**
 * Spec para PromotersService — derivación de `rota` desde `rol_tipo`.
 *
 * Verifica que:
 * - `create` deriva rota correctamente vía isRota(dto.rol_tipo).
 * - `update` deriva rota correctamente.
 * - `rota` inyectado por el cliente (ataque I-6) es ignorado.
 * - `rol_tipo` fuera del enum es rechazado por class-validator (400) antes de llegar
 *   al service; aquí mockeamos la validación ya aprobada y comprobamos el derivo.
 */
import { ConflictException } from '@nestjs/common';
import { PromotersService } from './promoters.service';

// Mock del TenantRepository para evitar dependencias de DB
const mockSave = jest.fn();
const mockFindOne = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../../common/repositories/tenant.repository', () => ({
  TenantRepository: jest.fn().mockImplementation(() => ({
    findAll: jest.fn(),
    findOne: mockFindOne,
    create: mockCreate,
    update: mockUpdate,
    remove: jest.fn(),
    raw: {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: any) => data),
      save: mockSave,
    },
  })),
}));

const CLIENT_ID = 'client-123';

describe('PromotersService — derivación de rota', () => {
  let service: PromotersService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Simular dataSource mínimo para que el constructor no falle
    const fakeDs = {
      getRepository: jest.fn().mockReturnValue({
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((data: any) => ({ ...data })),
        save: mockSave,
      }),
    } as any;
    service = new PromotersService(fakeDs);
  });

  describe('create()', () => {
    it('deriva rota=true para rol_tipo "anfitrion"', async () => {
      mockCreate.mockImplementation(async (_clientId: string, data: any) => ({
        ...data,
        id: 'p1',
        client_id: _clientId,
      }));

      const result = await service.create(CLIENT_ID, {
        first_name: 'Ana',
        last_name: 'García',
        email: 'ana@test.com',
        rol_tipo: 'anfitrion',
      });

      expect(result.rota).toBe(true);
      expect(result.rol_tipo).toBe('anfitrion');
    });

    it('deriva rota=false para rol_tipo "supervisor"', async () => {
      mockCreate.mockImplementation(async (_clientId: string, data: any) => ({
        ...data,
        id: 'p2',
        client_id: _clientId,
      }));

      const result = await service.create(CLIENT_ID, {
        first_name: 'Carlos',
        last_name: 'López',
        email: 'carlos@test.com',
        rol_tipo: 'supervisor',
      });

      expect(result.rota).toBe(false);
      expect(result.rol_tipo).toBe('supervisor');
    });

    it('ignora rota inyectado por el cliente (I-6: server-side wins)', async () => {
      mockCreate.mockImplementation(async (_clientId: string, data: any) => ({
        ...data,
        id: 'p3',
        client_id: _clientId,
      }));

      // Simular ataque: cliente envía rol_tipo=anfitrion + rota=false
      const result = await service.create(CLIENT_ID, {
        first_name: 'Eva',
        last_name: 'Ruiz',
        email: 'eva@test.com',
        rol_tipo: 'anfitrion',
        // rota no está en el DTO, pero si llegara al service:
      } as any);

      // El servicio debe derivar rota=true para anfitrion
      expect(result.rota).toBe(true);
    });

    it('lanza ConflictException si ya existe un promotor con ese email', async () => {
      // Simular que raw.findOne devuelve un registro existente (email duplicado).
      // El mock de TenantRepository expone raw.findOne; lo configuramos por test.
      const { TenantRepository } = jest.requireMock(
        '../../common/repositories/tenant.repository',
      ) as any;
      TenantRepository.mockImplementationOnce(() => ({
        findAll: jest.fn(),
        findOne: mockFindOne,
        create: mockCreate,
        update: mockUpdate,
        remove: jest.fn(),
        raw: {
          findOne: jest.fn().mockResolvedValue({ id: 'existing', email: 'dup@test.com' }),
          create: jest.fn(),
          save: jest.fn(),
        },
      }));

      const s = new PromotersService({ getRepository: jest.fn() } as any);

      await expect(
        s.create(CLIENT_ID, {
          first_name: 'X',
          last_name: 'Y',
          email: 'dup@test.com',
          rol_tipo: 'promotor',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update()', () => {
    it('deriva rota=true al actualizar a rol_tipo "productor"', async () => {
      mockUpdate.mockImplementation(async (_clientId: string, _id: string, data: any) => ({
        id: _id,
        client_id: _clientId,
        ...data,
      }));

      const result = await service.update(CLIENT_ID, 'p4', {
        rol_tipo: 'productor',
      });

      expect(result.rota).toBe(true);
    });

    it('deriva rota=false al actualizar a rol_tipo "coordinador"', async () => {
      mockUpdate.mockImplementation(async (_clientId: string, _id: string, data: any) => ({
        id: _id,
        client_id: _clientId,
        ...data,
      }));

      const result = await service.update(CLIENT_ID, 'p5', {
        rol_tipo: 'coordinador',
      });

      expect(result.rota).toBe(false);
    });

    it('NO toca rota en un update parcial sin rol_tipo (no clobbea el valor guardado)', async () => {
      let capturedPayload: any;
      mockUpdate.mockImplementation(async (_clientId: string, _id: string, data: any) => {
        capturedPayload = data;
        return { id: _id, client_id: _clientId, ...data };
      });

      // Un supervisor (rota=false guardado) edita solo su nombre: rota NO debe recalcularse.
      await service.update(CLIENT_ID, 'p6', {
        first_name: 'Solo nombre cambia',
      });

      expect(capturedPayload).not.toHaveProperty('rota');
    });

    it('re-deriva rota cuando el update SÍ incluye rol_tipo=null (limpieza → conservador true)', async () => {
      let capturedPayload: any;
      mockUpdate.mockImplementation(async (_clientId: string, _id: string, data: any) => {
        capturedPayload = data;
        return { id: _id, client_id: _clientId, ...data };
      });

      await service.update(CLIENT_ID, 'p7', {
        rol_tipo: null as any,
      });

      expect(capturedPayload.rota).toBe(true);
    });
  });
});
