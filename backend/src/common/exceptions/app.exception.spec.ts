/// <reference types="jest" />
import { HttpException } from '@nestjs/common';
import { AppException } from './app.exception';
import { SAFE_MESSAGES } from './safe-messages';

describe('AppException', () => {
  describe('instanceof checks', () => {
    it('is an instance of HttpException', () => {
      const ex = AppException.integration('some detail', 400);
      expect(ex).toBeInstanceOf(HttpException);
    });

    it('is an instance of AppException', () => {
      const ex = AppException.integration('some detail', 400);
      expect(ex).toBeInstanceOf(AppException);
    });
  });

  describe('AppException.integration()', () => {
    it('sets userMessage to INTEGRATION_FAILURE safe string', () => {
      const ex = AppException.integration('Meta returned 400', 400);
      expect(ex.userMessage).toBe(SAFE_MESSAGES.INTEGRATION_FAILURE);
    });

    it('sets technicalDetail to the raw passed-in string', () => {
      const ex = AppException.integration('Meta returned 400', 400);
      expect(ex.technicalDetail).toBe('Meta returned 400');
    });

    it('sets HTTP status to the supplied status', () => {
      const ex = AppException.integration('some detail', 502);
      expect(ex.getStatus()).toBe(502);
    });

    it('defaults to HTTP 400 when status is omitted', () => {
      const ex = AppException.integration('some detail');
      expect(ex.getStatus()).toBe(400);
    });
  });

  describe('AppException.config()', () => {
    it('sets userMessage to CONFIG_ERROR safe string', () => {
      const ex = AppException.config('WHATSAPP_REGISTER_PIN not configured');
      expect(ex.userMessage).toBe(SAFE_MESSAGES.CONFIG_ERROR);
    });

    it('sets technicalDetail to the raw passed-in string', () => {
      const detail = 'WHATSAPP_REGISTER_PIN not configured';
      const ex = AppException.config(detail);
      expect(ex.technicalDetail).toBe(detail);
    });

    it('defaults to HTTP 500 when status is omitted', () => {
      const ex = AppException.config('some config issue');
      expect(ex.getStatus()).toBe(500);
    });

    it('accepts a custom status', () => {
      const ex = AppException.config('some config issue', 503);
      expect(ex.getStatus()).toBe(503);
    });
  });

  describe('AppException.timeout()', () => {
    it('sets userMessage to TIMEOUT safe string', () => {
      const ex = AppException.timeout('Meta request timed out after 15000ms');
      expect(ex.userMessage).toBe(SAFE_MESSAGES.TIMEOUT);
    });

    it('sets technicalDetail to the raw passed-in string', () => {
      const detail = 'Meta request timed out after 15000ms';
      const ex = AppException.timeout(detail);
      expect(ex.technicalDetail).toBe(detail);
    });

    it('defaults to HTTP 504 when status is omitted', () => {
      const ex = AppException.timeout('some timeout detail');
      expect(ex.getStatus()).toBe(504);
    });
  });

  describe('defense-in-depth: getResponse() never exposes technicalDetail', () => {
    it('getResponse() equals userMessage (string form from super)', () => {
      const ex = AppException.integration('secret raw detail from Meta API', 400);
      const response = ex.getResponse();
      // super(userMessage, status) makes getResponse() return just the userMessage string
      expect(response).toBe(SAFE_MESSAGES.INTEGRATION_FAILURE);
    });

    it('getResponse() does NOT contain technicalDetail content', () => {
      const rawSecret = 'ANTHROPIC_API_KEY is missing from environment';
      const ex = AppException.config(rawSecret, 500);
      const response = ex.getResponse();
      const responseStr = JSON.stringify(response);
      expect(responseStr).not.toContain(rawSecret);
    });

    it('technicalDetail is NOT serialized in getResponse() for timeout', () => {
      const rawDetail = 'Meta request timed out after 15000ms /v19.0/phone';
      const ex = AppException.timeout(rawDetail, 504);
      const response = ex.getResponse();
      const responseStr = JSON.stringify(response);
      expect(responseStr).not.toContain(rawDetail);
    });
  });

  describe('optional code field', () => {
    it('code is undefined when not supplied', () => {
      const ex = AppException.integration('some detail', 400);
      expect(ex.code).toBeUndefined();
    });

    it('code can be set via constructor', () => {
      const ex = new AppException(
        SAFE_MESSAGES.INTEGRATION_FAILURE,
        'raw detail',
        400,
        'ERR_META_001',
      );
      expect(ex.code).toBe('ERR_META_001');
    });
  });
});
