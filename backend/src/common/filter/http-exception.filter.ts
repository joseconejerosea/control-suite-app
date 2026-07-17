import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppException } from '../exceptions/app.exception';
import { SAFE_MESSAGES } from '../exceptions/safe-messages';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    // Defensive: `request` may be undefined/malformed when errors are thrown
    // very early in the lifecycle or when a non-HTTP execution context is
    // routed here (@Catch() has no args). A TypeError inside the global filter
    // makes Nest fall back to its default handler and leak the raw error body,
    // defeating the masking contract — so derive these fields safely.
    const url = request?.url ?? null;
    const method = request?.method ?? null;
    let status: number;
    let message: string;

    // -----------------------------------------------------------------------
    // Branch A — AppException: log technicalDetail, serialize safe userMessage
    // -----------------------------------------------------------------------
    if (exception instanceof AppException) {
      status = exception.getStatus();
      this.logger.error(
        `HTTP ${status} ${exception.technicalDetail} - ${method} ${url}`,
      );
      message = exception.userMessage;
    }
    // -----------------------------------------------------------------------
    // Branch B — plain HttpException: pass-through unchanged (author-controlled,
    // already safe — business 400s, auth 401/403, Nest validation errors, etc.)
    // -----------------------------------------------------------------------
    else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const r = res as { message?: string | string[] };
        message = Array.isArray(r.message)
          ? r.message.join(', ')
          : r.message || String(res);
      } else {
        message = String(res);
      }

      this.logger.error(`HTTP ${status} ${message} - ${method} ${url}`);
    }
    // -----------------------------------------------------------------------
    // Branch C — unhandled / non-HttpException: log full error, send generic 500
    // -----------------------------------------------------------------------
    else {
      status = 500;
      const errorStr =
        exception instanceof Error
          ? `${exception.message}\n${exception.stack ?? ''}`
          : String(exception);
      this.logger.error(
        `HTTP 500 UNHANDLED ${errorStr} - ${method} ${url}`,
      );
      message = SAFE_MESSAGES.UNEXPECTED;
    }

    const payload = {
      success: false,
      error: {
        message,
        statusCode: status,
      },
      timestamp: new Date().toISOString(),
      path: url ?? null,
    };

    // Defensive: if `response` is missing the expected .status().send() API
    // (non-HTTP context, malformed reply), fail safe rather than throw another
    // error out of the global filter.
    if (typeof response?.status === 'function') {
      const sender = response.status(status) as FastifyReply | undefined;
      if (typeof sender?.send === 'function') {
        sender.send(payload);
        return;
      }
    }
    this.logger.error(
      `Unable to send error response (malformed reply) - ${method} ${url}`,
    );
  }
}
