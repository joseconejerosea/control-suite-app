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
      if (sql.includes('FROM activations')) return Promise.resolve([{ id: 'act-1' }]);
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
    expect(store[PHONE].materialIntake?.step).toBe('destino');

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

    // proyecto → destino.
    expect(await svc.handleResponse(PHONE, '1')).toBe(true);
    expect(store[PHONE].materialIntake?.step).toBe('destino');

    // destino (va a bodega) → bodega.
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

    expect(await svc.handleResponse(PHONE, '1')).toBe(true); // proyecto → destino
    expect(await svc.handleResponse(PHONE, '1')).toBe(true); // destino → bodega
    expect(await svc.handleResponse(PHONE, '1')).toBe(true); // bodega
    expect(store[PHONE].materialIntake?.step).toBe('cantidad'); // pregunta cantidad (1 ítem sin qty inline)
  });

  it('parses a slash-separated multi-item reply ("1 x / 2 y / 6 z") the same as one-per-line', async () => {
    let n = 0;
    skus.create = jest.fn(async (_c: string, dto: any) => ({ id: `sku-${++n}`, codigo: dto.codigo, nombre: dto.nombre }));

    await svc.start({ eventoCrudoId: 'evt-slash', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/s.jpg' });

    // Slash-separated, cantidad inline en cada parte → 3 ítems, salta la pregunta de cantidad.
    expect(await svc.handleResponse(PHONE, '1 Volumétrico / 2 muebles / 6 canastos')).toBe(true);
    expect(store[PHONE].materialIntake?.items?.length).toBe(3);
    expect(store[PHONE].materialIntake?.step).toBe('proyecto');

    expect(await svc.handleResponse(PHONE, '1')).toBe(true); // proyecto → destino
    expect(await svc.handleResponse(PHONE, '1')).toBe(true); // destino → bodega
    expect(await svc.handleResponse(PHONE, '1')).toBe(true); // bodega → registra
    expect(store[PHONE]).toBeUndefined();

    const nombres = skus.create.mock.calls.map((c: any[]) => c[1].nombre);
    expect(nombres).toEqual(['Volumétrico', 'muebles', 'canastos']);
    const cantidades = movimientos.create.mock.calls.map((c: any[]) => c[1].cantidad);
    expect(cantidades).toEqual([1, 2, 6]);
  });

  it('does NOT split a single material name that contains a slash (no inline qty)', async () => {
    await svc.start({ eventoCrudoId: 'evt-slash1', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/s1.jpg' });

    // Nombre legítimo con "/" y sin cantidad inline → UN solo ítem (no se parte).
    expect(await svc.handleResponse(PHONE, 'Banner blanco/negro')).toBe(true);
    expect(store[PHONE].materialIntake?.items?.length).toBe(1);
    expect(store[PHONE].materialIntake?.items?.[0].nombre).toBe('Banner blanco/negro');
    expect(store[PHONE].materialIntake?.step).toBe('proyecto');
  });

  it('offers the destino question (bodega vs se usa hoy) after choosing the project', async () => {
    await svc.start({ eventoCrudoId: 'evt-d', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/x.jpg' });
    await svc.handleResponse(PHONE, 'Silla ACME');           // nombre → proyecto (2 proyectos)
    expect(store[PHONE].materialIntake?.step).toBe('proyecto');
    await svc.handleResponse(PHONE, '1');                    // proyecto → destino
    expect(store[PHONE].materialIntake?.step).toBe('destino');
    const prompt = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(prompt).toMatch(/bodega/i);
    expect(prompt).toMatch(/se usa hoy/i);
  });

  it('"se usa hoy" with a single active activation records a consumo movement tied to the activation, no bodega', async () => {
    // default mock: FROM activations → [{ id: 'act-1' }] (single → auto-select)
    await svc.start({ eventoCrudoId: 'evt-uso', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/x.jpg' });
    expect(await svc.handleResponse(PHONE, 'Silla ACME')).toBe(true);   // → proyecto
    expect(await svc.handleResponse(PHONE, '1')).toBe(true);            // proyecto → destino
    expect(await svc.handleResponse(PHONE, '2')).toBe(true);            // destino: se usa hoy → (auto activación) → cantidad
    expect(store[PHONE].materialIntake?.step).toBe('cantidad');
    // No preguntó bodega.
    const asked = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(asked).not.toMatch(/¿En qué bodega/i);
    expect(await svc.handleResponse(PHONE, '5')).toBe(true);            // cantidad → register

    expect(movimientos.create).toHaveBeenCalledTimes(1);
    const dto = movimientos.create.mock.calls[0][1];
    expect(dto).toMatchObject({ tipo: 'consumo', proyecto_destino_id: 'proj-1', activacion_id: 'act-1', cantidad: 5, foto_key: 'materials/x.jpg' });
    expect(dto.bodega_origen_id).toBeUndefined();
    // Confirmación de consumo (no la de bodega).
    expect(wa.confirmarMaterial).not.toHaveBeenCalled();
    const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(msg).toMatch(/activaci[oó]n/i);
    expect(store[PHONE]).toBeUndefined();
  });

  it('"se usa hoy" with multiple active activations asks which one, then records consumo for the chosen activation', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes("status='active'")) return Promise.resolve([{ id: 'proj-1', name: 'Proyecto Uno' }]);
      if (sql.includes('FROM activations')) return Promise.resolve([
        { id: 'act-1', activation_date: '2026-08-12', location_name: 'Jumbo Maipú' },
        { id: 'act-2', activation_date: '2026-08-11', location_name: 'Líder Centro' },
      ]);
      if (sql.includes('SELECT name FROM projects')) return Promise.resolve([{ name: 'Proyecto Uno' }]);
      return Promise.resolve([]);
    });

    await svc.start({ eventoCrudoId: 'evt-multi-act', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/x.jpg' });
    // 1 proyecto → auto; entonces nombre lleva directo a destino.
    expect(await svc.handleResponse(PHONE, 'Silla ACME')).toBe(true);   // nombre → (1 proyecto auto) → destino
    expect(store[PHONE].materialIntake?.step).toBe('destino');
    expect(await svc.handleResponse(PHONE, '2')).toBe(true);            // se usa hoy → activacion (2 activas → pregunta)
    expect(store[PHONE].materialIntake?.step).toBe('activacion');
    const ask = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(ask).toMatch(/activaci[oó]n/i);
    // El picker muestra la ubicación de cada activación para poder distinguirlas.
    expect(ask).toContain('Jumbo Maipú');
    expect(ask).toContain('Líder Centro');
    expect(await svc.handleResponse(PHONE, '2')).toBe(true);            // elige act-2 → single item sin qty → cantidad
    expect(await svc.handleResponse(PHONE, '3')).toBe(true);            // cantidad → register

    const dto = movimientos.create.mock.calls[0][1];
    expect(dto).toMatchObject({ tipo: 'consumo', activacion_id: 'act-2', cantidad: 3 });
    expect(dto.bodega_origen_id).toBeUndefined();
  });

  it('retries on an invalid destino answer instead of proceeding', async () => {
    await svc.start({ eventoCrudoId: 'evt-badd', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/x.jpg' });
    await svc.handleResponse(PHONE, 'Silla ACME'); // → proyecto
    await svc.handleResponse(PHONE, '1');          // → destino
    expect(await svc.handleResponse(PHONE, 'xyz')).toBe(true);
    expect(store[PHONE]?.materialIntake?.step).toBe('destino');
    expect(movimientos.create).not.toHaveBeenCalled();
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

  it('escalates instead of asking for the material name when there is no active activation', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('FROM activations')) return Promise.resolve([]); // sin activación activa
      return Promise.resolve([]);
    });

    await svc.start({ eventoCrudoId: 'evt-noact', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/x.jpg' });

    // No arranca el intake: no pide el nombre ni crea SKU.
    expect(store[PHONE]).toBeUndefined();
    expect(skus.create).not.toHaveBeenCalled();

    // Marca el evento como escalated con el motivo correcto.
    const esc = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE eventos_crudos') && sql.includes("status='escalated'"),
    );
    expect(esc).toBeDefined();
    expect(esc[1][1]).toContain('material_no_active_activation');

    // Avisa al remitente que se deriva.
    const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(msg).toMatch(/activación activa/i);
  });

  it('proceeds to the nombre step when an active activation exists', async () => {
    await svc.start({ eventoCrudoId: 'evt-ok', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/x.jpg' });
    expect(store[PHONE].materialIntake?.step).toBe('nombre');
    const esc = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes("status='escalated'"),
    );
    expect(esc).toBeUndefined();
  });

  it('on ambiguity, answering "2" (material) with no active activation escalates instead of asking the name', async () => {
    await svc.askKind({ eventoCrudoId: 'evt-k2', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'inbound/k2.jpg' });
    // A partir de acá NO hay activación activa.
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('FROM activations')) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    expect(await svc.handleResponse(PHONE, '2')).toBe(true);

    expect(skus.create).not.toHaveBeenCalled();
    expect(store[PHONE]).toBeUndefined();
    const esc = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes("status='escalated'"),
    );
    expect(esc).toBeDefined();
    expect(esc[1][1]).toContain('material_no_active_activation');
  });
});
