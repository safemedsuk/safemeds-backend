import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { Response } from 'express'
import { Logger } from 'nestjs-pino'

interface ErrorEnvelope {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

interface ResolvedError {
  status: number
  code: string
  message: string
  details?: unknown
}

const HTTP_STATUS_CODES: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.LOCKED]: 'LOCKED',
  [HttpStatus.TOO_MANY_REQUESTS]: 'THROTTLED',
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()
    const resolved = this.resolve(exception)

    if (resolved.status >= 500) {
      this.logger.error({ err: exception }, `Unhandled exception: ${resolved.message}`)
    }

    const envelope: ErrorEnvelope = {
      error: {
        code: resolved.code,
        message: resolved.message,
        ...(resolved.details !== undefined ? { details: resolved.details } : {}),
      },
    }

    response.status(resolved.status).json(envelope)
  }

  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof HttpException) {
      return this.resolveHttpException(exception)
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const resolved = this.resolvePrismaError(exception)
      if (resolved) {
        return resolved
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    }
  }

  private resolveHttpException(exception: HttpException): ResolvedError {
    const status = exception.getStatus()
    const body = exception.getResponse()

    if (typeof body === 'object' && body !== null) {
      const { message, error } = body as { message?: string | string[]; error?: string }

      if (Array.isArray(message)) {
        return { status, code: 'VALIDATION_ERROR', message: 'Validation failed', details: message }
      }

      return {
        status,
        code: HTTP_STATUS_CODES[status] ?? 'HTTP_ERROR',
        message: message ?? error ?? exception.message,
      }
    }

    return { status, code: HTTP_STATUS_CODES[status] ?? 'HTTP_ERROR', message: exception.message }
  }

  private resolvePrismaError(
    exception: Prisma.PrismaClientKnownRequestError,
  ): ResolvedError | undefined {
    if (exception.code === 'P2002') {
      return {
        status: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: 'A record with this value already exists',
        details: exception.meta,
      }
    }

    if (exception.code === 'P2025') {
      return { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND', message: 'Record not found' }
    }

    return undefined
  }
}
