/// <reference types="jest" />
import { DataSource, QueryRunner } from 'typeorm';
import { MaterialIntakeService } from './material-intake.service';
import { WhatsAppSession } from './whatsapp-session.service';

const PHONE = '5492216205665';
const CLIENT = 'client-1';

describe('MaterialIntakeService', () => {
  let svc: MaterialIntakeService;
  let anySvc: any; // escape hatch for new public methods under test (avoids TS2339 before implementation)
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
    const claimed = new Set<string>();
    sessions = {
      get: jest.fn(async (p: string) => store[p] ?? null),
      set: jest.fn(async (p: string, s: WhatsAppSession) => { store[p] = s; }),
      delete: jest.fn(async (p: string) => { delete store[p]; }),
      // Emula el SET NX atómico: primera vez true, subsecuentes false para el mismo id.
      claimMaterialRegistration: jest.fn(async (id: string) => {
        if (claimed.has(id)) return false;
        claimed.add(id);
        return true;
      }),
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
    anySvc = svc as any;
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
    // A4: consumo now requires a location step before registering.
    // default mock: FROM activations → [{ id: 'act-1' }] (single → auto-select)
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes("status='active'")) {
        return Promise.resolve([{ id: 'proj-1', name: 'Proyecto Uno' }, { id: 'proj-2', name: 'Proyecto Dos' }]);
      }
      if (sql.includes('FROM activations') && sql.includes('estado_f5')) {
        // hasActiveActivation + askActivacion queries
        return Promise.resolve([{ id: 'act-1', activation_date: null, location_name: null }]);
      }
      if (sql.includes('SELECT a.id, a.location, a.status')) {
        // handleLocationForMaterial location validation
        return Promise.resolve([{ id: 'act-1', location: JSON.stringify({ lat: -33.0, lng: -70.0, radiusMeters: 200 }), status: 'in_progress' }]);
      }
      if (sql.includes('SELECT name FROM projects')) return Promise.resolve([{ name: 'Proyecto Uno' }]);
      return Promise.resolve([]);
    });

    await svc.start({ eventoCrudoId: 'evt-uso', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/x.jpg' });
    expect(await svc.handleResponse(PHONE, 'Silla ACME')).toBe(true);   // → proyecto
    expect(await svc.handleResponse(PHONE, '1')).toBe(true);            // proyecto → destino
    expect(await svc.handleResponse(PHONE, '2')).toBe(true);            // destino: se usa hoy → (auto activación) → cantidad
    expect(store[PHONE].materialIntake?.step).toBe('cantidad');
    // No preguntó bodega.
    const asked = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(asked).not.toMatch(/¿En qué bodega/i);
    expect(await svc.handleResponse(PHONE, '5')).toBe(true);            // cantidad → ubicacion (A4: pausa aquí)
    // A4: paused at location step, not yet registered.
    expect(store[PHONE]?.materialIntake?.step).toBe('ubicacion');
    expect(movimientos.create).not.toHaveBeenCalled();

    // Provide the location pin to complete registration.
    expect(await anySvc.handleLocationForMaterial(PHONE, -33.0, -70.0, 'evt-loc')).toBe(true);

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
    // A4: consumo requires a location step; the mock needs to handle both the activation
    // list query AND the per-activation location validation query from handleLocationForMaterial.
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes("status='active'")) return Promise.resolve([{ id: 'proj-1', name: 'Proyecto Uno' }]);
      // hasActiveActivation and askActivacion (both use 'FROM activations' with 'estado_f5')
      if (sql.includes('FROM activations') && sql.includes('estado_f5')) {
        return Promise.resolve([
          { id: 'act-1', activation_date: '2026-08-12', location_name: 'Jumbo Maipú' },
          { id: 'act-2', activation_date: '2026-08-11', location_name: 'Líder Centro' },
        ]);
      }
      // handleLocationForMaterial per-activation validation
      if (sql.includes('SELECT a.id, a.location, a.status')) {
        return Promise.resolve([{ id: 'act-2', location: JSON.stringify({ lat: -33.0, lng: -70.0, radiusMeters: 200 }), status: 'in_progress' }]);
      }
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
    expect(await svc.handleResponse(PHONE, '3')).toBe(true);            // cantidad → ubicacion (A4: pausa aquí)
    expect(store[PHONE]?.materialIntake?.step).toBe('ubicacion');

    // Complete with a location pin.
    expect(await anySvc.handleLocationForMaterial(PHONE, -33.0, -70.0, 'evt-loc')).toBe(true);

    const dto = movimientos.create.mock.calls[0][1];
    expect(dto).toMatchObject({ tipo: 'consumo', activacion_id: 'act-2', cantidad: 3 });
    expect(dto.bodega_origen_id).toBeUndefined();
    expect(store[PHONE]).toBeUndefined();
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

  it('notifies the sender (NOT escalate) when the activation closes mid-flow (picker race) — B-004 reachable path', async () => {
    // B-004: askKind/handleKind were removed. notifyNoActivation stays reachable via the
    // start() guard and via this picker-race in handleActivacion — start() passes because
    // there IS an active activation, but by the time we ask for the destino the activations
    // query comes back empty (it closed in between), so askActivacion must notifyNoActivation.
    let activationsCall = 0;
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes("status='active'")) return Promise.resolve([{ id: 'proj-1', name: 'Proyecto Uno' }]);
      if (sql.includes('FROM activations')) {
        // start() guard sees 1 activation; the later askActivacion query sees 0 (race).
        activationsCall += 1;
        return Promise.resolve(activationsCall === 1 ? [{ id: 'act-1' }] : []);
      }
      return Promise.resolve([]);
    });

    await svc.start({ eventoCrudoId: 'evt-race', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/x.jpg' });
    expect(store[PHONE].materialIntake?.step).toBe('nombre');

    expect(await svc.handleResponse(PHONE, 'Silla ACME')).toBe(true); // nombre → (1 proyecto auto) → destino
    expect(store[PHONE].materialIntake?.step).toBe('destino');
    expect(await svc.handleResponse(PHONE, '2')).toBe(true);          // se usa hoy → askActivacion → 0 activas → notifyNoActivation

    // notifyNoActivation ran: event marked no_activation, session cleared, no material created.
    const noact = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE eventos_crudos') && sql.includes("status='no_activation'"),
    );
    expect(noact).toBeDefined();
    expect(noact[1][1]).toContain('material_no_active_activation');
    expect(skus.create).not.toHaveBeenCalled();
    expect(store[PHONE]).toBeUndefined();
    const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(msg).not.toMatch(/operador/i);
  });

  it('returns false when there is no material intake in session', async () => {
    expect(await svc.handleResponse(PHONE, 'hola')).toBe(false);
  });

  // ── A4 · Ubicación obligatoria para consumo ────────────────────────────────

  it('[A4] consumo flow transitions to ubicacion step instead of registering after cantidad', async () => {
    // Single activation auto-selected; single item with no inline qty → asks cantidad.
    await svc.start({ eventoCrudoId: 'evt-ub1', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/x.jpg' });
    await svc.handleResponse(PHONE, 'Silla ACME');  // nombre → proyecto
    await svc.handleResponse(PHONE, '1');            // proyecto → destino
    await svc.handleResponse(PHONE, '2');            // destino: consumo → (auto activación) → cantidad
    expect(store[PHONE].materialIntake?.step).toBe('cantidad');

    await svc.handleResponse(PHONE, '5');            // cantidad → ubicacion (NOT register)

    // Must NOT have registered yet.
    expect(skus.create).not.toHaveBeenCalled();
    expect(movimientos.create).not.toHaveBeenCalled();
    // Session still live, step is 'ubicacion'.
    expect(store[PHONE]).toBeDefined();
    expect(store[PHONE].materialIntake?.step).toBe('ubicacion');
    // Prompt asks for a location pin.
    const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(msg).toMatch(/ubic[aá]ci[oó]n/i);
    expect(msg).toMatch(/clip/i);
  });

  it('[A4] consumo flow (multi-item with inline qty) transitions to ubicacion step instead of registering (no cantidad step)', async () => {
    // 3 items with inline quantity → no cantidad question; should pause for location.
    let n = 0;
    skus.create = jest.fn(async (_c: string, dto: any) => ({ id: `sku-${++n}`, codigo: dto.codigo, nombre: dto.nombre }));

    await svc.start({ eventoCrudoId: 'evt-ub-multi', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/m.jpg' });
    await svc.handleResponse(PHONE, '1 Volumétrico\n2 muebles\n6 canastos'); // nombre → proyecto
    await svc.handleResponse(PHONE, '1');    // proyecto → destino
    await svc.handleResponse(PHONE, '2');    // consumo → (auto activación, no cantidad) → ubicacion

    expect(skus.create).not.toHaveBeenCalled();
    expect(store[PHONE]).toBeDefined();
    expect(store[PHONE].materialIntake?.step).toBe('ubicacion');
  });

  it('[A4] bodega flow still registers immediately, no ubicacion step', async () => {
    await svc.start({ eventoCrudoId: 'evt-ub-bod', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/x.jpg' });
    await svc.handleResponse(PHONE, 'Silla ACME');  // nombre → proyecto
    await svc.handleResponse(PHONE, '1');            // proyecto → destino
    await svc.handleResponse(PHONE, '1');            // destino: bodega → bodega
    await svc.handleResponse(PHONE, '1');            // bodega → cantidad
    expect(store[PHONE].materialIntake?.step).toBe('cantidad');
    await svc.handleResponse(PHONE, '3');            // cantidad → register (immediate, no ubicacion)

    expect(skus.create).toHaveBeenCalledTimes(1);
    expect(movimientos.create).toHaveBeenCalledTimes(1);
    expect(store[PHONE]).toBeUndefined(); // session cleared = completed
  });

  it('[A4] handleLocationForMaterial: completes registration (VERIFIED), clears session, sends confirmation', async () => {
    // Pre-seed session at step='ubicacion' with a consumo intake that already has activacionId.
    store[PHONE] = {
      state: 'awaiting_material',
      projects: [], base64: '', mimeType: '', caption: '',
      clientId: CLIENT, canalId: null, updatedAt: '', clarification: null,
      materialIntake: {
        eventoCrudoId: 'evt-ub2', storagePath: 'materials/x.jpg', step: 'ubicacion' as any,
        attempts: 0, nombre: 'Silla', proyectoId: 'proj-1', destino: 'consumo', activacionId: 'act-1',
        items: [{ nombre: 'Silla', cantidad: 5 }],
      },
    };

    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('SELECT name FROM projects')) return Promise.resolve([{ name: 'Proyecto Uno' }]);
      // activation with location for haversine
      if (sql.includes('SELECT a.id, a.location, a.status')) {
        return Promise.resolve([{ id: 'act-1', location: JSON.stringify({ lat: -33.0, lng: -70.0, radiusMeters: 200 }), status: 'in_progress' }]);
      }
      return Promise.resolve([]);
    });

    // Pin inside radius (same coordinates → 0m distance).
    const result = await anySvc.handleLocationForMaterial(PHONE, -33.0, -70.0, 'evt-loc-1');

    expect(result).toBe(true);
    // Registration happened.
    expect(skus.create).toHaveBeenCalledTimes(1);
    expect(movimientos.create).toHaveBeenCalledTimes(1);
    const dto = movimientos.create.mock.calls[0][1];
    expect(dto).toMatchObject({ tipo: 'consumo', activacion_id: 'act-1', cantidad: 5 });
    // Session cleared.
    expect(store[PHONE]).toBeUndefined();
    // Confirmation sent (no mismatch warning).
    const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(msg).toMatch(/activaci[oó]n/i);
    expect(msg).not.toMatch(/fuera del rango/i);
  });

  it('[A4] handleLocationForMaterial: completes registration (MISMATCH) with a warning, does NOT block', async () => {
    store[PHONE] = {
      state: 'awaiting_material',
      projects: [], base64: '', mimeType: '', caption: '',
      clientId: CLIENT, canalId: null, updatedAt: '', clarification: null,
      materialIntake: {
        eventoCrudoId: 'evt-ub3', storagePath: 'materials/x.jpg', step: 'ubicacion' as any,
        attempts: 0, nombre: 'Mesa', proyectoId: 'proj-1', destino: 'consumo', activacionId: 'act-1',
        items: [{ nombre: 'Mesa', cantidad: 2 }],
      },
    };

    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('SELECT name FROM projects')) return Promise.resolve([{ name: 'Proyecto Dos' }]);
      // 5km away — well outside any radius
      if (sql.includes('SELECT a.id, a.location, a.status')) {
        return Promise.resolve([{ id: 'act-1', location: JSON.stringify({ lat: -33.0, lng: -70.0, radiusMeters: 200 }), status: 'scheduled' }]);
      }
      return Promise.resolve([]);
    });

    // 5km north: far outside radius
    const result = await anySvc.handleLocationForMaterial(PHONE, -32.955, -70.0, 'evt-loc-2');

    expect(result).toBe(true);
    // Still registered despite mismatch.
    expect(skus.create).toHaveBeenCalledTimes(1);
    expect(movimientos.create).toHaveBeenCalledTimes(1);
    expect(store[PHONE]).toBeUndefined();
    // Confirmation includes a warning about the mismatch.
    const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(msg).toMatch(/activaci[oó]n/i);
    expect(msg).toMatch(/fuera del rango/i);
  });

  it('[A4] handleLocationForMaterial: returns false when there is no pending material-location', async () => {
    // No session at all.
    const result = await anySvc.handleLocationForMaterial(PHONE, -33.0, -70.0, 'evt-loc-3');
    expect(result).toBe(false);
  });

  it('[A4] handleLocationForMaterial: returns false when step is not ubicacion', async () => {
    store[PHONE] = {
      state: 'awaiting_material',
      projects: [], base64: '', mimeType: '', caption: '',
      clientId: CLIENT, canalId: null, updatedAt: '', clarification: null,
      materialIntake: {
        eventoCrudoId: 'evt-ub4', storagePath: 'materials/x.jpg', step: 'cantidad',
        attempts: 0, nombre: 'Silla', proyectoId: 'proj-1', destino: 'consumo', activacionId: 'act-1',
        items: [{ nombre: 'Silla', cantidad: 5 }],
      },
    };
    const result = await anySvc.handleLocationForMaterial(PHONE, -33.0, -70.0, 'evt-loc-4');
    expect(result).toBe(false);
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

  it('notifies the sender (NOT escalate) instead of asking for the material name when there is no active activation', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('FROM activations')) return Promise.resolve([]); // sin activación activa
      return Promise.resolve([]);
    });

    await svc.start({ eventoCrudoId: 'evt-noact', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/x.jpg' });

    // No arranca el intake: no pide el nombre ni crea SKU.
    expect(store[PHONE]).toBeUndefined();
    expect(skus.create).not.toHaveBeenCalled();

    // T3: NO escala. Marca el evento con status='no_activation' (solo auditoría).
    const esc = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE eventos_crudos') && sql.includes("status='escalated'"),
    );
    expect(esc).toBeUndefined();
    const noact = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE eventos_crudos') && sql.includes("status='no_activation'"),
    );
    expect(noact).toBeDefined();
    expect(noact[1][1]).toContain('material_no_active_activation');

    // Mensaje claro y accionable al remitente (sin mención a operador).
    const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(msg).toBe(
      'No veo una activación activa hoy para asociar este material. Pedile a tu coordinador que cargue la activación y volvé a enviármelo. 🙌',
    );
    expect(msg).not.toMatch(/operador/i);
  });

  it('proceeds to the nombre step when an active activation exists', async () => {
    await svc.start({ eventoCrudoId: 'evt-ok', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/x.jpg' });
    expect(store[PHONE].materialIntake?.step).toBe('nombre');
    const esc = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes("status='escalated'"),
    );
    expect(esc).toBeUndefined();
    const noact = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes("status='no_activation'"),
    );
    expect(noact).toBeUndefined();
  });

  // ── A4 · JD-001 · escalado en el paso de ubicación ─────────────────────────

  it('[JD-001] escalates to an operator after MAX_ATTEMPTS of non-GPS replies at the ubicacion step', async () => {
    // Seed a session paused at step='ubicacion' (consumo intake awaiting a pin).
    store[PHONE] = {
      state: 'awaiting_material', projects: [], base64: '', mimeType: '', caption: '',
      clientId: CLIENT, canalId: null, updatedAt: '', clarification: null,
      materialIntake: {
        eventoCrudoId: 'evt-esc', storagePath: 'materials/x.jpg', step: 'ubicacion' as any,
        attempts: 0, nombre: 'Silla', proyectoId: 'proj-1', destino: 'consumo', activacionId: 'act-1',
        items: [{ nombre: 'Silla', cantidad: 5 }],
      },
    };

    // First bad (text) reply → re-prompt, session stays alive, attempts incremented.
    expect(await svc.handleResponse(PHONE, 'no sé mandar ubicación')).toBe(true);
    expect(store[PHONE]?.materialIntake?.step).toBe('ubicacion');
    expect(store[PHONE]?.materialIntake?.attempts).toBe(1);
    expect(movimientos.create).not.toHaveBeenCalled();

    // Second bad reply → reaches MAX_ATTEMPTS → escalate + clear session.
    expect(await svc.handleResponse(PHONE, 'sigo sin poder')).toBe(true);

    // Event marked escalated, session cleared, no material created.
    const esc = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE eventos_crudos') && sql.includes("status='escalated'"),
    );
    expect(esc).toBeDefined();
    expect(esc[1][1]).toContain('material_intake_max_attempts');
    expect(store[PHONE]).toBeUndefined();
    expect(skus.create).not.toHaveBeenCalled();
    expect(movimientos.create).not.toHaveBeenCalled();
    const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(msg).toMatch(/operador/i);
  });

  // ── A4 · JD-002 · sin GPS almacenado → status neutral, sin warning falso ────

  it('[JD-002] activation without stored GPS → registers, NEUTRAL location status, NO false "fuera de rango" warning', async () => {
    store[PHONE] = {
      state: 'awaiting_material', projects: [], base64: '', mimeType: '', caption: '',
      clientId: CLIENT, canalId: null, updatedAt: '', clarification: null,
      materialIntake: {
        eventoCrudoId: 'evt-nogps', storagePath: 'materials/x.jpg', step: 'ubicacion' as any,
        attempts: 0, nombre: 'Silla', proyectoId: 'proj-1', destino: 'consumo', activacionId: 'act-1',
        items: [{ nombre: 'Silla', cantidad: 5 }],
      },
    };

    let locationCheckStatus: string | undefined;
    queryMock.mockImplementation((sql: string, params?: any[]) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('SELECT name FROM projects')) return Promise.resolve([{ name: 'Proyecto Uno' }]);
      // Activation exists but has NO stored GPS (location is null) — a normal case.
      if (sql.includes('SELECT a.id, a.location, a.status')) {
        return Promise.resolve([{ id: 'act-1', location: null, status: 'in_progress' }]);
      }
      if (sql.includes('INSERT INTO activation_events')) {
        locationCheckStatus = params?.[2]; // location_status column value
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const result = await anySvc.handleLocationForMaterial(PHONE, -33.0, -70.0, 'evt-loc-nogps');
    expect(result).toBe(true);

    // Still registered.
    expect(skus.create).toHaveBeenCalledTimes(1);
    expect(movimientos.create).toHaveBeenCalledTimes(1);
    expect(store[PHONE]).toBeUndefined();

    // NEUTRAL status written to LOCATION_CHECK — NOT 'MISMATCH'.
    expect(locationCheckStatus).toBeDefined();
    expect(locationCheckStatus).not.toBe('MISMATCH');

    // No bogus "fuera de rango" warning in the confirmation.
    const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(msg).toMatch(/activaci[oó]n/i);
    expect(msg).not.toMatch(/fuera del rango/i);
  });

  it('[JD-002] activation lookup empty → registers, NEUTRAL status, NO false warning', async () => {
    store[PHONE] = {
      state: 'awaiting_material', projects: [], base64: '', mimeType: '', caption: '',
      clientId: CLIENT, canalId: null, updatedAt: '', clarification: null,
      materialIntake: {
        eventoCrudoId: 'evt-empty', storagePath: 'materials/x.jpg', step: 'ubicacion' as any,
        attempts: 0, nombre: 'Silla', proyectoId: 'proj-1', destino: 'consumo', activacionId: 'act-1',
        items: [{ nombre: 'Silla', cantidad: 5 }],
      },
    };

    let locationCheckStatus: string | undefined;
    queryMock.mockImplementation((sql: string, params?: any[]) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('SELECT name FROM projects')) return Promise.resolve([{ name: 'Proyecto Uno' }]);
      // Lookup returns 0 rows.
      if (sql.includes('SELECT a.id, a.location, a.status')) return Promise.resolve([]);
      if (sql.includes('INSERT INTO activation_events')) {
        locationCheckStatus = params?.[2];
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const result = await anySvc.handleLocationForMaterial(PHONE, -33.0, -70.0, 'evt-loc-empty');
    expect(result).toBe(true);
    expect(movimientos.create).toHaveBeenCalledTimes(1);
    expect(locationCheckStatus).not.toBe('MISMATCH');
    const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(msg).not.toMatch(/fuera del rango/i);
  });

  it('[JD-002/JB-003] a legit coordinate of exactly 0 is compared, not skipped as falsy', async () => {
    store[PHONE] = {
      state: 'awaiting_material', projects: [], base64: '', mimeType: '', caption: '',
      clientId: CLIENT, canalId: null, updatedAt: '', clarification: null,
      materialIntake: {
        eventoCrudoId: 'evt-zero', storagePath: 'materials/x.jpg', step: 'ubicacion' as any,
        attempts: 0, nombre: 'Silla', proyectoId: 'proj-1', destino: 'consumo', activacionId: 'act-1',
        items: [{ nombre: 'Silla', cantidad: 5 }],
      },
    };

    let locationCheckStatus: string | undefined;
    queryMock.mockImplementation((sql: string, params?: any[]) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('SELECT name FROM projects')) return Promise.resolve([{ name: 'Proyecto Uno' }]);
      // Activation at the equator/prime meridian: lat=0, lng=0. Pin is the same point.
      if (sql.includes('SELECT a.id, a.location, a.status')) {
        return Promise.resolve([{ id: 'act-1', location: JSON.stringify({ lat: 0, lng: 0, radiusMeters: 200 }), status: 'in_progress' }]);
      }
      if (sql.includes('INSERT INTO activation_events')) {
        locationCheckStatus = params?.[2];
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    // Pin exactly at (0,0) → distance 0 → VERIFIED (proves 0 coords were NOT skipped).
    const result = await anySvc.handleLocationForMaterial(PHONE, 0, 0, 'evt-loc-zero');
    expect(result).toBe(true);
    expect(locationCheckStatus).toBe('VERIFIED');
    const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(msg).not.toMatch(/fuera del rango/i);
  });

  // ── A4 · JD-003 · idempotencia: doble register no duplica inventario ────────

  it('[JD-003] a double location-pin for the same eventoCrudoId registers movements only ONCE', async () => {
    const seed = (): WhatsAppSession => ({
      state: 'awaiting_material', projects: [], base64: '', mimeType: '', caption: '',
      clientId: CLIENT, canalId: null, updatedAt: '', clarification: null,
      materialIntake: {
        eventoCrudoId: 'evt-dup', storagePath: 'materials/x.jpg', step: 'ubicacion' as any,
        attempts: 0, nombre: 'Silla', proyectoId: 'proj-1', destino: 'consumo', activacionId: 'act-1',
        items: [{ nombre: 'Silla', cantidad: 5 }],
      },
    });

    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('SELECT name FROM projects')) return Promise.resolve([{ name: 'Proyecto Uno' }]);
      if (sql.includes('SELECT a.id, a.location, a.status')) {
        return Promise.resolve([{ id: 'act-1', location: JSON.stringify({ lat: -33.0, lng: -70.0, radiusMeters: 200 }), status: 'in_progress' }]);
      }
      return Promise.resolve([]);
    });

    // Two concurrent pins (distinct location messageIds), both read the SAME live session
    // at step='ubicacion' before either deletes it. Both call register() for evt-dup.
    store[PHONE] = seed();
    const s1 = store[PHONE];
    store[PHONE] = seed();
    const s2 = store[PHONE];

    const [r1, r2] = await Promise.all([
      anySvc.handleLocationForMaterial(PHONE, -33.0, -70.0, 'evt-loc-a'),
      anySvc.handleLocationForMaterial(PHONE, -33.0, -70.0, 'evt-loc-b'),
    ]);

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    // Inventory writes happened EXACTLY once despite two register() calls.
    expect(skus.create).toHaveBeenCalledTimes(1);
    expect(movimientos.create).toHaveBeenCalledTimes(1);

    // Direct double-register() also protected (both sessions point at evt-dup).
    skus.create.mockClear();
    movimientos.create.mockClear();
    await anySvc.register(PHONE, s1);
    await anySvc.register(PHONE, s2);
    expect(skus.create).not.toHaveBeenCalled();
    expect(movimientos.create).not.toHaveBeenCalled();
  });

});
