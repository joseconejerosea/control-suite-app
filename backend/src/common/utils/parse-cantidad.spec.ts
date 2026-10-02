import { parseCantidadCL } from './parse-cantidad';

describe('parseCantidadCL · truncamiento chileno', () => {
  it('formato chileno con separador de miles: "4.800" → 4800 (no 4)', () => {
    expect(parseCantidadCL('4.800')).toBe(4800);
  });

  it('múltiples separadores: "1.234.567" → 1234567', () => {
    expect(parseCantidadCL('1.234.567')).toBe(1234567);
  });

  it('entero simple como string: "12" → 12', () => {
    expect(parseCantidadCL('12')).toBe(12);
  });

  it('number nativo (viene del JSONB de devoluciones): 4800 → 4800', () => {
    expect(parseCantidadCL(4800)).toBe(4800);
  });

  it('cero: "0" → 0 (no null)', () => {
    expect(parseCantidadCL('0')).toBe(0);
  });

  it('vacío / null / undefined → null (el caller elige el default)', () => {
    expect(parseCantidadCL('')).toBeNull();
    expect(parseCantidadCL(null)).toBeNull();
    expect(parseCantidadCL(undefined)).toBeNull();
  });

  it('texto no numérico → null', () => {
    expect(parseCantidadCL('abc')).toBeNull();
  });
});
