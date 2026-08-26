import { Injectable } from '@nestjs/common';

/** What a person can start over WhatsApp. Roles are not gated — the flows
 *  self-gate by data (active activation, open convocatoria, etc.). */
export type ActionKind = 'factura' | 'material' | 'evidencia' | 'ubicacion';
export type ActionChoice = { kind: ActionKind } | { kind: 'invalid' };

/**
 * Canonical non-technical closing appended when an action flow finishes, inviting
 * the sender to start another. SINGLE SOURCE OF TRUTH: the F1/F3 confirmations in
 * WhatsAppService and the F5 evidence confirmation import this constant so every
 * completion reads identically and can never drift.
 */
export const ACTION_MENU_CLOSING_INVITE =
  '\n\n📲 Si querés hacer otra cosa, escribime y te muestro las opciones.';

/**
 * Pure helpers for the "what do you want to do?" menu shown when a sender writes
 * plain text (no media) and is not already inside a flow. Dependency-free so the
 * branching is trivially unit-tested; the controller owns the I/O and state.
 */
@Injectable()
export class WhatsAppActionMenuService {
  /**
   * A whole message that is JUST a greeting or restart word. Anchored (^…$) so a
   * multi-word supplier/project name that merely STARTS with "hola"/"buenas"
   * (e.g. "hola quiero cargar una factura", "buenas ondas srl") does NOT match —
   * only a bare salutation is a restart intent. Case-insensitive; trailing
   * punctuation ("!", ".") and surrounding whitespace are tolerated.
   */
  private static readonly GREETING_RE =
    /^\s*(hola+|buenas|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|hey|hi|hello|men[uú]|inicio|empezar|reiniciar|volver)\s*[!.]*\s*$/i;

  /** True when the whole trimmed message is only a greeting / restart word. */
  isGreeting(text: string): boolean {
    if (text == null) return false;
    return WhatsAppActionMenuService.GREETING_RE.test(text);
  }

  private readonly options: { n: number; kind: ActionKind; label: string }[] = [
    { n: 1, kind: 'factura', label: 'Cargar factura o boleta' },
    { n: 2, kind: 'material', label: 'Registrar material POP' },
    { n: 3, kind: 'evidencia', label: 'Registrar evidencia de actividad (foto)' },
    { n: 4, kind: 'ubicacion', label: 'Enviar mi ubicación (check-in)' },
  ];

  buildMenu(): string {
    const lines = this.options.map((o) => `${o.n}) ${o.label}`).join('\n');
    return `¿Qué querés hacer? Respondé con el número:\n${lines}`;
  }

  parse(text: string): ActionChoice {
    const n = parseInt((text ?? '').trim(), 10);
    const opt = this.options.find((o) => o.n === n);
    return opt ? { kind: opt.kind } : { kind: 'invalid' };
  }

  /**
   * Menu shown after a photo arrives with no known type yet: "¿Qué es esta foto?".
   * Only the 3 photo types — ubicación is a GPS pin, not a photo, so it is not offered.
   */
  buildTypeMenu(): string {
    return (
      '¿Qué es esta foto? Respondé con el número:\n' +
      '1) Factura o boleta\n' +
      '2) Material POP\n' +
      '3) Evidencia de actividad'
    );
  }

  /** Parses a numbered reply to buildTypeMenu into a photo type (or 'invalid'). */
  parseType(text: string): 'factura' | 'material' | 'evidencia' | 'invalid' {
    switch (parseInt((text ?? '').trim(), 10)) {
      case 1:
        return 'factura';
      case 2:
        return 'material';
      case 3:
        return 'evidencia';
      default:
        return 'invalid';
    }
  }

  /** What to tell the sender to send next, once they picked an action. */
  buildGuide(kind: ActionKind): string {
    switch (kind) {
      case 'factura':
        return 'Dale 👍 Mandame la foto de la factura o boleta.';
      case 'material':
        return 'Dale 👍 Mandame la foto del material POP.';
      case 'evidencia':
        return 'Dale 👍 Mandame la foto de la actividad (la gente en el evento).';
      case 'ubicacion':
        return 'Dale 👍 Compartime tu ubicación desde WhatsApp 📍 (clip → Ubicación).';
    }
  }

  /** Canonical non-technical closing (see ACTION_MENU_CLOSING_INVITE). */
  closingLine(): string {
    return ACTION_MENU_CLOSING_INVITE;
  }
}
