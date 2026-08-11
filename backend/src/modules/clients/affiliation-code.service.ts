import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomInt } from 'crypto';

// Unambiguous alphabet for a hand-typed credential: no O/0, I/1/L.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/**
 * Per-client affiliation code — the credential a promoter/host types over WhatsApp
 * to affiliate to an agency under the single-global-number model. Because the code
 * grants immediate active access (Camino 2), it is generated with a CSPRNG and is
 * rotatable.
 */
@Injectable()
export class AffiliationCodeService {
  private readonly logger = new Logger(AffiliationCodeService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** A fresh unbiased code from the unambiguous alphabet. */
  generate(): string {
    let out = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      out += ALPHABET[randomInt(ALPHABET.length)];
    }
    return out;
  }

  /** Canonical form for storage/compare: uppercase, no spaces or dashes. */
  normalize(input: string): string {
    return String(input ?? '')
      .toUpperCase()
      .replace(/[\s-]/g, '');
  }

  /** Resolves the client that owns a code (as typed), or null. `clients` has no RLS. */
  async resolveClientByCode(code: string): Promise<string | null> {
    const normalized = this.normalize(code);
    if (!normalized) return null;

    try {
      const rows = await this.ds.query(
        `SELECT id FROM clients WHERE affiliation_code = $1 LIMIT 1`,
        [normalized],
      );
      return rows?.[0]?.id ?? null;
    } catch (err: any) {
      this.logger.error(`[Affiliation] resolveClientByCode error: ${err.message}`);
      return null; // fail-closed: an unresolved code never affiliates
    }
  }
}
