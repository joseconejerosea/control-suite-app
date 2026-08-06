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

    // Last-resort guard: the ENTIRE resolution + send logic below is wrapped so
    // that a hostile exception whose getStatus()/getResponse()/toString() throws
    // can never escape the global filter. A throwing global filter makes Nest
    // fall back to its default handler and leak the raw error body, defeating
    // the masking contract. The inner catch performs a minimal safe 500 send.
    try {
      let status: number;
      let message: string;

      // ---------------------------------------------------------------------
      // Branch A — AppException: log technicalDetail, serialize safe userMessage
      // ---------------------------------------------------------------------
      if (exception instanceof AppException) {
        status = exception.getStatus();
        this.logger.error(
          `HTTP ${status} ${exception.technicalDetail} - ${method} ${url}`,
        );
        message = exception.userMessage;
      }
      // ---------------------------------------------------------------------
      // Branch B — plain HttpException: message string preserved; re-wrapped in
      // the standard envelope (body shape is normalized, not passed through
      // verbatim). Author-controlled and already safe — business 400s, auth
      // 401/403, Nest validation errors, etc.
      // ---------------------------------------------------------------------
      else if (exception instanceof HttpException) {
        status = exception.getStatus();
        const res = exception.getResponse();

        if (typeof res === 'string') {
          message = res;
        } else if (typeof res === 'object' && res !== null) {
          // Extract `message` robustly. Never serialize `String(res)` of an
          // object — it yields "[object Object]", can leak internal structure,
          // and may throw on a hostile toString(). Fall back to a safe constant.
          const raw = (res as { message?: unknown }).message;
          if (typeof raw === 'string' && raw.length > 0) {
            message = raw;
          } else if (Array.isArray(raw)) {
            message = raw.join(', ');
          } else {
            message = SAFE_MESSAGES.UNEXPECTED;
          }
        } else {
          message = SAFE_MESSAGES.UNEXPECTED;
        }

        this.logger.error(`HTTP ${status} ${message} - ${method} ${url}`);
      }
      // ---------------------------------------------------------------------
      // Branch C — unhandled / non-HttpException: log full error, send generic 500
      // ---------------------------------------------------------------------
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
    } catch (fatal) {
      // The 3-branch logic itself threw (e.g. hostile getStatus()/getResponse()/
      // toString()). Best-effort minimal safe 500 send, guarded by the same
      // API-shape checks so this last resort can't throw either.
      try {
        const fatalMsg =
          fatal instanceof Error ? fatal.message : 'non-Error thrown';
        this.logger.error(
          `HTTP 500 FILTER_FATAL ${fatalMsg} - ${method} ${url}`,
        );
      } catch {
        // Logging must never break the safe send below.
      }
      try {
        if (typeof response?.status === 'function') {
          const sender = response.status(500) as FastifyReply | undefined;
          if (typeof sender?.send === 'function') {
            sender.send({
              success: false,
              error: {
                message: SAFE_MESSAGES.UNEXPECTED,
                statusCode: 500,
              },
              timestamp: new Date().toISOString(),
              path: null,
            });
          }
        }
      } catch {
        // If even the last-resort send is impossible, there is nothing left to
        // do but give up silently — we already logged the fatal above.
      }
    }
  }
}
