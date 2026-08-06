import { BriefTextExtractorService } from './brief-text-extractor.service';
import { PdfParserService } from '../document-ingestion/parsers/pdf-parser.service';
import { ExcelParserService } from '../document-ingestion/parsers/excel-parser.service';
import { CsvParserService } from '../document-ingestion/parsers/csv-parser.service';

// Mock officeparser: parseOffice(buffer) => AST con toText().
const parseOfficeMock = jest.fn();
jest.mock('officeparser', () => ({
  parseOffice: (...args: any[]) => parseOfficeMock(...args),
}));

describe('BriefTextExtractorService', () => {
  let service: BriefTextExtractorService;
  let pdf: jest.Mocked<PdfParserService>;
  let excel: jest.Mocked<ExcelParserService>;
  let csv: jest.Mocked<CsvParserService>;

  beforeEach(() => {
    parseOfficeMock.mockReset();
    pdf = { parse: jest.fn() } as any;
    excel = { parse: jest.fn() } as any;
    csv = { parse: jest.fn() } as any;
    service = new BriefTextExtractorService(pdf, excel, csv);
  });

  it('extrae texto de un PDF vía PdfParserService', async () => {
    pdf.parse.mockResolvedValue({ text: 'texto del pdf', num_pages: 1, warnings: [] });

    const res = await service.extract(Buffer.from('%PDF'), 'application/pdf', 'brief.pdf');

    expect(pdf.parse).toHaveBeenCalledTimes(1);
    // Recibe una ruta de archivo temporal (string), no el buffer.
    expect(typeof pdf.parse.mock.calls[0][0]).toBe('string');
    expect(res.text).toBe('texto del pdf');
    expect(res.warnings).toEqual([]);
  });

  it('aplana un XLSX a texto (columns + filas separadas por |)', async () => {
    excel.parse.mockReturnValue({
      columns: ['nombre', 'ciudad'],
      rows: [
        { nombre: 'Local A', ciudad: 'Santiago' },
        { nombre: 'Local B', ciudad: 'Valpo' },
      ],
      sheet_name: 'Hoja1',
      warnings: [],
    });

    const res = await service.extract(
      Buffer.from('xlsx'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'locales.xlsx',
    );

    expect(excel.parse).toHaveBeenCalledTimes(1);
    expect(res.text).toContain('nombre');
    expect(res.text).toContain('ciudad');
    expect(res.text).toContain('Local A | Santiago');
    expect(res.text).toContain('Local B | Valpo');
  });

  it('aplana un CSV a texto', async () => {
    csv.parse.mockResolvedValue({
      columns: ['rol', 'cantidad'],
      rows: [{ rol: 'promotora', cantidad: '3' }],
      delimiter: ',',
      warnings: [],
    });

    const res = await service.extract(Buffer.from('a,b'), 'text/csv', 'perfil.csv');

    expect(csv.parse).toHaveBeenCalledTimes(1);
    expect(res.text).toContain('rol');
    expect(res.text).toContain('promotora | 3');
  });

  it('extrae texto de un DOCX vía officeparser', async () => {
    parseOfficeMock.mockResolvedValue({ toText: () => 'contenido del word' });

    const res = await service.extract(
      Buffer.from('docx'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'propuesta.docx',
    );

    expect(parseOfficeMock).toHaveBeenCalledTimes(1);
    expect(res.text).toBe('contenido del word');
  });

  it('extrae texto de un PPTX vía officeparser', async () => {
    parseOfficeMock.mockResolvedValue({ toText: () => 'slide 1\nslide 2' });

    const res = await service.extract(
      Buffer.from('pptx'),
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'deck.pptx',
    );

    expect(parseOfficeMock).toHaveBeenCalledTimes(1);
    expect(res.text).toBe('slide 1\nslide 2');
  });

  it('rutea por extensión cuando el mime es genérico (octet-stream)', async () => {
    parseOfficeMock.mockResolvedValue({ toText: () => 'word por extension' });

    const res = await service.extract(
      Buffer.from('docx'),
      'application/octet-stream',
      'sin-mime.docx',
    );

    expect(parseOfficeMock).toHaveBeenCalledTimes(1);
    expect(res.text).toBe('word por extension');
  });

  it('devuelve warning (no throw) para un formato no soportado', async () => {
    parseOfficeMock.mockRejectedValue(new Error('unsupported'));

    const res = await service.extract(Buffer.from('???'), 'application/zip', 'raro.bin');

    expect(res.text).toBe('');
    expect(res.warnings.some((w) => w.includes('no soportado'))).toBe(true);
  });

  it('no lanza cuando el resultado es vacío: devuelve warning', async () => {
    pdf.parse.mockResolvedValue({ text: '', num_pages: 0, warnings: [] });

    const res = await service.extract(Buffer.from('%PDF'), 'application/pdf', 'vacio.pdf');

    expect(res.text).toBe('');
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it('trunca a 45000 chars y avisa', async () => {
    parseOfficeMock.mockResolvedValue({ toText: () => 'x'.repeat(60000) });

    const res = await service.extract(
      Buffer.from('docx'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'largo.docx',
    );

    expect(res.text.length).toBe(45000);
    expect(res.warnings.some((w) => w.toLowerCase().includes('trunc'))).toBe(true);
  });
});
