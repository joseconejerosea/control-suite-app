import { Injectable } from '@nestjs/common';
import { ClientCandidate } from './sender-tenant-resolver.service';

/** Outcome of parsing a numbered "which agency?" reply. */
export type SelectionResult =
  | { kind: 'client'; clientId: string }
  | { kind: 'other' }
  | { kind: 'invalid' };

/**
 * Pure decision helpers for the "which agency?" step of the single-global-number
 * model. When a sender is a registered actor of one or more clients, the bot asks —
 * listing their agencies plus an "Otra agencia" option so they can operate for a new
 * agency via an affiliation code. Kept dependency-free so the branching brain is
 * trivially unit-tested; the controller owns the I/O (buffering, sending, replaying).
 */
@Injectable()
export class WhatsAppTenantSelectionService {
  /** Numbered "¿Para qué agencia?" prompt: every candidate + a trailing "otra". */
  buildPrompt(candidates: ClientCandidate[]): string {
    const options = candidates.map((c, i) => `${i + 1}) ${c.clientName}`);
    options.push(`${candidates.length + 1}) Otra agencia (tengo un código)`);
    return `¿Para qué agencia es esto?\n${options.join('\n')}\n\nRespondé con el número.`;
  }

  /** Prompt shown when the sender must type an affiliation code. */
  buildCodePrompt(): string {
    // P14 · anunciar la salida: sin esto, quien caía en el sub-estado del código por
    // error sólo salía acertando un código válido o agotando los 5 intentos. El escape
    // por "cancelar" ya existía (resolveInboundTenant), pero el bot nunca lo ofrecía.
    return (
      'Pasame el código de afiliación de la agencia para continuar.\n\n' +
      'O escribí *cancelar* para salir.'
    );
  }

  /**
   * Maps a numbered reply to a candidate, the "otra agencia" option (index just past
   * the candidates), or invalid.
   */
  parseSelection(text: string, candidates: ClientCandidate[]): SelectionResult {
    const n = parseInt((text ?? '').trim(), 10);
    if (isNaN(n) || n < 1 || n > candidates.length + 1) return { kind: 'invalid' };
    if (n === candidates.length + 1) return { kind: 'other' };
    return { kind: 'client', clientId: candidates[n - 1].clientId };
  }
}
