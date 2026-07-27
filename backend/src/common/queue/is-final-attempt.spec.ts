/// <reference types="jest" />
import { isFinalAttempt } from './is-final-attempt';

describe('isFinalAttempt', () => {
  const job = (attemptsMade: number, attempts?: number) =>
    ({ attemptsMade, opts: { attempts } }) as any;

  it('is false on earlier attempts of a retrying job', () => {
    // attempts: 3 → intentos 1 y 2 (attemptsMade 0 y 1) NO son el último.
    expect(isFinalAttempt(job(0, 3))).toBe(false);
    expect(isFinalAttempt(job(1, 3))).toBe(false);
  });

  it('is true on the final attempt of a retrying job', () => {
    // intento 3 (attemptsMade 2) es el último.
    expect(isFinalAttempt(job(2, 3))).toBe(true);
  });

  it('is true when no retries are configured (attempts defaults to 1)', () => {
    expect(isFinalAttempt(job(0))).toBe(true);
    expect(isFinalAttempt({ attemptsMade: undefined, opts: {} } as any)).toBe(true);
  });
});
