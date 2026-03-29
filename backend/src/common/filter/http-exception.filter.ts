import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let status = 500;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const r = res as any;
        message = Array.isArray(r.message)
          ? r.message.join(', ')
          : r.message || message;
      }
    }

    // Safe logging (no sensitive data)
    this.logger.error(
      `HTTP ${status} Error: ${message} - ${request.method} ${request.url}`,
    );

    
    response.status(status).send({
      success: false,
      error: {
        message,
        statusCode: status,
      },
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}