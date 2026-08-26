/// <reference types="jest" />
import { WhatsAppActionMenuService } from './action-menu.service';

describe('WhatsAppActionMenuService', () => {
  const service = new WhatsAppActionMenuService();

  describe('buildMenu', () => {
    it('lists the four things a person can send, numbered', () => {
      const m = service.buildMenu();
      expect(m).toMatch(/¿Qué querés hacer/i);
      expect(m).toContain('1)');
      expect(m).toMatch(/factura|boleta/i);
      expect(m).toContain('2)');
      expect(m).toMatch(/material/i);
      expect(m).toContain('3)');
      expect(m).toMatch(/evidencia/i);
      expect(m).toContain('4)');
      expect(m).toMatch(/ubicación|ubicacion/i);
    });
  });

  describe('parse', () => {
    it('maps 1-4 to the corresponding action', () => {
      expect(service.parse('1')).toEqual({ kind: 'factura' });
      expect(service.parse('2')).toEqual({ kind: 'material' });
      expect(service.parse('3')).toEqual({ kind: 'evidencia' });
      expect(service.parse('4')).toEqual({ kind: 'ubicacion' });
    });

    it('tolerates surrounding whitespace', () => {
      expect(service.parse('  2  ')).toEqual({ kind: 'material' });
    });

    it('is invalid for out-of-range, non-numeric or empty replies', () => {
      expect(service.parse('0')).toEqual({ kind: 'invalid' });
      expect(service.parse('5')).toEqual({ kind: 'invalid' });
      expect(service.parse('factura')).toEqual({ kind: 'invalid' });
      expect(service.parse('')).toEqual({ kind: 'invalid' });
    });
  });

  describe('buildGuide', () => {
    it('tells the sender what to send for each media action', () => {
      expect(service.buildGuide('factura')).toMatch(/foto/i);
      expect(service.buildGuide('material')).toMatch(/foto/i);
      expect(service.buildGuide('evidencia')).toMatch(/foto/i);
      expect(service.buildGuide('ubicacion')).toMatch(/ubicación|ubicacion/i);
    });
  });

  describe('buildTypeMenu', () => {
    it('asks what the photo is with only the 3 photo types (no ubicación)', () => {
      const m = service.buildTypeMenu();
      expect(m).toMatch(/¿Qué es esta foto/i);
      expect(m).toContain('1)');
      expect(m).toMatch(/factura|boleta/i);
      expect(m).toContain('2)');
      expect(m).toMatch(/material/i);
      expect(m).toContain('3)');
      expect(m).toMatch(/evidencia/i);
      // ubicación is a GPS pin, not a photo → never offered here.
      expect(m).not.toMatch(/ubicación|ubicacion/i);
      expect(m).not.toContain('4)');
    });
  });

  describe('parseType', () => {
    it('maps 1/2/3 to the photo type', () => {
      expect(service.parseType('1')).toBe('factura');
      expect(service.parseType('2')).toBe('material');
      expect(service.parseType('3')).toBe('evidencia');
    });

    it('tolerates surrounding whitespace', () => {
      expect(service.parseType('  2  ')).toBe('material');
    });

    it('is invalid for out-of-range, non-numeric or empty replies', () => {
      expect(service.parseType('0')).toBe('invalid');
      expect(service.parseType('4')).toBe('invalid');
      expect(service.parseType('factura')).toBe('invalid');
      expect(service.parseType('')).toBe('invalid');
    });
  });

  describe('closingLine', () => {
    it('is a non-technical "done, start another" line', () => {
      const c = service.closingLine();
      expect(c).toMatch(/list[oa]|terminad|otra cosa/i);
      expect(c).not.toMatch(/error|null|undefined|flow|session/i);
    });
  });
});

describe('WhatsAppActionMenuService · isGreeting', () => {
  const service = new WhatsAppActionMenuService();

  const positives = [
    'hola',
    'Hola',
    'HOLA',
    'holaa',
    'buenas',
    'buenos dias',
    'buenos días',
    'buenas tardes',
    'buenas noches',
    'hey',
    'hi',
    'hello',
    'menu',
    'menú',
    'inicio',
    'empezar',
    'reiniciar',
    'volver',
    // trailing punctuation and surrounding whitespace are tolerated
    'Hola!',
    'buenas.',
    '  hola  ',
  ];

  it.each(positives)('returns true for a plain greeting/restart word: %p', (text) => {
    expect(service.isGreeting(text)).toBe(true);
  });

  const negatives = [
    '1',
    '3',
    '45000',
    '',
    'hola quiero cargar una factura',
    'buenas ondas srl',
  ];

  it.each(negatives)('returns false for a non-greeting message: %p', (text) => {
    expect(service.isGreeting(text)).toBe(false);
  });

  it('guards against null/undefined input', () => {
    expect(service.isGreeting(null as unknown as string)).toBe(false);
    expect(service.isGreeting(undefined as unknown as string)).toBe(false);
  });
});
