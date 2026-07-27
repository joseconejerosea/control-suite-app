/// <reference types="jest" />
import { OcrProcessor } from './ocr.processor';

/**
 * Protege el punto de mayor riesgo para F1: el parseo del triage de visión.
 * Si el JSON del modelo viniera mal, un DOCUMENTO jamás debe perderse —
 * el fail-safe cae a kind='document' con el texto crudo y sigue el pipeline F1.
 */
describe('OcrProcessor.parseVisionTriage', () => {
  // Los args del constructor no se usan en el método puro; stubs mínimos.
  const proc = new OcrProcessor(
    null as any, null as any, null as any, null as any, null as any, null as any, null as any,
  );
  const parse = (raw: string) => (proc as any).parseVisionTriage(raw, null);

  it('parses a material verdict with its label', () => {
    const r = parse(JSON.stringify({ kind: 'material', label: 'silla', text: '' }));
    expect(r.kind).toBe('material');
    expect(r.label).toBe('silla');
  });

  it('parses a document verdict keeping the extracted text', () => {
    const r = parse(JSON.stringify({ kind: 'document', label: null, text: 'BOLETA $1000' }));
    expect(r.kind).toBe('document');
    expect(r.text).toContain('BOLETA');
  });

  it('parses an ambiguous verdict', () => {
    expect(parse(JSON.stringify({ kind: 'ambiguous', label: null, text: '' })).kind).toBe('ambiguous');
  });

  it('tolerates a ```json fenced block', () => {
    const r = parse('```json\n{"kind":"material","label":"banner","text":""}\n```');
    expect(r.kind).toBe('material');
    expect(r.label).toBe('banner');
  });

  it('fails safe to document (never loses the image) on invalid JSON', () => {
    const r = parse('totally not json');
    expect(r.kind).toBe('document');
    expect(r.text).toBe('totally not json');
  });

  it('fails safe to document on an unknown kind value', () => {
    expect(parse(JSON.stringify({ kind: 'weird', text: 'x' })).kind).toBe('document');
  });
});
