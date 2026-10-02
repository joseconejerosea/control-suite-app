/// <reference types="jest" />
import { ProjectsService } from './projects.service';

/**
 * T9 — Calendario global (read-only). getCalendarioGlobal aggregates convocatorias
 * across ALL projects of the tenant in a date range and derives coverage gaps.
 *
 * Gap definition (agreed): for each day in the project's [start_date,end_date] and
 * each local in config.ia_extracted.locales, the local is COVERED iff there is >=1
 * convocatoria that day with that local_nombre in estado 'confirmada'. Otherwise it
 * is a gap. gap.tiene_pendientes flags whether there are assigned-but-not-sent
 * ('pendiente') convocatorias for that same day/local — which the calendar's
 * "Convocar" shortcut can send in place.
 */
describe('ProjectsService.getCalendarioGlobal — gaps por local', () => {
  const clientId = 'client-1';

  function makeService(proyectos: any[], convocatorias: any[]): { svc: ProjectsService; query: jest.Mock } {
    const query = jest.fn((sql: string) => {
      if (/FROM convocatorias/i.test(sql)) return Promise.resolve(convocatorias);
      if (/FROM projects/i.test(sql)) return Promise.resolve(proyectos);
      return Promise.resolve([]);
    });
    const dataSource = { query, getRepository: jest.fn().mockReturnValue({}) } as any;
    const svc = new ProjectsService(dataSource, {} as any, {} as any, {} as any);
    return { svc, query };
  }

  const proyecto = {
    id: 'proj-1',
    name: 'Proyecto A',
    start_date: '2026-08-20',
    end_date: '2026-08-21',
    config: { ia_extracted: { locales: [{ nombre: 'Local Centro', direccion: 'Av 1' }] } },
  };

  const conv = (over: Partial<Record<string, any>>) => ({
    proyecto_id: 'proj-1',
    proyecto_nombre: 'Proyecto A',
    persona_id: 'p1',
    persona_nombre: 'Ana',
    dia: '2026-08-20',
    estado: 'enviada',
    local_nombre: 'Local Centro',
    local_direccion: 'Av 1',
    ...over,
  });

  it('marks a gap when a local/day has no confirmed convocatoria', async () => {
    const { svc } = makeService([proyecto], []);
    const res = await svc.getCalendarioGlobal(clientId, '2026-08-20', '2026-08-21');
    // 2 días × 1 local, ninguno confirmado → 2 gaps
    expect(res.gaps).toHaveLength(2);
    expect(res.gaps[0]).toMatchObject({
      proyecto_id: 'proj-1',
      local_nombre: 'Local Centro',
      tiene_pendientes: false,
    });
  });

  it('does NOT mark a gap when a confirmed convocatoria exists that day/local', async () => {
    const { svc } = makeService([proyecto], [conv({ dia: '2026-08-20', estado: 'confirmada' })]);
    const res = await svc.getCalendarioGlobal(clientId, '2026-08-20', '2026-08-21');
    // día 20 cubierto, día 21 no → 1 gap (día 21)
    expect(res.gaps).toHaveLength(1);
    expect(res.gaps[0].dia).toBe('2026-08-21');
  });

  it('flags tiene_pendientes=true when an assigned-but-unsent (pendiente) row exists', async () => {
    const { svc } = makeService([proyecto], [conv({ dia: '2026-08-20', estado: 'pendiente' })]);
    const res = await svc.getCalendarioGlobal(clientId, '2026-08-20', '2026-08-20');
    expect(res.gaps).toHaveLength(1);
    expect(res.gaps[0].tiene_pendientes).toBe(true);
  });

  it('returns the range convocatorias for rendering', async () => {
    const rows = [conv({ estado: 'enviada' })];
    const { svc } = makeService([proyecto], rows);
    const res = await svc.getCalendarioGlobal(clientId, '2026-08-20', '2026-08-21');
    expect(res.convocatorias).toEqual(rows);
  });

  it('derives no gaps when the project has no locales configured', async () => {
    const sinLocales = { ...proyecto, config: { ia_extracted: {} } };
    const { svc } = makeService([sinLocales], []);
    const res = await svc.getCalendarioGlobal(clientId, '2026-08-20', '2026-08-21');
    expect(res.gaps).toHaveLength(0);
  });

  it('clamps gap derivation to the intersection of the query range and the project range', async () => {
    // Proyecto corre 20–25, pero consultamos sólo 22–23 → 2 gaps (un local, 2 días).
    const largo = { ...proyecto, start_date: '2026-08-20', end_date: '2026-08-25' };
    const { svc } = makeService([largo], []);
    const res = await svc.getCalendarioGlobal(clientId, '2026-08-22', '2026-08-23');
    expect(res.gaps.map((g) => g.dia)).toEqual(['2026-08-22', '2026-08-23']);
  });

  // B-001/B-002: la columna DATE debe volver como texto 'YYYY-MM-DD' (::text),
  // si no, node-pg la decodifica a un JS Date y el match por día ISO nunca pega.
  it('casts convocatorias.dia to text in the SQL (guards B-001)', async () => {
    const { svc, query } = makeService([proyecto], []);
    await svc.getCalendarioGlobal(clientId, '2026-08-20', '2026-08-21');
    const convSql = query.mock.calls
      .map((c) => String(c[0]))
      .find((sql) => /FROM convocatorias/i.test(sql));
    expect(convSql).toBeDefined();
    expect(convSql).toMatch(/dia::text/i);
  });

  // Misma clase que B-001 pero en la query de proyectos: start_date/end_date son
  // DATE → sin ::text vuelven como JS Date y eachISODayInclusive los parsea a
  // Invalid Date → cero días → cero gaps (bug detectado en test en vivo).
  it('casts projects.start_date/end_date to text in the SQL', async () => {
    const { svc, query } = makeService([proyecto], []);
    await svc.getCalendarioGlobal(clientId, '2026-08-20', '2026-08-21');
    const projSql = query.mock.calls
      .map((c) => String(c[0]))
      .find((sql) => /FROM projects/i.test(sql) && /aprobado/i.test(sql));
    expect(projSql).toBeDefined();
    expect(projSql).toMatch(/start_date::text/i);
    expect(projSql).toMatch(/end_date::text/i);
  });

  // A-002: nombres de local tipeados a mano / con espacios o mayúsculas no deben
  // generar falsos gaps — la comparación es normalizada (trim + lowercase).
  it('matches local names case/whitespace-insensitively (A-002)', async () => {
    const { svc } = makeService(
      [proyecto],
      [conv({ dia: '2026-08-20', estado: 'confirmada', local_nombre: '  local centro ' })],
    );
    const res = await svc.getCalendarioGlobal(clientId, '2026-08-20', '2026-08-20');
    // 'Local Centro' (config) vs '  local centro ' (conv) → cubierto, sin gap.
    expect(res.gaps).toHaveLength(0);
  });

  // A-003/B-003: cada gap expone el estado de aprobación del proyecto para gatear
  // el botón "Convocar" en el front (evita 403 / CONVOCATORIA_NO_APROBADA).
  it('reflects the project approval state on each gap (A-003)', async () => {
    const aprobado = { ...proyecto, aprobado: true };
    const { svc } = makeService([aprobado], []);
    const res = await svc.getCalendarioGlobal(clientId, '2026-08-20', '2026-08-21');
    expect(res.gaps.length).toBeGreaterThan(0);
    expect(res.gaps.every((g) => g.aprobado === true)).toBe(true);

    const sinAprobar = { ...proyecto, aprobado: false };
    const { svc: svc2 } = makeService([sinAprobar], []);
    const res2 = await svc2.getCalendarioGlobal(clientId, '2026-08-20', '2026-08-21');
    expect(res2.gaps.length).toBeGreaterThan(0);
    expect(res2.gaps.every((g) => g.aprobado === false)).toBe(true);
  });
});
