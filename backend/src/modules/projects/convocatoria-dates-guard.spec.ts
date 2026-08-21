/// <reference types="jest" />
/**
 * B3 — convocatoria date validation guard.
 *
 * Date validation was pulled OUT of the global ValidationPipe. The old approach
 * emitted a raw, `items.N.`-prefixed message and — for a convocatoria to N
 * anfitriones each with a bad date — repeated that same message N times joined
 * by commas (JD-001). The global exceptionFactory also stripped field context
 * from EVERY validation error app-wide (JD-002).
 *
 * The replacement is `assertConvocatoriaDatesValid(items)`: a single manual
 * guard, called by BOTH convocatoria flows (enviarConvocatoria and
 * convocarAnfitriones), that throws EXACTLY ONCE with a clean authored message
 * as soon as any item has a missing or non-ISO8601 `dia`. One throw means
 * multi-item bad dates yield ONE clean sentence (no comma duplication, no path
 * prefix).
 */
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { assertConvocatoriaDatesValid } from './projects.service';

const EXPECTED_MSG = 'Falta la fecha o no es válida. Revísala antes de enviar.';

/** Extract the scalar message string from a BadRequestException response. */
function extractMsg(err: BadRequestException): string {
  const res = err.getResponse();
  if (typeof res === 'string') return res;
  if (res && typeof res === 'object') {
    const raw = (res as { message?: unknown }).message;
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) return raw.join(', ');
  }
  return '';
}

const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

type Item = { persona_id: string; dia?: string };

describe('B3 — assertConvocatoriaDatesValid', () => {
  it('(a) single item with missing dia → throws clean message, no "items." prefix', () => {
    expect.assertions(3);
    const items: Item[] = [{ persona_id: VALID_UUID }];
    try {
      assertConvocatoriaDatesValid(items);
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const msg = extractMsg(err as BadRequestException);
      expect(msg).toBe(EXPECTED_MSG);
      expect(msg).not.toContain('items.');
    }
  });

  it('(b) single item with invalid dia ("dd-mm-aaaa") → throws clean message, no ISO 8601 text', () => {
    expect.assertions(3);
    const items: Item[] = [{ persona_id: VALID_UUID, dia: 'dd-mm-aaaa' }];
    try {
      assertConvocatoriaDatesValid(items);
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const msg = extractMsg(err as BadRequestException);
      expect(msg).toBe(EXPECTED_MSG);
      expect(msg).not.toContain('ISO 8601');
    }
  });

  it('(c) MULTIPLE items all with bad dates → message appears ONCE (no comma duplication)', () => {
    expect.assertions(3);
    const items: Item[] = [
      { persona_id: VALID_UUID, dia: 'dd-mm-aaaa' },
      { persona_id: VALID_UUID, dia: 'not-a-date' },
      { persona_id: VALID_UUID }, // missing dia
    ];
    try {
      assertConvocatoriaDatesValid(items);
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const msg = extractMsg(err as BadRequestException);
      // The single authored sentence — NOT repeated N times joined by commas.
      expect(msg).toBe(EXPECTED_MSG);
      // Guard against comma-duplication regression (JD-001).
      expect(msg.split(EXPECTED_MSG).length - 1).toBe(1);
    }
  });

  it('(d) all items with valid ISO dates → does NOT throw', () => {
    const items: Item[] = [
      { persona_id: VALID_UUID, dia: '2026-08-20' },
      { persona_id: VALID_UUID, dia: '2026-08-21' },
    ];
    expect(() => assertConvocatoriaDatesValid(items)).not.toThrow();
  });
});
