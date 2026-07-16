/// <reference types="jest" />
import { runWithWaFrom, getWaFrom } from './whatsapp-send-context';

describe('whatsapp-send-context — outbound waFrom ALS', () => {
  it('returns undefined outside any context', () => {
    expect(getWaFrom()).toBeUndefined();
  });

  it('exposes the value synchronously inside the callback', async () => {
    await runWithWaFrom('PN-AAA', async () => {
      expect(getWaFrom()).toBe('PN-AAA');
    });
  });

  it('propagates the value across nested async hops', async () => {
    await runWithWaFrom('PN-AAA', async () => {
      await Promise.resolve();
      const deep = async () => {
        await Promise.resolve();
        return getWaFrom();
      };
      expect(await deep()).toBe('PN-AAA');
    });
  });

  it('restores undefined after the context ends', async () => {
    await runWithWaFrom('PN-AAA', async () => {
      expect(getWaFrom()).toBe('PN-AAA');
    });
    expect(getWaFrom()).toBeUndefined();
  });

  it('overrides in a nested context and restores the parent value on return', async () => {
    await runWithWaFrom('PN-PARENT', async () => {
      expect(getWaFrom()).toBe('PN-PARENT');
      await runWithWaFrom('PN-CHILD', async () => {
        expect(getWaFrom()).toBe('PN-CHILD');
      });
      expect(getWaFrom()).toBe('PN-PARENT');
    });
  });

  it('supports an undefined waFrom (falls through to a global fallback caller-side)', async () => {
    await runWithWaFrom(undefined, async () => {
      expect(getWaFrom()).toBeUndefined();
    });
  });

  it('does NOT require a DataSource — it is pure in-memory (no DB access)', async () => {
    // The module imports only async_hooks; no typeorm import. Running it here
    // with zero DataSource proves it opens no transaction / acquires no
    // connection. If it touched the DB this would throw.
    const result = await runWithWaFrom('PN-XYZ', async () => getWaFrom());
    expect(result).toBe('PN-XYZ');
  });
});
