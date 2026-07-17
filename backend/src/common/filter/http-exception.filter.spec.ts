/// <reference types="jest" />
import { Logger } from '@nestjs/common';
import { ArgumentsHost, HttpException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { AppException } from '../exceptions/app.exception';
import { SAFE_MESSAGES } from '../exceptions/safe-messages';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMockReply() {
  const send = jest.fn();
  const status = jest.fn().mockReturnValue({ send });
  return { status, send, _lastPayload: () => send.mock.calls[0]?.[0] };
}

function buildMockRequest(url = '/test/path', method = 'GET') {
  return { url, method };
}

function buildHost(reply: ReturnType<typeof buildMockReply>, request = buildMockRequest()) {
  return {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Branch A: AppException → log technicalDetail, serialize userMessage
  // -------------------------------------------------------------------------

  describe('Branch A — AppException', () => {
    it('sends userMessage in the response body', () => {
      const reply = buildMockReply();
      const exception = AppException.integration('Meta returned 400 Bad Request', 400);
      filter.catch(exception, buildHost(reply));

      const payload = reply._lastPayload();
      expect(payload.success).toBe(false);
      expect(payload.error.message).toBe(SAFE_MESSAGES.INTEGRATION_FAILURE);
      expect(payload.error.statusCode).toBe(400);
    });

    it('does NOT include technicalDetail in the response body', () => {
      const reply = buildMockReply();
      const rawDetail = 'WHATSAPP_REGISTER_PIN not configured — env var missing';
      const exception = AppException.config(rawDetail, 500);
      filter.catch(exception, buildHost(reply));

      const payloadStr = JSON.stringify(reply._lastPayload());
      expect(payloadStr).not.toContain(rawDetail);
    });

    it('logs technicalDetail via Logger.error', () => {
      const reply = buildMockReply();
      const rawDetail = 'Meta request timed out after 15000ms /v19.0/register';
      const exception = AppException.timeout(rawDetail, 504);
      filter.catch(exception, buildHost(reply));

      expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
      const logArg: string = loggerErrorSpy.mock.calls[0][0];
      expect(logArg).toContain(rawDetail);
    });

    it('logs the request path and status in the log message', () => {
      const reply = buildMockReply();
      const exception = AppException.config('AI_KEY missing', 500);
      const request = buildMockRequest('/api/onboarding', 'POST');
      filter.catch(exception, buildHost(reply, request));

      const logArg: string = loggerErrorSpy.mock.calls[0][0];
      expect(logArg).toContain('/api/onboarding');
      expect(logArg).toContain('500');
    });

    it('response envelope has timestamp and path fields', () => {
      const reply = buildMockReply();
      const exception = AppException.integration('some detail', 400);
      filter.catch(exception, buildHost(reply, buildMockRequest('/my/path')));

      const payload = reply._lastPayload();
      expect(payload).toHaveProperty('timestamp');
      expect(payload.path).toBe('/my/path');
    });

    it('calls reply.status() with the correct status code', () => {
      const reply = buildMockReply();
      const exception = AppException.timeout('timed out', 504);
      filter.catch(exception, buildHost(reply));

      expect(reply.status).toHaveBeenCalledWith(504);
    });
  });

  // -------------------------------------------------------------------------
  // Branch B: plain HttpException → pass-through unchanged
  // -------------------------------------------------------------------------

  describe('Branch B — plain HttpException (pass-through)', () => {
    it('serializes the original exception message unchanged', () => {
      const reply = buildMockReply();
      const domainMessage = 'El proyecto ya está cerrado';
      const exception = new HttpException(domainMessage, 400);
      filter.catch(exception, buildHost(reply));

      const payload = reply._lastPayload();
      expect(payload.error.message).toBe(domainMessage);
    });

    it('does NOT replace business message with a safe-messages constant', () => {
      const reply = buildMockReply();
      const exception = new HttpException('Unauthorized access', 401);
      filter.catch(exception, buildHost(reply));

      const payload = reply._lastPayload();
      expect(payload.error.message).toBe('Unauthorized access');
      // Must not have been replaced with a generic Spanish string
      expect(payload.error.message).not.toBe(SAFE_MESSAGES.UNEXPECTED);
    });

    it('preserves HTTP status from the plain HttpException', () => {
      const reply = buildMockReply();
      const exception = new HttpException('Not Found', 404);
      filter.catch(exception, buildHost(reply));

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply._lastPayload().error.statusCode).toBe(404);
    });

    it('handles object-form HttpException response (Nest validation)', () => {
      const reply = buildMockReply();
      // Nest's ValidationPipe produces { message: string[], statusCode: 400, error: 'Bad Request' }
      const exception = new HttpException(
        { message: ['field must not be empty', 'field must be a string'], statusCode: 400 },
        400,
      );
      filter.catch(exception, buildHost(reply));

      const payload = reply._lastPayload();
      expect(payload.error.message).toBe('field must not be empty, field must be a string');
    });

    it('envelope shape is identical to AppException branch', () => {
      const reply = buildMockReply();
      const exception = new HttpException('Some domain error', 422);
      filter.catch(exception, buildHost(reply, buildMockRequest('/my/endpoint')));

      const payload = reply._lastPayload();
      expect(payload).toHaveProperty('success', false);
      expect(payload).toHaveProperty('error');
      expect(payload.error).toHaveProperty('message');
      expect(payload.error).toHaveProperty('statusCode');
      expect(payload).toHaveProperty('timestamp');
      expect(payload).toHaveProperty('path', '/my/endpoint');
    });
  });

  // -------------------------------------------------------------------------
  // Branch C: non-HttpException → log full error, serialize SAFE_MESSAGES.UNEXPECTED
  // -------------------------------------------------------------------------

  describe('Branch C — unhandled / non-HttpException', () => {
    it('sends SAFE_MESSAGES.UNEXPECTED in the response body', () => {
      const reply = buildMockReply();
      const rawError = new Error('Cannot read properties of undefined');
      filter.catch(rawError, buildHost(reply));

      const payload = reply._lastPayload();
      expect(payload.error.message).toBe(SAFE_MESSAGES.UNEXPECTED);
    });

    it('responds with status 500', () => {
      const reply = buildMockReply();
      filter.catch(new Error('DB connection refused'), buildHost(reply));

      expect(reply.status).toHaveBeenCalledWith(500);
      expect(reply._lastPayload().error.statusCode).toBe(500);
    });

    it('logs the full raw error string via Logger.error', () => {
      const reply = buildMockReply();
      const rawError = new TypeError('Cannot read property id of null');
      filter.catch(rawError, buildHost(reply));

      expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
      const logArg: string = loggerErrorSpy.mock.calls[0][0];
      expect(logArg).toContain('Cannot read property id of null');
    });

    it('does NOT expose the raw error message in the response body', () => {
      const reply = buildMockReply();
      const secretDetail = 'password column does not exist in table users';
      filter.catch(new Error(secretDetail), buildHost(reply));

      const payloadStr = JSON.stringify(reply._lastPayload());
      expect(payloadStr).not.toContain(secretDetail);
    });

    it('handles non-Error thrown values (string, object)', () => {
      const reply = buildMockReply();
      filter.catch('raw string thrown', buildHost(reply));

      const payload = reply._lastPayload();
      expect(payload.error.message).toBe(SAFE_MESSAGES.UNEXPECTED);
      expect(reply.status).toHaveBeenCalledWith(500);
    });

    it('envelope shape is consistent with other branches', () => {
      const reply = buildMockReply();
      filter.catch(new Error('some unhandled error'), buildHost(reply, buildMockRequest('/fail')));

      const payload = reply._lastPayload();
      expect(payload).toHaveProperty('success', false);
      expect(payload).toHaveProperty('error');
      expect(payload.error).toHaveProperty('message');
      expect(payload.error).toHaveProperty('statusCode');
      expect(payload).toHaveProperty('timestamp');
      expect(payload).toHaveProperty('path', '/fail');
    });

    it('handles thrown null → safe 500 body, no crash, technicalDetail-free', () => {
      const reply = buildMockReply();
      expect(() => filter.catch(null, buildHost(reply))).not.toThrow();

      const payload = reply._lastPayload();
      expect(payload.error.message).toBe(SAFE_MESSAGES.UNEXPECTED);
      expect(payload.error.statusCode).toBe(500);
      expect(reply.status).toHaveBeenCalledWith(500);
      expect(JSON.stringify(payload)).not.toContain('technicalDetail');
    });

    it('handles thrown undefined → safe 500 body, no crash, technicalDetail-free', () => {
      const reply = buildMockReply();
      expect(() => filter.catch(undefined, buildHost(reply))).not.toThrow();

      const payload = reply._lastPayload();
      expect(payload.error.message).toBe(SAFE_MESSAGES.UNEXPECTED);
      expect(payload.error.statusCode).toBe(500);
      expect(reply.status).toHaveBeenCalledWith(500);
      expect(JSON.stringify(payload)).not.toContain('technicalDetail');
    });
  });

  // -------------------------------------------------------------------------
  // Defensive: malformed / missing request must NEVER crash the global filter
  // (JB-005) — a TypeError inside the filter leaks the framework default body.
  // -------------------------------------------------------------------------

  describe('Defensive — malformed request/response', () => {
    it('does NOT throw when request is undefined; sends safe 500 with null path', () => {
      const reply = buildMockReply();
      const host = {
        switchToHttp: () => ({
          getResponse: () => reply,
          getRequest: () => undefined,
        }),
      } as unknown as ArgumentsHost;

      expect(() =>
        filter.catch(new Error('early boot failure'), host),
      ).not.toThrow();

      const payload = reply._lastPayload();
      expect(payload.success).toBe(false);
      expect(payload.error.message).toBe(SAFE_MESSAGES.UNEXPECTED);
      expect(payload.error.statusCode).toBe(500);
      expect(payload.path == null || payload.path === '').toBe(true);
    });

    it('does NOT throw when request is a partial object missing url/method', () => {
      const reply = buildMockReply();
      const host = {
        switchToHttp: () => ({
          getResponse: () => reply,
          getRequest: () => ({}),
        }),
      } as unknown as ArgumentsHost;

      expect(() =>
        filter.catch(new Error('boom'), host),
      ).not.toThrow();

      const payload = reply._lastPayload();
      expect(payload.error.message).toBe(SAFE_MESSAGES.UNEXPECTED);
      expect(payload.error.statusCode).toBe(500);
      expect(payload.path == null || payload.path === '').toBe(true);
    });

    it('does NOT throw when request is undefined for an AppException (branch A)', () => {
      const reply = buildMockReply();
      const host = {
        switchToHttp: () => ({
          getResponse: () => reply,
          getRequest: () => undefined,
        }),
      } as unknown as ArgumentsHost;

      const exception = AppException.integration('meta 500', 400);
      expect(() => filter.catch(exception, host)).not.toThrow();

      const payload = reply._lastPayload();
      expect(payload.error.message).toBe(SAFE_MESSAGES.INTEGRATION_FAILURE);
      expect(payload.error.statusCode).toBe(400);
    });

    it('does NOT throw when response lacks a usable .status().send() API', () => {
      const brokenReply = {} as unknown as ReturnType<typeof buildMockReply>;
      const host = {
        switchToHttp: () => ({
          getResponse: () => brokenReply,
          getRequest: () => buildMockRequest(),
        }),
      } as unknown as ArgumentsHost;

      expect(() =>
        filter.catch(new Error('boom'), host),
      ).not.toThrow();
    });
  });
});
