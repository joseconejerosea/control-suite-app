/// <reference types="jest" />
import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { OnboardingService } from './onboarding.service';
import { Client } from '../clients/client.entity';
import { CanalEntrada } from '../canal-entrada/canal-entrada.entity';
import { User } from '../users/user.entity';
import { ProvisionWhatsAppDto } from './dto/provision-whatsapp.dto';
import { VerifyWhatsAppOtpDto } from './dto/verify-whatsapp-otp.dto';
import { AppException } from '../../common/exceptions';
import { SAFE_MESSAGES } from '../../common/exceptions';

const API = 'https://graph.facebook.com/v19.0';

/** A minimal fetch Response stub honoring the fields the service reads. */
function fetchResponse(ok: boolean, body: unknown): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('OnboardingService — WhatsApp number registration', () => {
  const CLIENT_ID = 'client-1';
  const CANAL_ID = 'canal-1';
  const WABA_ID = 'waba-123';

  let service: OnboardingService;
  let clientRepo: jest.Mocked<Pick<Repository<Client>, 'findOneBy' | 'update'>>;
  let canalRepoCtx: jest.Mocked<Pick<Repository<CanalEntrada>, 'findOneBy' | 'update'>>;
  let userRepo: Partial<jest.Mocked<Repository<User>>>;
  let dataSource: DataSource;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.META_WABA_ID = WABA_ID;
    process.env.WHATSAPP_ACCESS_TOKEN = 'perm-token';
    process.env.WHATSAPP_REGISTER_PIN = '135790';

    clientRepo = {
      findOneBy: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    };
    canalRepoCtx = {
      findOneBy: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    };
    userRepo = {};

    // tenantManager(ds) falls back to ds.manager when no tenant store is active;
    // ds.manager.getRepository(CanalEntrada) must return our mocked ctx repo.
    dataSource = {
      manager: {
        getRepository: (entity: unknown) =>
          entity === CanalEntrada ? canalRepoCtx : ({} as unknown),
      },
    } as unknown as DataSource;

    service = new OnboardingService(
      clientRepo as unknown as Repository<Client>,
      {} as unknown as Repository<CanalEntrada>,
      userRepo as unknown as Repository<User>,
      dataSource,
    );

    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.WHATSAPP_REGISTER_PIN;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.META_WABA_ID;
    delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  });

  function activeClient(step: string): Client {
    return { id: CLIENT_ID, status: 'onboarding', onboarding_step: step } as Client;
  }

  function whatsappCanal(config: Record<string, unknown> | null = {}): CanalEntrada {
    return {
      id: CANAL_ID,
      client_id: CLIENT_ID,
      tipo: 'whatsapp',
      config,
    } as unknown as CanalEntrada;
  }

  describe('provisionWhatsApp', () => {
    const dto: ProvisionWhatsAppDto = {
      cc: '56',
      phone_number: '912345678',
      verified_name: 'Acme Store',
      code_method: 'SMS',
    };

    it('registers the number with Meta, stores the real id, and advances to wa_number_requested', async () => {
      clientRepo.findOneBy.mockResolvedValue(activeClient('channel_configured'));
      canalRepoCtx.findOneBy.mockResolvedValue(whatsappCanal({ existing: true }));
      fetchMock
        .mockResolvedValueOnce(fetchResponse(true, { id: 'REAL-PN-999' }))
        .mockResolvedValueOnce(fetchResponse(true, { success: true }));

      const result = await service.provisionWhatsApp(CLIENT_ID, CANAL_ID, dto);

      expect(fetchMock).toHaveBeenCalledTimes(2);

      const [phoneNumbersUrl, phoneNumbersInit] = fetchMock.mock.calls[0];
      expect(phoneNumbersUrl).toBe(`${API}/${WABA_ID}/phone_numbers`);
      expect(phoneNumbersInit.method).toBe('POST');
      expect(phoneNumbersInit.headers.Authorization).toBe('Bearer perm-token');
      expect(JSON.parse(phoneNumbersInit.body)).toEqual({
        cc: '56',
        phone_number: '912345678',
        verified_name: 'Acme Store',
      });

      const [requestCodeUrl, requestCodeInit] = fetchMock.mock.calls[1];
      expect(requestCodeUrl).toBe(`${API}/REAL-PN-999/request_code`);
      expect(JSON.parse(requestCodeInit.body)).toEqual({ code_method: 'SMS', language: 'es' });

      expect(canalRepoCtx.update).toHaveBeenCalledWith(
        { id: CANAL_ID },
        expect.objectContaining({
          is_active: false,
          config: expect.objectContaining({
            existing: true,
            phone_number_id: 'REAL-PN-999',
            display_phone_number: '+56912345678',
            verified_name: 'Acme Store',
            waba_id: WABA_ID,
            cc: '56',
            raw_phone_number: '912345678',
          }),
        }),
      );

      expect(clientRepo.update).toHaveBeenCalledWith(CLIENT_ID, {
        onboarding_step: 'wa_number_requested',
      });

      expect(result.phone_number_id).toBe('REAL-PN-999');
      expect(typeof result.message).toBe('string');
    });

    it('throws AppException.integration (safe message, no raw Meta text) when phone_numbers fails', async () => {
      clientRepo.findOneBy.mockResolvedValue(activeClient('channel_configured'));
      canalRepoCtx.findOneBy.mockResolvedValue(whatsappCanal());
      fetchMock.mockResolvedValueOnce(
        fetchResponse(false, { error: { message: 'Invalid verified name' } }),
      );

      const err = await service.provisionWhatsApp(CLIENT_ID, CANAL_ID, dto).catch((e) => e);
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).userMessage).toBe(SAFE_MESSAGES.INTEGRATION_FAILURE);
      // Raw Meta message must NOT appear in userMessage
      expect((err as AppException).userMessage).not.toContain('Invalid verified name');
      // Raw Meta message IS in technicalDetail
      expect((err as AppException).technicalDetail).toContain('Invalid verified name');
      expect((err as AppException).getStatus()).toBe(400);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(canalRepoCtx.update).not.toHaveBeenCalled();
      expect(clientRepo.update).not.toHaveBeenCalled();
    });

    it('throws AppException.integration (safe message) when Meta returns no phone_number_id', async () => {
      clientRepo.findOneBy.mockResolvedValue(activeClient('channel_configured'));
      canalRepoCtx.findOneBy.mockResolvedValue(whatsappCanal());
      // Meta responds ok but without an id field
      fetchMock.mockResolvedValueOnce(fetchResponse(true, { success: true }));

      const err = await service.provisionWhatsApp(CLIENT_ID, CANAL_ID, dto).catch((e) => e);
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).userMessage).toBe(SAFE_MESSAGES.INTEGRATION_FAILURE);
      expect((err as AppException).technicalDetail).toMatch(/phone_number_id/i);
      expect((err as AppException).getStatus()).toBe(400);
      expect(canalRepoCtx.update).not.toHaveBeenCalled();
    });

    // R3-014 — idempotency: a channel already carrying a phone_number_id must NOT
    // create a second number at Meta (orphan registration). It re-requests the OTP
    // on the existing id so the flow is resumable.
    it('does not re-create the number and re-requests the OTP when already provisioned', async () => {
      clientRepo.findOneBy.mockResolvedValue(activeClient('channel_configured'));
      canalRepoCtx.findOneBy.mockResolvedValue(
        whatsappCanal({ phone_number_id: 'EXISTING-PN-1' }),
      );
      fetchMock.mockResolvedValueOnce(fetchResponse(true, { success: true }));

      const result = await service.provisionWhatsApp(CLIENT_ID, CANAL_ID, dto);

      // Only request_code is called, and it targets the EXISTING id.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe(`${API}/EXISTING-PN-1/request_code`);
      // phone_numbers (create) must never be called.
      const createCall = fetchMock.mock.calls.find(([u]: [string]) =>
        u.endsWith('/phone_numbers'),
      );
      expect(createCall).toBeUndefined();
      expect(result.phone_number_id).toBe('EXISTING-PN-1');
    });

    // R3-008/R4-006 — fail-fast config: an empty WABA id must abort before any
    // network call (never send a malformed `/phone_numbers` URL).
    it('throws AppException.config (safe message) before any fetch when the WABA id is not configured', async () => {
      delete process.env.META_WABA_ID;
      delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
      // Rebuild the service so it picks up the empty wabaId at construction.
      service = new OnboardingService(
        clientRepo as unknown as Repository<Client>,
        {} as unknown as Repository<CanalEntrada>,
        userRepo as unknown as Repository<User>,
        dataSource,
      );
      clientRepo.findOneBy.mockResolvedValue(activeClient('channel_configured'));
      canalRepoCtx.findOneBy.mockResolvedValue(whatsappCanal());

      const err = await service.provisionWhatsApp(CLIENT_ID, CANAL_ID, dto).catch((e) => e);
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).userMessage).toBe(SAFE_MESSAGES.CONFIG_ERROR);
      expect((err as AppException).technicalDetail).toMatch(/WABA id not configured/i);
      expect((err as AppException).getStatus()).toBe(500);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // R4-004 — metaPost timeout: an aborted fetch must surface as AppException.timeout
    // with a safe user message and raw detail only in technicalDetail.
    it('throws AppException.timeout (safe message) when the Meta request aborts', async () => {
      clientRepo.findOneBy.mockResolvedValue(activeClient('channel_configured'));
      canalRepoCtx.findOneBy.mockResolvedValue(whatsappCanal());
      const abortError = new DOMException('The operation was aborted.', 'AbortError');
      fetchMock.mockRejectedValueOnce(abortError);

      const err = await service.provisionWhatsApp(CLIENT_ID, CANAL_ID, dto).catch((e) => e);
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).userMessage).toBe(SAFE_MESSAGES.TIMEOUT);
      expect((err as AppException).technicalDetail).toMatch(/timed out/i);
      expect((err as AppException).getStatus()).toBe(504);
      expect(canalRepoCtx.update).not.toHaveBeenCalled();
    });
  });

  describe('verifyWhatsAppOtp', () => {
    const dto: VerifyWhatsAppOtpDto = { code: '123456' };

    it('verifies the code, registers the number, activates the channel and advances the step', async () => {
      clientRepo.findOneBy.mockResolvedValue(activeClient('wa_number_requested'));
      canalRepoCtx.findOneBy.mockResolvedValue(
        whatsappCanal({
          phone_number_id: 'REAL-PN-999',
          display_phone_number: '+56912345678',
        }),
      );
      fetchMock
        .mockResolvedValueOnce(fetchResponse(true, { success: true }))
        .mockResolvedValueOnce(fetchResponse(true, { success: true }));

      const result = await service.verifyWhatsAppOtp(CLIENT_ID, CANAL_ID, dto);

      expect(fetchMock).toHaveBeenCalledTimes(2);

      const [verifyUrl, verifyInit] = fetchMock.mock.calls[0];
      expect(verifyUrl).toBe(`${API}/REAL-PN-999/verify_code`);
      expect(JSON.parse(verifyInit.body)).toEqual({ code: '123456' });

      const [registerUrl, registerInit] = fetchMock.mock.calls[1];
      expect(registerUrl).toBe(`${API}/REAL-PN-999/register`);
      expect(JSON.parse(registerInit.body)).toEqual({
        messaging_product: 'whatsapp',
        pin: '135790',
      });

      expect(canalRepoCtx.update).toHaveBeenCalledWith({ id: CANAL_ID }, { is_active: true });
      expect(clientRepo.update).toHaveBeenCalledWith(CLIENT_ID, {
        onboarding_step: 'wa_number_verified',
      });

      expect(result).toEqual({
        verified: true,
        phone_number_id: 'REAL-PN-999',
        display_phone_number: '+56912345678',
      });
    });

    it('throws AppException.integration (safe message) and does not register when verify_code fails', async () => {
      clientRepo.findOneBy.mockResolvedValue(activeClient('wa_number_requested'));
      canalRepoCtx.findOneBy.mockResolvedValue(
        whatsappCanal({ phone_number_id: 'REAL-PN-999', display_phone_number: '+56912345678' }),
      );
      fetchMock.mockResolvedValueOnce(
        fetchResponse(false, { error: { message: 'Incorrect code' } }),
      );

      const err = await service.verifyWhatsAppOtp(CLIENT_ID, CANAL_ID, dto).catch((e) => e);
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).userMessage).toBe(SAFE_MESSAGES.INTEGRATION_FAILURE);
      expect((err as AppException).userMessage).not.toContain('Incorrect code');
      expect((err as AppException).technicalDetail).toContain('Incorrect code');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(canalRepoCtx.update).not.toHaveBeenCalled();
      expect(clientRepo.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the number was not provisioned', async () => {
      clientRepo.findOneBy.mockResolvedValue(activeClient('wa_number_requested'));
      canalRepoCtx.findOneBy.mockResolvedValue(whatsappCanal({}));

      await expect(service.verifyWhatsAppOtp(CLIENT_ID, CANAL_ID, dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(fetchMock).not.toHaveBeenCalled();
    });

    // R1-004/R4-007 — PIN fail-closed: a missing WHATSAPP_REGISTER_PIN must abort
    // before Meta /register so no number is ever registered with a default PIN.
    it('throws AppException.config (safe message) and never calls /register when WHATSAPP_REGISTER_PIN is missing', async () => {
      delete process.env.WHATSAPP_REGISTER_PIN;
      clientRepo.findOneBy.mockResolvedValue(activeClient('wa_number_requested'));
      canalRepoCtx.findOneBy.mockResolvedValue(
        whatsappCanal({ phone_number_id: 'REAL-PN-999', display_phone_number: '+56912345678' }),
      );
      // If the guard were missing, verify_code would resolve and /register would run.
      fetchMock.mockResolvedValue(fetchResponse(true, { success: true }));

      const err = await service.verifyWhatsAppOtp(CLIENT_ID, CANAL_ID, dto).catch((e) => e);
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).userMessage).toBe(SAFE_MESSAGES.CONFIG_ERROR);
      expect((err as AppException).technicalDetail).toMatch(/WHATSAPP_REGISTER_PIN not configured/i);

      const registerCall = fetchMock.mock.calls.find(([u]: [string]) => u.endsWith('/register'));
      expect(registerCall).toBeUndefined();
      expect(canalRepoCtx.update).not.toHaveBeenCalled();
    });

    // R3-007/R4-005 — partial-registration observability: if /register fails AFTER
    // verify_code succeeded, an explicit greppable recovery error is logged.
    it('logs a greppable recovery error when register fails after verify succeeds', async () => {
      clientRepo.findOneBy.mockResolvedValue(activeClient('wa_number_requested'));
      canalRepoCtx.findOneBy.mockResolvedValue(
        whatsappCanal({ phone_number_id: 'REAL-PN-999', display_phone_number: '+56912345678' }),
      );
      const errorSpy = jest
        .spyOn((service as unknown as { logger: { error: (m: string) => void } }).logger, 'error')
        .mockImplementation(() => undefined);
      fetchMock
        .mockResolvedValueOnce(fetchResponse(true, { success: true })) // verify_code ok
        .mockResolvedValueOnce(fetchResponse(false, { error: { message: 'boom' } })); // register fails

      await expect(service.verifyWhatsAppOtp(CLIENT_ID, CANAL_ID, dto)).rejects.toBeTruthy();

      const recoveryLog = errorSpy.mock.calls.find(
        ([m]: [string]) =>
          typeof m === 'string' &&
          m.includes('WA_PARTIAL_REGISTRATION') &&
          m.includes(CLIENT_ID) &&
          m.includes('REAL-PN-999'),
      );
      expect(recoveryLog).toBeDefined();
      expect(canalRepoCtx.update).not.toHaveBeenCalled();
    });

    // R3-008/R4-006 — fail-fast config on verify too.
    it('throws AppException.config (safe message) before any fetch when the access token is not configured', async () => {
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      clientRepo.findOneBy.mockResolvedValue(activeClient('wa_number_requested'));
      canalRepoCtx.findOneBy.mockResolvedValue(
        whatsappCanal({ phone_number_id: 'REAL-PN-999', display_phone_number: '+56912345678' }),
      );

      const err = await service.verifyWhatsAppOtp(CLIENT_ID, CANAL_ID, dto).catch((e) => e);
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).userMessage).toBe(SAFE_MESSAGES.CONFIG_ERROR);
      expect((err as AppException).technicalDetail).toMatch(/WHATSAPP_ACCESS_TOKEN not configured/i);
      expect((err as AppException).getStatus()).toBe(500);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
