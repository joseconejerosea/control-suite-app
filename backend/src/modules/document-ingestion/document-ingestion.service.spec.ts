/// <reference types="jest" />
/**
 * Unit tests for DocumentIngestionService throw-site conversion (normalize-user-error-messages PR-2).
 * L237: parse() catch block must throw AppException.integration (not InternalServerErrorException)
 * so the raw parser detail is in technicalDetail, not in the user-facing message.
 *
 * Note: the error_detail DB write in the catch block is preserved unchanged.
 */
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { DocumentIngestionService } from './document-ingestion.service';
import { AppException } from '../../common/exceptions';
import { SAFE_MESSAGES } from '../../common/exceptions';
import { DocumentUpload } from './document-upload.entity';

describe('DocumentIngestionService — parse() throw-site normalization', () => {
  let service: DocumentIngestionService;
  let repoUpdateMock: jest.Mock;
  const CLIENT_ID = 'client-1';
  const DOC_ID = 'doc-1';

  const docStub: Partial<DocumentUpload> = {
    id: DOC_ID,
    client_id: CLIENT_ID,
    original_name: 'test.csv',
    mime_type: 'text/csv',
    storage_path: 'some/path',
    target_table: 'promoters',
    status: 'uploaded',
  };

  beforeEach(() => {
    repoUpdateMock = jest.fn().mockImplementation((_clientId: string, _id: string, patch: any) =>
      Promise.resolve({ ...docStub, ...patch }),
    );

    const repoFindOneMock = jest.fn().mockResolvedValue(docStub);

    const config = { get: jest.fn().mockReturnValue('./uploads') } as unknown as ConfigService;

    // DataSource stub — TenantRepository constructor calls getRepository in constructor
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        findOne: jest.fn(),
        find: jest.fn(),
        save: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      }),
    } as unknown as DataSource;

    service = new DocumentIngestionService(
      dataSource,
      config,
      // csvParser — throws to simulate parse failure
      { parse: jest.fn().mockRejectedValue(new Error('CSV parse error: bad delimiter xyz')) } as any,
      { parse: jest.fn() } as any, // excelParser
      { parse: jest.fn() } as any, // pdfParser
      { extract: jest.fn(), isConfigured: jest.fn().mockReturnValue(false) } as any, // aiExtractor
      { map: jest.fn() } as any, // columnMapper
      { validate: jest.fn() } as any, // validator
      { populate: jest.fn() } as any, // populator
      // storage — returns a buffer so we can reach the parser
      { download: jest.fn().mockResolvedValue(Buffer.from('col1,col2\nval1,val2')) } as any,
    );

    // Replace the internal TenantRepository with a stub so findOne/update are mocked
    (service as any).repo = {
      findOne: repoFindOneMock,
      update: repoUpdateMock,
      create: jest.fn(),
      findAll: jest.fn(),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws AppException.integration when the parser throws, preserving raw detail in technicalDetail', async () => {
    const err = await service.parse(CLIENT_ID, DOC_ID).catch((e) => e);

    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).userMessage).toBe(SAFE_MESSAGES.INTEGRATION_FAILURE);
    // Raw parser detail must NOT leak into the user-facing message
    expect((err as AppException).userMessage).not.toContain('bad delimiter xyz');
    // Raw parser detail IS in technicalDetail
    expect((err as AppException).technicalDetail).toContain('CSV parse error');
    expect((err as AppException).technicalDetail).toContain('bad delimiter xyz');
    expect((err as AppException).getStatus()).toBe(500);
  });

  it('writes error_detail to the DB row before throwing (detail preservation)', async () => {
    await service.parse(CLIENT_ID, DOC_ID).catch(() => undefined);

    // The update to status='error' with error_detail must have happened
    const errorUpdateCall = repoUpdateMock.mock.calls.find(
      ([, , patch]: [string, string, any]) => patch?.status === 'error',
    );
    expect(errorUpdateCall).toBeDefined();
    const [, , patch] = errorUpdateCall;
    expect(patch.error_detail).toContain('CSV parse error');
  });
});
