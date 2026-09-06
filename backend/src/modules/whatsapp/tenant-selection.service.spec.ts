/// <reference types="jest" />
import { WhatsAppTenantSelectionService } from './tenant-selection.service';
import { ClientCandidate } from './sender-tenant-resolver.service';

describe('WhatsAppTenantSelectionService', () => {
  const service = new WhatsAppTenantSelectionService();

  const candidates: ClientCandidate[] = [
    // rota es irrelevante para buildPrompt/parseSelection (con 2 candidatos siempre
    // se pregunta); se usa el default conservador true solo para satisfacer el tipo.
    { clientId: 'c1', clientName: 'Agencia Uno', rota: true },
    { clientId: 'c2', clientName: 'Agencia Dos', rota: true },
  ];

  describe('buildPrompt', () => {
    it('asks which agency, lists every candidate, and offers "otra agencia" as the last option', () => {
      const prompt = service.buildPrompt(candidates);

      expect(prompt).toContain('¿Para qué agencia');
      expect(prompt).toContain('1) Agencia Uno');
      expect(prompt).toContain('2) Agencia Dos');
      // The extra option lets an already-affiliated sender operate for a NEW agency.
      expect(prompt).toContain('3) Otra agencia');
    });
  });

  describe('buildCodePrompt', () => {
    it('asks for the affiliation code', () => {
      expect(service.buildCodePrompt()).toMatch(/código de afiliación/i);
    });

    // P14 — el sub-estado del código no tenía salida anunciada: quien caía acá por
    // error sólo salía acertando un código o fallando 5 veces. El prompt debe ofrecer
    // "cancelar" como salida explícita.
    it('announces "cancelar" as an explicit way out', () => {
      expect(service.buildCodePrompt()).toMatch(/cancelar/i);
    });
  });

  describe('parseSelection', () => {
    it('resolves a candidate for a valid numbered reply', () => {
      expect(service.parseSelection('1', candidates)).toEqual({ kind: 'client', clientId: 'c1' });
      expect(service.parseSelection('2', candidates)).toEqual({ kind: 'client', clientId: 'c2' });
    });

    it('resolves the "otra agencia" option (index just past the candidates)', () => {
      expect(service.parseSelection('3', candidates)).toEqual({ kind: 'other' });
    });

    it('tolerates surrounding whitespace', () => {
      expect(service.parseSelection('  2  ', candidates)).toEqual({ kind: 'client', clientId: 'c2' });
    });

    it('is invalid for a non-numeric reply', () => {
      expect(service.parseSelection('Agencia Uno', candidates)).toEqual({ kind: 'invalid' });
    });

    it('is invalid for an out-of-range number', () => {
      expect(service.parseSelection('0', candidates)).toEqual({ kind: 'invalid' });
      expect(service.parseSelection('4', candidates)).toEqual({ kind: 'invalid' });
    });

    it('is invalid for an empty reply', () => {
      expect(service.parseSelection('', candidates)).toEqual({ kind: 'invalid' });
    });
  });
});
