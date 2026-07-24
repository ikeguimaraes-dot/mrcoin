import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

const CODE_BY_STATUS: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
};

/** Normaliza toda resposta de erro pro formato {code, message, details?} do CLAUDE.md. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status: number = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error('Exceção não tratada', exception instanceof Error ? exception.stack : exception);
    }

    response.status(status).json(this.normalize(exception, status));
  }

  private normalize(exception: unknown, status: number): ErrorBody {
    if (!(exception instanceof HttpException)) {
      return { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor.' };
    }

    const body: unknown = exception.getResponse();

    if (this.isErrorBody(body)) {
      return body;
    }

    const message = this.extractMessage(body) ?? exception.message;
    return { code: CODE_BY_STATUS[status] ?? 'HTTP_ERROR', message };
  }

  private isErrorBody(value: unknown): value is ErrorBody {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { code?: unknown }).code === 'string' &&
      typeof (value as { message?: unknown }).message === 'string'
    );
  }

  private extractMessage(body: unknown): string | undefined {
    if (typeof body === 'string') {
      return body;
    }

    if (typeof body !== 'object' || body === null || !('message' in body)) {
      return undefined;
    }

    const raw: unknown = body.message;
    const value: unknown = Array.isArray(raw) ? (raw as unknown[])[0] : raw;

    return typeof value === 'string' ? value : undefined;
  }
}
