/// <reference types="jest" />
import { SAFE_MESSAGES } from './safe-messages';

describe('SAFE_MESSAGES', () => {
  it('is a frozen object', () => {
    expect(Object.isFrozen(SAFE_MESSAGES)).toBe(true);
  });

  it('has exactly 5 keys', () => {
    expect(Object.keys(SAFE_MESSAGES)).toHaveLength(5);
  });

  it('contains all required category keys', () => {
    expect(SAFE_MESSAGES).toHaveProperty('INTEGRATION_FAILURE');
    expect(SAFE_MESSAGES).toHaveProperty('CONFIG_ERROR');
    expect(SAFE_MESSAGES).toHaveProperty('TIMEOUT');
    expect(SAFE_MESSAGES).toHaveProperty('UNEXPECTED');
    expect(SAFE_MESSAGES).toHaveProperty('VALIDATION');
  });

  it('all values are non-empty strings', () => {
    for (const value of Object.values(SAFE_MESSAGES)) {
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    }
  });

  it('all values are distinct (no two categories share the same message)', () => {
    const values = Object.values(SAFE_MESSAGES);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('INTEGRATION_FAILURE conveys external service failure intent', () => {
    expect(SAFE_MESSAGES.INTEGRATION_FAILURE).toContain('servicio externo');
  });

  it('CONFIG_ERROR conveys configuration/administrator intent', () => {
    expect(SAFE_MESSAGES.CONFIG_ERROR).toContain('configuración');
  });

  it('TIMEOUT conveys cancelled/slow operation intent', () => {
    expect(SAFE_MESSAGES.TIMEOUT).toContain('cancelada');
  });

  it('UNEXPECTED is a generic safe Spanish string', () => {
    expect(SAFE_MESSAGES.UNEXPECTED).toContain('error inesperado');
  });

  it('VALIDATION conveys invalid data intent', () => {
    expect(SAFE_MESSAGES.VALIDATION).toContain('válidos');
  });
});
