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

  describe('closingLine', () => {
    it('is a non-technical "done, start another" line', () => {
      const c = service.closingLine();
      expect(c).toMatch(/list[oa]|terminad|otra cosa/i);
      expect(c).not.toMatch(/error|null|undefined|flow|session/i);
    });
  });
});
