/// <reference types="jest" />
import { isRota, PROMOTOR_ROL_TIPO_MEMBERS, ROTATING_ROLES } from './role-rota.util';

describe('PROMOTOR_ROL_TIPO_MEMBERS', () => {
  it('contains exactly 7 members', () => {
    expect(PROMOTOR_ROL_TIPO_MEMBERS).toHaveLength(7);
  });

  it('includes all expected enum values', () => {
    expect(PROMOTOR_ROL_TIPO_MEMBERS).toContain('promotor');
    expect(PROMOTOR_ROL_TIPO_MEMBERS).toContain('anfitrion');
    expect(PROMOTOR_ROL_TIPO_MEMBERS).toContain('productor');
    expect(PROMOTOR_ROL_TIPO_MEMBERS).toContain('supervisor');
    expect(PROMOTOR_ROL_TIPO_MEMBERS).toContain('coordinador');
    expect(PROMOTOR_ROL_TIPO_MEMBERS).toContain('brand_manager');
    expect(PROMOTOR_ROL_TIPO_MEMBERS).toContain('observer');
  });
});

describe('ROTATING_ROLES', () => {
  it('contains {promotor, anfitrion, productor}', () => {
    expect(ROTATING_ROLES.has('promotor')).toBe(true);
    expect(ROTATING_ROLES.has('anfitrion')).toBe(true);
    expect(ROTATING_ROLES.has('productor')).toBe(true);
  });

  it('does not contain non-rotating roles', () => {
    expect(ROTATING_ROLES.has('supervisor')).toBe(false);
    expect(ROTATING_ROLES.has('coordinador')).toBe(false);
    expect(ROTATING_ROLES.has('brand_manager')).toBe(false);
    expect(ROTATING_ROLES.has('observer')).toBe(false);
  });
});

describe('isRota', () => {
  // Roles rotativos → true
  it('returns true for promotor', () => {
    expect(isRota('promotor')).toBe(true);
  });

  it('returns true for anfitrion', () => {
    expect(isRota('anfitrion')).toBe(true);
  });

  it('returns true for productor', () => {
    expect(isRota('productor')).toBe(true);
  });

  // Roles no-rotativos → false
  it('returns false for supervisor', () => {
    expect(isRota('supervisor')).toBe(false);
  });

  it('returns false for coordinador', () => {
    expect(isRota('coordinador')).toBe(false);
  });

  it('returns false for brand_manager', () => {
    expect(isRota('brand_manager')).toBe(false);
  });

  it('returns false for observer', () => {
    expect(isRota('observer')).toBe(false);
  });

  // Valores desconocidos/nulos → true (conservador: seguir preguntando agencia)
  it('returns true for null (I-1: conservative default)', () => {
    expect(isRota(null)).toBe(true);
  });

  it('returns true for undefined (I-1: conservative default)', () => {
    expect(isRota(undefined as any)).toBe(true);
  });

  it('returns true for unknown value "logistica"', () => {
    expect(isRota('logistica')).toBe(true);
  });

  it('returns true for empty string', () => {
    expect(isRota('')).toBe(true);
  });
});
