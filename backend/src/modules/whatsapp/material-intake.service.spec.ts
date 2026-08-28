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

  it('walks nombre → destino → proyecto → bodega → cantidad and registers SKU + entrada movement', async () => {
    await svc.start({ eventoCrudoId: 'evt-1', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/x.jpg', suggestedLabel: 'silla' });
    expect(store[PHONE].materialIntake?.step).toBe('nombre');

    // #7a · el destino se pregunta ANTES que el proyecto.
    expect(await svc.handleResponse(PHONE, 'Silla ejecutiva ACME')).toBe(true);
    expect(store[PHONE].materialIntake?.step).toBe('destino');

    expect(await svc.handleResponse(PHONE, '1')).toBe(true); // va a bodega → pregunta proyecto (2 proyectos)
    expect(store[PHONE].materialIntake?.step).toBe('proyecto');

    expect(await svc.handleResponse(PHONE, '1')).toBe(true); // proyecto → bodega
    expect(store[PHONE].materialIntake?.step).toBe('bodega');

    expect(await svc.handleResponse(PHONE, '1')).toBe(true); // bodega → cantidad
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
    expect(store[PHONE].materialIntake?.step).toBe('destino');

    // destino (va a bodega) → proyecto (2 proyectos).
    expect(await svc.handleResponse(PHONE, '1')).toBe(true);
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
    expect(store[PHONE].materialIntake?.step).toBe('destino');

    expect(await svc.handleResponse(PHONE, '1')).toBe(true); // destino (bodega) → proyecto
    expect(await svc.handleResponse(PHONE, '1')).toBe(true); // proyecto → bodega
    expect(await svc.handleResponse(PHONE, '1')).toBe(true); // bodega → cantidad
    expect(store[PHONE].materialIntake?.step).toBe('cantidad'); // pregunta cantidad (1 ítem sin qty inline)
  });

  it('parses a slash-separated multi-item reply ("1 x / 2 y / 6 z") the same as one-per-line', async () => {
    let n = 0;
    skus.create = jest.fn(async (_c: string, dto: any) => ({ id: `sku-${++n}`, codigo: dto.codigo, nombre: dto.nombre }));

    await svc.start({ eventoCrudoId: 'evt-slash', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/s.jpg' });

    // Slash-separated, cantidad inline en cada parte → 3 ítems, salta la pregunta de cantidad.
    expect(await svc.handleResponse(PHONE, '1 Volumétrico / 2 muebles / 6 canastos')).toBe(true);
    expect(store[PHONE].materialIntake?.items?.length).toBe(3);
    expect(store[PHONE].materialIntake?.step).toBe('destino');

    expect(await svc.handleResponse(PHONE, '1')).toBe(true); // destino (bodega) → proyecto
    expect(await svc.handleResponse(PHONE, '1')).toBe(true); // proyecto → bodega
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
    expect(store[PHONE].materialIntake?.step).toBe('destino');
  });

  it('offers the destino question (bodega vs se usa hoy) right after the material name', async () => {
    await svc.start({ eventoCrudoId: 'evt-d', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/x.jpg' });
    await svc.handleResponse(PHONE, 'Silla ACME');           // nombre → destino (#7a: destino antes que proyecto)
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
        // hasActiveActivation + askActivacion queries. #7a: askActivacion deriva el proyecto
        // de la activación (COALESCE project_id), así que la fila trae project_id.
        return Promise.resolve([{ id: 'act-1', activation_date: null, location_name: null, project_id: 'proj-1' }]);
      }
      if (sql.includes('SELECT a.id, a.location, a.status')) {
        // handleLocationForMaterial location validation
        return Promise.resolve([{ id: 'act-1', location: JSON.stringify({ lat: -33.0, lng: -70.0, radiusMeters: 200 }), status: 'in_progress' }]);
      }
      if (sql.includes('SELECT name FROM projects')) return Promise.resolve([{ name: 'Proyecto Uno' }]);
      return Promise.resolve([]);
    });

    await svc.start({ eventoCrudoId: 'evt-uso', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/x.jpg' });
    expect(await svc.handleResponse(PHONE, 'Silla ACME')).toBe(true);   // nombre → destino
    expect(store[PHONE].materialIntake?.step).toBe('destino');
    expect(await svc.handleResponse(PHONE, '2')).toBe(true);            // se usa hoy → (auto activación, deriva proyecto) → cantidad
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
          { id: 'act-1', activation_date: '2026-08-12', location_name: 'Jumbo Maipú', project_id: 'proj-1' },
          { id: 'act-2', activation_date: '2026-08-11', location_name: 'Líder Centro', project_id: 'proj-2' },
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
    // #7a · elegir act-2 por número deriva su proyecto (proj-2), no el de otra activación.
    expect(dto).toMatchObject({ tipo: 'consumo', activacion_id: 'act-2', proyecto_destino_id: 'proj-2', cantidad: 3 });
    expect(dto.bodega_origen_id).toBeUndefined();
    expect(store[PHONE]).toBeUndefined();
  });

  it('#7a · askActivacion lista todas las vigentes (proyecto en null) y DERIVA el proyecto de la activación (COALESCE)', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes("status='active'")) return Promise.resolve([{ id: 'proj-1', name: 'Proyecto Uno' }]);
      if (sql.includes('FROM activations') && sql.includes('estado_f5')) {
        return Promise.resolve([{ id: 'act-1', activation_date: '2026-08-12', location_name: 'Jumbo', project_id: 'proj-9' }]);
      }
      return Promise.resolve([]);
    });

    await svc.start({ eventoCrudoId: 'evt-scope', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/x.jpg' });
    expect(await svc.handleResponse(PHONE, 'Silla')).toBe(true); // nombre → destino
    expect(await svc.handleResponse(PHONE, '2')).toBe(true);     // se usa hoy → askActivacion (1 vigente → auto)

    // #7a · el picker DERIVA el proyecto de la activación (COALESCE a.project_id, c.project_id)
    // y lista TODAS las vigentes: el proyecto NO se pasa como filtro (queda en null). La
    // garantía anti-contaminación del Anexo se mantiene: la activación fija el proyecto.
    const askCall = queryMock.mock.calls.find(
      (c: any[]) => c[0].includes('FROM activations') && c[0].includes('location_name'),
    );
    expect(askCall).toBeTruthy();
    expect(askCall[0]).toContain('COALESCE(a.project_id, c.project_id) AS project_id');
    expect(askCall[1]).toEqual([CLIENT, null]);
    // Una sola activación vigente → auto-seleccionada, y su proyecto quedó fijado.
    expect(store[PHONE].materialIntake?.proyectoId).toBe('proj-9');
  });

  it('retries on an invalid destino answer instead of proceeding', async () => {
    await svc.start({ eventoCrudoId: 'evt-badd', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'materials/x.jpg' });
    await svc.handleResponse(PHONE, 'Silla ACME'); // nombre → destino
    expect(store[PHONE]?.materialIntake?.step).toBe('destino');
    expect(await svc.handleResponse(PHONE, 'xyz')).toBe(true);
    expect(store[PHONE]?.materialIntake?.step).toBe('destino');
    expect(movimientos.create).not.toHaveBeenCalled();
  });

  // ── A3 · symptom 3 · destino step understands natural language ──────────────

  // Seed a session paused at step='destino' (post-proyecto), no walking from start().
  const seedDestino = (eventoCrudoId: string): void => {
    store[PHONE] = {
      state: 'awaiting_material', projects: [], base64: '', mimeType: '', caption: '',
      clientId: CLIENT, canalId: null, updatedAt: '', clarification: null,
      materialIntake: {
        eventoCrudoId, storagePath: 'materials/x.jpg', step: 'destino',
        attempts: 0, nombre: 'Silla', proyectoId: 'proj-1',
      },
    };
  };

  describe('resolveDestino (pure helper)', () => {
    const cases: [string, 'bodega' | 'consumo' | null][] = [
      // consumo keywords
      ['se usa hoy', 'consumo'],
      ['lo usamos ahora en el evento', 'consumo'],
      ['activación', 'consumo'],       // accent normalized
      ['va a la activacion', 'consumo'],
      ['uso hoy', 'consumo'],
      // bodega keywords
      ['va a bodega', 'bodega'],
      ['al deposito', 'bodega'],
      ['guardar en almacen', 'bodega'],
      ['queda en stock', 'bodega'],
      // both → null (never guess)
      ['no a bodega, se usa hoy', null],
      ['va a bodega y se usa hoy', null],
      // single-sided negation → null (R3-001: never route on a negated single set)
      ['no se usa hoy', null],
      ['no va a bodega', null],
      ['hoy no', null],
      ['tampoco se usa hoy', null],
      // neither → null
      ['xyz', null],
      ['no sé', null],
      // word boundary: "usualmente" must NOT match "usa"
      ['usualmente', null],
    ];

    it.each(cases)('resolveDestino(%j) → %s', (text, expected) => {
      expect(anySvc.resolveDestino(text)).toBe(expected);
    });
  });

  it('[A3] destino "se usa hoy" (NL) → consumo, no escalation', async () => {
    seedDestino('evt-nl-consumo');
    expect(await svc.handleResponse(PHONE, 'se usa hoy')).toBe(true);
    expect(store[PHONE]?.materialIntake?.destino).toBe('consumo');
    expect(store[PHONE]?.materialIntake?.attempts).toBe(0);
    // askActivacion ran (default mock auto-selects the single activation).
    const esc = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes("status='escalated'"),
    );
    expect(esc).toBeUndefined();
  });

  it('[A3] destino "va a bodega" (NL) → bodega, asks bodega', async () => {
    seedDestino('evt-nl-bodega');
    expect(await svc.handleResponse(PHONE, 'va a bodega')).toBe(true);
    expect(store[PHONE]?.materialIntake?.destino).toBe('bodega');
    expect(store[PHONE]?.materialIntake?.attempts).toBe(0);
  });

  it('[A3] destino "al deposito" (NL) → bodega', async () => {
    seedDestino('evt-nl-deposito');
    expect(await svc.handleResponse(PHONE, 'al deposito')).toBe(true);
    expect(store[PHONE]?.materialIntake?.destino).toBe('bodega');
  });

  it('[A3] destino "lo usamos ahora en el evento" (NL) → consumo', async () => {
    seedDestino('evt-nl-ahora');
    expect(await svc.handleResponse(PHONE, 'lo usamos ahora en el evento')).toBe(true);
    expect(store[PHONE]?.materialIntake?.destino).toBe('consumo');
  });

  it('[A3] destino accented "activación" (NL) → consumo', async () => {
    seedDestino('evt-nl-accent');
    expect(await svc.handleResponse(PHONE, 'activación')).toBe(true);
    expect(store[PHONE]?.materialIntake?.destino).toBe('consumo');
  });

  it('[A3] MIXED/NEGATED "no a bodega, se usa hoy" is NOT mis-picked → retryOrEscalate (safety net)', async () => {
    seedDestino('evt-nl-mixed');
    expect(await svc.handleResponse(PHONE, 'no a bodega, se usa hoy')).toBe(true);
    // Not mis-picked: destino stays undefined, step stays destino, attempts incremented.
    expect(store[PHONE]?.materialIntake?.destino).toBeUndefined();
    expect(store[PHONE]?.materialIntake?.step).toBe('destino');
    expect(store[PHONE]?.materialIntake?.attempts).toBe(1);
    expect(movimientos.create).not.toHaveBeenCalled();
  });

  it('[A3] word boundary: "usualmente" does NOT match "usa" → re-prompt (not consumo)', async () => {
    seedDestino('evt-nl-usual');
    expect(await svc.handleResponse(PHONE, 'usualmente')).toBe(true);
    expect(store[PHONE]?.materialIntake?.destino).toBeUndefined();
    expect(store[PHONE]?.materialIntake?.step).toBe('destino');
    expect(store[PHONE]?.materialIntake?.attempts).toBe(1);
  });

  it('[A3] repeated unclear destino input still reaches MAX_ATTEMPTS → escalates', async () => {
    seedDestino('evt-nl-esc');
    // First unclear → re-prompt (attempts 0→1), session alive.
    expect(await svc.handleResponse(PHONE, 'xyz')).toBe(true);
    expect(store[PHONE]?.materialIntake?.step).toBe('destino');
    expect(store[PHONE]?.materialIntake?.attempts).toBe(1);
    // Second unclear → MAX_ATTEMPTS → escalate + clear session.
    expect(await svc.handleResponse(PHONE, 'qwerty')).toBe(true);
    const esc = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE eventos_crudos') && sql.includes("status='escalated'"),
    );
    expect(esc).toBeDefined();
    expect(esc![1][1]).toContain('material_intake_max_attempts');
    expect(store[PHONE]).toBeUndefined();
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
    await svc.handleResponse(PHONE, 'Silla ACME');  // nombre → destino
    await svc.handleResponse(PHONE, '2');            // consumo → (auto activación) → cantidad
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
    await svc.handleResponse(PHONE, '1 Volumétrico\n2 muebles\n6 canastos'); // nombre → destino
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

  // ── A3 · natural language + echo-and-confirm for the LIST steps ─────────────

  describe('matchOption (pure helper)', () => {
    const projects = [
      { id: 'p1', label: 'Vega Motors - Test Drive Tour Mall' },
      { id: 'p2', label: 'Colectivo Fiesta - Trompo Azul Navidad 2027' },
    ];

    it('resolves a multi-word phrase to the option whose label contains those words', () => {
      expect(anySvc.matchOption('el de vega motors', projects)).toBe(0);
    });

    it('resolves a unique single-word match', () => {
      expect(anySvc.matchOption('navidad', projects)).toBe(1);
    });

    it('returns null on a tie (a token matches two options equally)', () => {
      const tie = [
        { id: 'a', label: 'Banner Coca Cola' },
        { id: 'b', label: 'Afiche Coca Cola' },
      ];
      expect(anySvc.matchOption('coca cola', tie)).toBeNull();
    });

    it('returns null when no significant token matches any option', () => {
      expect(anySvc.matchOption('xyz', projects)).toBeNull();
    });

    it('returns null when the input is only stopwords / short tokens', () => {
      expect(anySvc.matchOption('el de la', projects)).toBeNull();
    });

    it('matches WHOLE words only: a label word that is a substring of an input token does NOT match', () => {
      // 'motorizado' contains 'motor' as a substring but is not the whole word
      // 'motor'; whole-word scoring must NOT count it as a hit.
      const opts = [{ id: 'x', label: 'Motor Show' }, { id: 'y', label: 'Feria Gastronomica' }];
      expect(anySvc.matchOption('motorizado gastronomia', opts)).toBeNull();
    });
  });

  describe('list step NL + echo-and-confirm', () => {
    const seedStep = (
      step: 'proyecto' | 'bodega' | 'activacion' | 'confirmacion',
      extra: Partial<NonNullable<WhatsAppSession['materialIntake']>>,
    ): void => {
      store[PHONE] = {
        state: 'awaiting_material', projects: [], base64: '', mimeType: '', caption: '',
        clientId: CLIENT, canalId: null, updatedAt: '', clarification: null,
        materialIntake: {
          eventoCrudoId: `evt-${step}`, storagePath: 'materials/x.jpg', step,
          attempts: 0, nombre: 'Silla', ...extra,
        },
      };
    };

    it('[proyecto] free text "vega motors" → confirmacion step, pendingConfirm set, echo message sent', async () => {
      seedStep('proyecto', {
        projects: [
          { id: 'p1', name: 'Vega Motors - Test Drive Tour Mall' },
          { id: 'p2', name: 'Colectivo Fiesta - Trompo Azul Navidad 2027' },
        ],
      });
      expect(await svc.handleResponse(PHONE, 'vega motors')).toBe(true);
      expect(store[PHONE]?.materialIntake?.step).toBe('confirmacion');
      expect(store[PHONE]?.materialIntake?.pendingConfirm).toMatchObject({ forStep: 'proyecto', optionId: 'p1' });
      const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
      expect(msg).toMatch(/¿Te referís a \*Vega Motors/i);
    });

    it('[proyecto] then "sí" → proyectoId=p1, proceeds to bodega (askBodega) — #7a: el proyecto solo se confirma en la rama bodega', async () => {
      seedStep('confirmacion', {
        destino: 'bodega',
        projects: [
          { id: 'p1', name: 'Vega Motors - Test Drive Tour Mall' },
          { id: 'p2', name: 'Colectivo Fiesta - Trompo Azul Navidad 2027' },
        ],
        pendingConfirm: { forStep: 'proyecto', optionId: 'p1', label: 'Vega Motors - Test Drive Tour Mall' },
      });
      expect(await svc.handleResponse(PHONE, 'sí')).toBe(true);
      expect(store[PHONE]?.materialIntake?.proyectoId).toBe('p1');
      expect(store[PHONE]?.materialIntake?.pendingConfirm == null).toBe(true);
      expect(store[PHONE]?.materialIntake?.step).toBe('bodega');
      const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
      expect(msg).toMatch(/bodega/i);
    });

    it('[proyecto] then "no" → step back to proyecto, list re-shown, pendingConfirm cleared', async () => {
      seedStep('confirmacion', {
        projects: [
          { id: 'p1', name: 'Vega Motors - Test Drive Tour Mall' },
          { id: 'p2', name: 'Colectivo Fiesta - Trompo Azul Navidad 2027' },
        ],
        pendingConfirm: { forStep: 'proyecto', optionId: 'p1', label: 'Vega Motors - Test Drive Tour Mall' },
      });
      expect(await svc.handleResponse(PHONE, 'no')).toBe(true);
      expect(store[PHONE]?.materialIntake?.step).toBe('proyecto');
      expect(store[PHONE]?.materialIntake?.pendingConfirm == null).toBe(true);
      expect(store[PHONE]?.materialIntake?.proyectoId).toBeUndefined();
      const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
      expect(msg).toContain('Vega Motors - Test Drive Tour Mall');
      expect(msg).toContain('Colectivo Fiesta - Trompo Azul Navidad 2027');
    });

    it('[proyecto] no-match free text → retryOrEscalate (unchanged), no confirmacion', async () => {
      seedStep('proyecto', {
        projects: [
          { id: 'p1', name: 'Vega Motors - Test Drive Tour Mall' },
          { id: 'p2', name: 'Colectivo Fiesta - Trompo Azul Navidad 2027' },
        ],
      });
      expect(await svc.handleResponse(PHONE, 'zzz qqq')).toBe(true);
      expect(store[PHONE]?.materialIntake?.step).toBe('proyecto');
      expect(store[PHONE]?.materialIntake?.attempts).toBe(1);
      expect(store[PHONE]?.materialIntake?.pendingConfirm == null).toBe(true);
    });

    it('[proyecto] repeated no-match free text escalates at MAX_ATTEMPTS', async () => {
      seedStep('proyecto', {
        projects: [
          { id: 'p1', name: 'Vega Motors - Test Drive Tour Mall' },
          { id: 'p2', name: 'Colectivo Fiesta - Trompo Azul Navidad 2027' },
        ],
      });
      expect(await svc.handleResponse(PHONE, 'zzz qqq')).toBe(true);
      expect(store[PHONE]?.materialIntake?.attempts).toBe(1);
      expect(await svc.handleResponse(PHONE, 'www vvv')).toBe(true);
      const esc = queryMock.mock.calls.find(
        ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE eventos_crudos') && sql.includes("status='escalated'"),
      );
      expect(esc).toBeDefined();
      expect(store[PHONE]).toBeUndefined();
    });

    it('[confirmacion] unclear yes/no ("tal vez") → retryOrEscalate (keeps attempt budget)', async () => {
      seedStep('confirmacion', {
        projects: [{ id: 'p1', name: 'Vega Motors - Test Drive Tour Mall' }],
        pendingConfirm: { forStep: 'proyecto', optionId: 'p1', label: 'Vega Motors - Test Drive Tour Mall' },
      });
      expect(await svc.handleResponse(PHONE, 'tal vez')).toBe(true);
      expect(store[PHONE]?.materialIntake?.step).toBe('confirmacion');
      expect(store[PHONE]?.materialIntake?.attempts).toBe(1);
      expect(store[PHONE]?.materialIntake?.proyectoId).toBeUndefined();
    });

    it('[confirmacion] repeated "no" is bounded: eventually escalates (no infinite loop)', async () => {
      seedStep('confirmacion', {
        projects: [
          { id: 'p1', name: 'Vega Motors - Test Drive Tour Mall' },
          { id: 'p2', name: 'Colectivo Fiesta - Trompo Azul Navidad 2027' },
        ],
        attempts: 1, // already spent one attempt
        pendingConfirm: { forStep: 'proyecto', optionId: 'p1', label: 'Vega Motors - Test Drive Tour Mall' },
      });
      // "no" → re-show list, but the attempt budget still ticks and escalates at MAX.
      expect(await svc.handleResponse(PHONE, 'no')).toBe(true);
      const esc = queryMock.mock.calls.find(
        ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE eventos_crudos') && sql.includes("status='escalated'"),
      );
      expect(esc).toBeDefined();
      expect(store[PHONE]).toBeUndefined();
    });

    it('[confirmacion] full cycle match→no→re-match→no through the dispatcher is bounded (escalates, no infinite loop)', async () => {
      seedStep('proyecto', {
        projects: [
          { id: 'p1', name: 'Vega Motors - Test Drive Tour Mall' },
          { id: 'p2', name: 'Colectivo Fiesta - Trompo Azul Navidad 2027' },
        ],
      });
      // match #1 (attempts stays 0 on the tentative match) → confirmacion
      expect(await svc.handleResponse(PHONE, 'vega motors')).toBe(true);
      expect(store[PHONE]?.materialIntake?.step).toBe('confirmacion');
      // no #1 → back to proyecto, attempts 0→1
      expect(await svc.handleResponse(PHONE, 'no')).toBe(true);
      expect(store[PHONE]?.materialIntake?.step).toBe('proyecto');
      expect(store[PHONE]?.materialIntake?.attempts).toBe(1);
      // re-match same text → confirmacion again (attempts NOT reset — carries 1)
      expect(await svc.handleResponse(PHONE, 'vega motors')).toBe(true);
      expect(store[PHONE]?.materialIntake?.step).toBe('confirmacion');
      expect(store[PHONE]?.materialIntake?.attempts).toBe(1);
      // no #2 → reaches MAX_ATTEMPTS → escalate + clear session (no loop).
      expect(await svc.handleResponse(PHONE, 'no')).toBe(true);
      const esc = queryMock.mock.calls.find(
        ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE eventos_crudos') && sql.includes("status='escalated'"),
      );
      expect(esc).toBeDefined();
      expect(store[PHONE]).toBeUndefined();
    });

    it('[bodega] free text → confirm → "sí" applies bodegaId and proceeds to proceedToCantidad', async () => {
      seedStep('bodega', {
        proyectoId: 'proj-1', destino: 'bodega',
        bodegas: [
          { id: 'bod-1', name: 'Bodega Central' },
          { id: 'bod-2', name: 'Regional Norte' },
        ],
        items: [{ nombre: 'Silla', cantidad: null }],
      });
      expect(await svc.handleResponse(PHONE, 'central')).toBe(true);
      expect(store[PHONE]?.materialIntake?.step).toBe('confirmacion');
      expect(store[PHONE]?.materialIntake?.pendingConfirm).toMatchObject({ forStep: 'bodega', optionId: 'bod-1' });

      expect(await svc.handleResponse(PHONE, 'dale')).toBe(true);
      expect(store[PHONE]?.materialIntake?.bodegaId).toBe('bod-1');
      // single item without inline qty → proceedToCantidad asks quantity.
      expect(store[PHONE]?.materialIntake?.step).toBe('cantidad');
    });

    it('[activacion] free text → confirm → "sí" applies activacionId and proceeds to proceedToCantidad', async () => {
      seedStep('activacion', {
        proyectoId: 'proj-1', destino: 'consumo',
        activaciones: [
          { id: 'act-1', label: 'Jumbo Maipú · 12-08-2026' },
          { id: 'act-2', label: 'Líder Centro · 11-08-2026' },
        ],
        items: [{ nombre: 'Silla', cantidad: null }],
      });
      expect(await svc.handleResponse(PHONE, 'jumbo maipu')).toBe(true);
      expect(store[PHONE]?.materialIntake?.step).toBe('confirmacion');
      expect(store[PHONE]?.materialIntake?.pendingConfirm).toMatchObject({ forStep: 'activacion', optionId: 'act-1' });

      expect(await svc.handleResponse(PHONE, 'correcto')).toBe(true);
      expect(store[PHONE]?.materialIntake?.activacionId).toBe('act-1');
      expect(store[PHONE]?.materialIntake?.step).toBe('cantidad');
    });

    // ── R3-003 · bodega & activacion NO paths + loop termination ──────────────

    it('[bodega] free text → confirm → "no" re-shows the list, then a fresh match + "sí" applies bodegaId', async () => {
      seedStep('bodega', {
        proyectoId: 'proj-1', destino: 'bodega',
        bodegas: [
          { id: 'bod-1', name: 'Bodega Central' },
          { id: 'bod-2', name: 'Regional Norte' },
        ],
        items: [{ nombre: 'Silla', cantidad: null }],
      });

      // Free text uniquely matches one bodega → confirmacion, pendingConfirm parked.
      expect(await svc.handleResponse(PHONE, 'central')).toBe(true);
      expect(store[PHONE]?.materialIntake?.step).toBe('confirmacion');
      expect(store[PHONE]?.materialIntake?.pendingConfirm).toMatchObject({ forStep: 'bodega', optionId: 'bod-1' });

      // "no" → step back to bodega, list re-shown, pendingConfirm cleared, attempts incremented.
      expect(await svc.handleResponse(PHONE, 'no')).toBe(true);
      expect(store[PHONE]?.materialIntake?.step).toBe('bodega');
      expect(store[PHONE]?.materialIntake?.pendingConfirm == null).toBe(true);
      expect(store[PHONE]?.materialIntake?.bodegaId).toBeUndefined();
      expect(store[PHONE]?.materialIntake?.attempts).toBe(1);
      const listMsg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
      expect(listMsg).toContain('Bodega Central');
      expect(listMsg).toContain('Regional Norte');

      // Fresh match on the other bodega → confirmacion again → "sí" applies + proceeds.
      expect(await svc.handleResponse(PHONE, 'regional')).toBe(true);
      expect(store[PHONE]?.materialIntake?.pendingConfirm).toMatchObject({ forStep: 'bodega', optionId: 'bod-2' });
      expect(await svc.handleResponse(PHONE, 'sí')).toBe(true);
      expect(store[PHONE]?.materialIntake?.bodegaId).toBe('bod-2');
      // single item without inline qty → proceedToCantidad asks quantity.
      expect(store[PHONE]?.materialIntake?.step).toBe('cantidad');
    });

    it('[activacion] free text → confirm → "no" re-shows the list, then a fresh match + "sí" applies activacionId', async () => {
      seedStep('activacion', {
        proyectoId: 'proj-1', destino: 'consumo',
        activaciones: [
          { id: 'act-1', label: 'Jumbo Maipú · 12-08-2026' },
          { id: 'act-2', label: 'Líder Centro · 11-08-2026' },
        ],
        items: [{ nombre: 'Silla', cantidad: null }],
      });

      expect(await svc.handleResponse(PHONE, 'jumbo maipu')).toBe(true);
      expect(store[PHONE]?.materialIntake?.step).toBe('confirmacion');
      expect(store[PHONE]?.materialIntake?.pendingConfirm).toMatchObject({ forStep: 'activacion', optionId: 'act-1' });

      // "no" → back to activacion, list re-shown, pendingConfirm cleared, attempts incremented.
      expect(await svc.handleResponse(PHONE, 'no')).toBe(true);
      expect(store[PHONE]?.materialIntake?.step).toBe('activacion');
      expect(store[PHONE]?.materialIntake?.pendingConfirm == null).toBe(true);
      expect(store[PHONE]?.materialIntake?.activacionId).toBeUndefined();
      expect(store[PHONE]?.materialIntake?.attempts).toBe(1);
      const listMsg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
      expect(listMsg).toContain('Jumbo Maipú');
      expect(listMsg).toContain('Líder Centro');

      // Fresh match on the other activación → confirmacion again → "sí" applies + proceeds.
      expect(await svc.handleResponse(PHONE, 'lider centro')).toBe(true);
      expect(store[PHONE]?.materialIntake?.pendingConfirm).toMatchObject({ forStep: 'activacion', optionId: 'act-2' });
      expect(await svc.handleResponse(PHONE, 'sí')).toBe(true);
      expect(store[PHONE]?.materialIntake?.activacionId).toBe('act-2');
      expect(store[PHONE]?.materialIntake?.step).toBe('cantidad');
    });

    it('[bodega] full cycle match→no→re-match→no through the dispatcher is bounded (escalates, no infinite loop)', async () => {
      seedStep('bodega', {
        proyectoId: 'proj-1', destino: 'bodega',
        bodegas: [
          { id: 'bod-1', name: 'Bodega Central' },
          { id: 'bod-2', name: 'Regional Norte' },
        ],
        items: [{ nombre: 'Silla', cantidad: null }],
      });
      // match #1 (attempts stays 0 on the tentative match) → confirmacion
      expect(await svc.handleResponse(PHONE, 'central')).toBe(true);
      expect(store[PHONE]?.materialIntake?.step).toBe('confirmacion');
      // no #1 → back to bodega, attempts 0→1
      expect(await svc.handleResponse(PHONE, 'no')).toBe(true);
      expect(store[PHONE]?.materialIntake?.step).toBe('bodega');
      expect(store[PHONE]?.materialIntake?.attempts).toBe(1);
      // re-match same text → confirmacion again (attempts NOT reset — carries 1)
      expect(await svc.handleResponse(PHONE, 'central')).toBe(true);
      expect(store[PHONE]?.materialIntake?.step).toBe('confirmacion');
      expect(store[PHONE]?.materialIntake?.attempts).toBe(1);
      // no #2 → reaches MAX_ATTEMPTS → escalate + clear session (no loop).
      expect(await svc.handleResponse(PHONE, 'no')).toBe(true);
      const esc = queryMock.mock.calls.find(
        ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE eventos_crudos') && sql.includes("status='escalated'"),
      );
      expect(esc).toBeDefined();
      expect(store[PHONE]).toBeUndefined();
    });

    it('[confirmacion] "no sé" is UNCLEAR (re-ask sí/no), NOT a definitive NO: keeps confirmacion step + pendingConfirm, does NOT re-show the list', async () => {
      seedStep('confirmacion', {
        projects: [
          { id: 'p1', name: 'Vega Motors - Test Drive Tour Mall' },
          { id: 'p2', name: 'Colectivo Fiesta - Trompo Azul Navidad 2027' },
        ],
        pendingConfirm: { forStep: 'proyecto', optionId: 'p1', label: 'Vega Motors - Test Drive Tour Mall' },
      });
      expect(await svc.handleResponse(PHONE, 'no sé')).toBe(true);
      // UNCLEAR branch: still at confirmacion, selection stays parked, attempt spent.
      expect(store[PHONE]?.materialIntake?.step).toBe('confirmacion');
      expect(store[PHONE]?.materialIntake?.pendingConfirm).toMatchObject({ forStep: 'proyecto', optionId: 'p1' });
      expect(store[PHONE]?.materialIntake?.proyectoId).toBeUndefined();
      expect(store[PHONE]?.materialIntake?.attempts).toBe(1);
      // Must NOT re-show the list (that is the plain-"no" behavior, not UNCLEAR).
      const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
      expect(msg).not.toContain('Vega Motors - Test Drive Tour Mall');
      expect(msg).not.toContain('Colectivo Fiesta - Trompo Azul Navidad 2027');
      // Re-asks the yes/no prompt.
      expect(msg).toMatch(/s[ií].*o.*no/i);
    });
  });

});
