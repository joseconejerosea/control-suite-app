/// <reference types="jest" />
import { DataSource, QueryRunner } from 'typeorm';
import { MaterialIntakeService } from './material-intake.service';
import { WhatsAppSession } from './whatsapp-session.service';

const PHONE = '5492216205665';
const CLIENT = 'client-1';

describe('MaterialIntakeService', () => {
  let svc: MaterialIntakeService;
  let store: Record<string, WhatsAppSession>;
  let queryMock: jest.Mock;
  let sessions: any;
  let wa: any;
  let skus: any;
  let movimientos: any;
  let classifyQueue: any;
  let evidenceIntake: any;

  beforeEach(() => {
    store = {};
    sessions = {
      get: jest.fn(async (p: string) => store[p] ?? null),
      set: jest.fn(async (p: string, s: WhatsAppSession) => { store[p] = s; }),
      delete: jest.fn(async (p: string) => { delete store[p]; }),
    };

    queryMock = jest.fn((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes("status='active'")) {
        return Promise.resolve([{ id: 'proj-1', name: 'Proyecto Uno' }, { id: 'proj-2', name: 'Proyecto Dos' }]);
      }
      if (sql.includes('FROM bodegas WHERE client_id')) {
        return Promise.resolve([{ id: 'bod-1', name: 'Bodega Central' }, { id: 'bod-2', name: 'Regional' }]);
      }
      if (sql.includes('SELECT name FROM projects')) return Promise.resolve([{ name: 'Proyecto Uno' }]);
      if (sql.includes('SELECT nombre FROM bodegas')) return Promise.resolve([{ nombre: 'Bodega Central' }]);
      return Promise.resolve([]);
    });

    const makeQueryRunner = (): QueryRunner =>
      ({
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        isTransactionActive: true,
        query: (sql: string, params?: any[]) => queryMock(sql, params),
      }) as unknown as QueryRunner;

    const ds = {
      createQueryRunner: jest.fn(() => makeQueryRunner()),
      query: (sql: string, params?: any[]) => queryMock(sql, params),
    } as unknown as DataSource;

    wa = { sendText: jest.fn().mockResolvedValue(true), confirmarMaterial: jest.fn().mockResolvedValue(true) };
    skus = { create: jest.fn(async (_c: string, dto: any) => ({ id: 'sku-1', codigo: dto.codigo, nombre: dto.nombre })) };
    movimientos = { create: jest.fn().mockResolvedValue({ id: 'mov-1' }) };
    classifyQueue = { add: jest.fn().mockResolvedValue(undefined) };
    evidenceIntake = { start: jest.fn().mockResolvedValue(undefined) };

    svc = new MaterialIntakeService(ds, classifyQueue, wa, sessions, skus, movimientos, evidenceIntake);
  });

  it('walks nombre → proyecto → bodega → cantidad and registers SKU + entrada movement', async () => {
    await svc.start({ eventoCrudoId: 'evt-1', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/x.jpg', suggestedLabel: 'silla' });
    expect(store[PHONE].materialIntake?.step).toBe('nombre');

    expect(await svc.handleResponse(PHONE, 'Silla ejecutiva ACME')).toBe(true);
    expect(store[PHONE].materialIntake?.step).toBe('proyecto');

    expect(await svc.handleResponse(PHONE, '1')).toBe(true);
    expect(store[PHONE].materialIntake?.step).toBe('bodega');

    expect(await svc.handleResponse(PHONE, '1')).toBe(true);
    expect(store[PHONE].materialIntake?.step).toBe('cantidad');

    expect(await svc.handleResponse(PHONE, '10')).toBe(true);

    // SKU creado con codigo único (MAT-...) y la foto del material.
    expect(skus.create).toHaveBeenCalledTimes(1);
    const skuDto = skus.create.mock.calls[0][1];
    expect(skuDto.nombre).toBe('Silla ejecutiva ACME');
    expect(skuDto.codigo).toMatch(/^MAT-/);
    // La foto se asocia al SKU con un UPDATE aparte (el DTO de create no la lleva).
    const fotoUpdate = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE skus SET foto_key'),
    );
    expect(fotoUpdate).toBeDefined();
    expect(fotoUpdate[1]).toEqual(['materials/x.jpg', 'sku-1', CLIENT]);

    // Movimiento de entrada con proyecto + bodega + cantidad.
    expect(movimientos.create).toHaveBeenCalledTimes(1);
    const movDto = movimientos.create.mock.calls[0][1];
    expect(movDto).toMatchObject({
      sku_id: 'sku-1', tipo: 'entrada', cantidad: 10,
      bodega_origen_id: 'bod-1', proyecto_destino_id: 'proj-1', foto_key: 'materials/x.jpg',
    });

    // Confirmación rica reflejando lo realmente registrado.
    expect(wa.confirmarMaterial).toHaveBeenCalledWith(expect.objectContaining({
      telefono: PHONE, nombre: 'Silla ejecutiva ACME', proyecto: 'Proyecto Uno', bodega: 'Bodega Central', cantidad: 10,
    }));
    expect(wa.confirmarMaterial.mock.calls[0][0].codigo).toMatch(/^MAT-/);

    // Regresión: eventos_crudos.flow es VARCHAR(10). 'F3_MATERIAL' (11) reventaba el
    // UPDATE, abortaba la tx y (con el .catch que se tragaba el error) hacía rollback
    // silencioso de TODA el alta. Debe usarse un flow ≤ 10 chars.
    const eventUpdate = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE eventos_crudos') && sql.includes('flow='),
    );
    expect(eventUpdate).toBeDefined();
    expect(eventUpdate[0]).toContain("flow='F3_INTAKE'");
    const flowValue = eventUpdate[0].match(/flow='([^']+)'/)![1];
    expect(flowValue.length).toBeLessThanOrEqual(10);

    // Sesión limpiada al terminar.
    expect(store[PHONE]).toBeUndefined();
  });

  it('parses a multi-item reply (qty + name per line) and registers N SKUs, skipping the cantidad question', async () => {
    // Usa el mock por defecto (2 proyectos + 2 bodegas) para pausar en cada paso.
    // skus.create devuelve un id distinto por llamada para diferenciar los movimientos.
    let n = 0;
    skus.create = jest.fn(async (_c: string, dto: any) => ({ id: `sku-${++n}`, codigo: dto.codigo, nombre: dto.nombre }));

    await svc.start({ eventoCrudoId: 'evt-multi', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/m.jpg' });

    // 3 ítems con cantidad inline, uno por línea → se cachean y pasa a elegir proyecto.
    expect(await svc.handleResponse(PHONE, '1 Volumétrico\n2 muebles\n6 canastos')).toBe(true);
    expect(store[PHONE].materialIntake?.items?.length).toBe(3);
    expect(store[PHONE].materialIntake?.step).toBe('proyecto');

    // proyecto → bodega.
    expect(await svc.handleResponse(PHONE, '1')).toBe(true);
    expect(store[PHONE].materialIntake?.step).toBe('bodega');

    // bodega → como la cantidad viene inline (multi-ítem), NO pregunta cantidad: registra.
    expect(await svc.handleResponse(PHONE, '1')).toBe(true);
    expect(store[PHONE]).toBeUndefined();

    expect(skus.create).toHaveBeenCalledTimes(3);
    expect(movimientos.create).toHaveBeenCalledTimes(3);

    const nombres = skus.create.mock.calls.map((c: any[]) => c[1].nombre);
    expect(nombres).toEqual(['Volumétrico', 'muebles', 'canastos']);
    const cantidades = movimientos.create.mock.calls.map((c: any[]) => c[1].cantidad);
    expect(cantidades).toEqual([1, 2, 6]);

    // Confirmación multi (no la de single-ítem).
    expect(wa.confirmarMaterial).not.toHaveBeenCalled();
    const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(msg).toContain('materiales registrados');
  });

  it('does NOT split a single material name that contains a comma', async () => {
    await svc.start({ eventoCrudoId: 'evt-comma', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/c.jpg' });

    // Nombre legítimo con coma → UN solo ítem (no se parte), y como no trae cantidad
    // inline, sigue el flujo clásico y pregunta la cantidad al final.
    expect(await svc.handleResponse(PHONE, 'Mesa, con logo Coca-Cola')).toBe(true);
    expect(store[PHONE].materialIntake?.items?.length).toBe(1);
    expect(store[PHONE].materialIntake?.items?.[0].nombre).toBe('Mesa, con logo Coca-Cola');
    expect(store[PHONE].materialIntake?.step).toBe('proyecto');

    expect(await svc.handleResponse(PHONE, '1')).toBe(true); // proyecto
    expect(await svc.handleResponse(PHONE, '1')).toBe(true); // bodega
    expect(store[PHONE].materialIntake?.step).toBe('cantidad'); // pregunta cantidad (1 ítem sin qty inline)
  });

  it('a bookkeeping failure after commit does NOT roll back the SKU/movement nor block the confirmation', async () => {
    // El cierre del evento (bookkeeping) corre en una tx SEPARADA post-commit. Si falla,
    // el alta real (SKU + movimiento) ya está commiteada y la confirmación igual sale.
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes("status='active'")) {
        return Promise.resolve([{ id: 'proj-1', name: 'Proyecto Uno' }]);
      }
      if (sql.includes('FROM bodegas WHERE client_id')) {
        return Promise.resolve([{ id: 'bod-1', name: 'Bodega Central' }]);
      }
      if (sql.includes('SELECT name FROM projects')) return Promise.resolve([{ name: 'Proyecto Uno' }]);
      if (sql.includes('SELECT nombre FROM bodegas')) return Promise.resolve([{ nombre: 'Bodega Central' }]);
      // El UPDATE de cierre del evento revienta (simula el abort que antes se tragaba).
      if (sql.includes('UPDATE eventos_crudos')) return Promise.reject(new Error('value too long for type character varying(10)'));
      return Promise.resolve([]);
    });

    store[PHONE] = {
      state: 'awaiting_material', projects: [], base64: '', mimeType: '', caption: '',
      clientId: CLIENT, canalId: null, updatedAt: '', clarification: null,
      materialIntake: {
        eventoCrudoId: 'evt-bk', storagePath: 'materials/x.jpg', step: 'cantidad',
        attempts: 0, nombre: 'Silla', proyectoId: 'proj-1', bodegaId: 'bod-1',
      },
    };

    expect(await svc.handleResponse(PHONE, '3')).toBe(true);

    // El alta real ocurrió y se confirmó, pese al fallo del bookkeeping.
    expect(skus.create).toHaveBeenCalledTimes(1);
    expect(movimientos.create).toHaveBeenCalledTimes(1);
    expect(wa.confirmarMaterial).toHaveBeenCalledTimes(1);
    expect(store[PHONE]).toBeUndefined();
  });

  it('on ambiguity, answering "1" (documento) resumes F1 classification and does not register material', async () => {
    await svc.askKind({ eventoCrudoId: 'evt-2', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'inbound/y.jpg' });
    expect(store[PHONE].materialIntake?.step).toBe('kind');

    expect(await svc.handleResponse(PHONE, '1')).toBe(true);

    expect(classifyQueue.add).toHaveBeenCalledWith(
      'classify',
      expect.objectContaining({ evento_crudo_id: 'evt-2', client_id: CLIENT, canal: 'whatsapp' }),
      expect.anything(),
    );
    expect(skus.create).not.toHaveBeenCalled();
    expect(store[PHONE]).toBeUndefined();
  });

  it('on ambiguity, answering "3" (evidencia) deletes the session and starts the evidence intake', async () => {
    await svc.askKind({ eventoCrudoId: 'evt-ev', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'inbound/e.jpg', suggestedLabel: 'anfitrionas' });
    expect(store[PHONE].materialIntake?.step).toBe('kind');

    expect(await svc.handleResponse(PHONE, '3')).toBe(true);

    // La sesión de material se limpió y arrancó el intake de evidencia con los args del intake.
    expect(sessions.delete).toHaveBeenCalledWith(PHONE);
    expect(evidenceIntake.start).toHaveBeenCalledWith(expect.objectContaining({
      eventoCrudoId: 'evt-ev',
      phoneNumber: PHONE,
      clientId: CLIENT,
      storagePath: 'inbound/e.jpg',
      suggestedLabel: 'anfitrionas',
    }));
    // No se registra material.
    expect(skus.create).not.toHaveBeenCalled();
  });

  it('the askKind prompt offers the evidencia option (3)', async () => {
    await svc.askKind({ eventoCrudoId: 'evt-k', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'inbound/k.jpg' });
    const prompt = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(prompt).toContain('3. Evidencia de actividad');
  });

  it('returns false when there is no material intake in session', async () => {
    expect(await svc.handleResponse(PHONE, 'hola')).toBe(false);
  });

  it('retries on an invalid quantity instead of registering', async () => {
    store[PHONE] = {
      state: 'awaiting_material', projects: [], base64: '', mimeType: '', caption: '',
      clientId: CLIENT, canalId: null, updatedAt: '', clarification: null,
      materialIntake: {
        eventoCrudoId: 'evt-3', storagePath: 'materials/z.jpg', step: 'cantidad',
        attempts: 0, nombre: 'Caja', proyectoId: 'proj-1', bodegaId: 'bod-1',
      },
    };

    expect(await svc.handleResponse(PHONE, 'muchas')).toBe(true);
    expect(skus.create).not.toHaveBeenCalled();
    expect(movimientos.create).not.toHaveBeenCalled();
    // Sigue esperando cantidad (reintento), la sesión no se borró.
    expect(store[PHONE]?.materialIntake?.step).toBe('cantidad');
  });
});
