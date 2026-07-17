import { HttpException } from '@nestjs/common';
import { SAFE_MESSAGES } from './safe-messages';

/**
 * Application exception that separates:
 *  - `userMessage`     → safe neutral-Spanish string shown in the HTTP response body
 *  - `technicalDetail` → raw technical cause logged server-side only, never serialized
 *
 * Extends `HttpException` so Nest's status pipeline and `instanceof` checks work as expected.
 * The constructor calls `super(userMessage, status)` so that even if the custom filter path
 * is bypassed, `getResponse()` still returns the safe user-facing message (defense-in-depth).
 */
export class AppException extends HttpException {
  constructor(
    public readonly userMessage: string,
    public readonly technicalDetail: string,
    status: number,
    public readonly code?: string,
  ) {
    super(userMessage, status);
  }

  /**
   * Integration/upstream failure (Meta, AI, external network error).
   * Default status: 400. Override when a cleaner HTTP semantic applies (e.g. 502).
   */
  static integration(technicalDetail: string, status = 400): AppException {
    return new AppException(
      SAFE_MESSAGES.INTEGRATION_FAILURE,
      technicalDetail,
      status,
    );
  }

  /**
   * Missing or invalid server-side configuration (env vars, secrets).
   * Default status: 500.
   */
  static config(technicalDetail: string, status = 500): AppException {
    return new AppException(
      SAFE_MESSAGES.CONFIG_ERROR,
      technicalDetail,
      status,
    );
  }

  /**
   * Outbound request timeout to an external service.
   * Default status: 504.
   */
  static timeout(technicalDetail: string, status = 504): AppException {
    return new AppException(SAFE_MESSAGES.TIMEOUT, technicalDetail, status);
  }
}
