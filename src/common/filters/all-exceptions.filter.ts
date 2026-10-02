import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { Request, Response } from 'express'
import { MulterError } from 'multer'
import { Logger } from 'nestjs-pino'

import type { RequestWithId } from '../middleware/request-id.middleware'
import { MAX_UPLOAD_MB } from '../upload-limits.const'

interface ErrorEnvelope {
  error: {
    code: string
    message: string
    details?: unknown
    /** Request-id, always present — the same value logged server-side and sent as the X-Request-Id header, so a report of "I got this error" can be matched to a log line without guesswork. */
    requestId?: string
    /**
     * Only ever populated when NODE_ENV !== 'production' (see `catch()`
     * below) — the real exception message/name/stack for a genuine 500.
     * Never sent in production: internals must not leak to end users
     * there, they get the same generic `message` a dev sees locally,
     * just without this field.
     */
    debug?: { name: string; message: string; stack?: string }
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
    const request = host.switchToHttp().getRequest<Request>()
    const requestId = (request as RequestWithId).id
    const resolved = this.resolve(exception)
    const isUnhandled = resolved.status >= 500

    if (isUnhandled) {
      this.logger.error({ err: exception, requestId }, `Unhandled exception: ${resolved.message}`)
    }

    const envelope: ErrorEnvelope = {
      error: {
        code: resolved.code,
        message: resolved.message,
        ...(resolved.details !== undefined ? { details: resolved.details } : {}),
        ...(requestId ? { requestId } : {}),
        // Never sent in production — see the `debug` field's doc comment above.
        ...(isUnhandled && process.env.NODE_ENV !== 'production'
          ? { debug: this.debugInfo(exception) }
          : {}),
      },
    }

    response.status(resolved.status).json(envelope)
  }

  private debugInfo(exception: unknown): { name: string; message: string; stack?: string } {
    if (exception instanceof Error) {
      return { name: exception.name, message: exception.message, stack: exception.stack }
    }
    return { name: 'UnknownException', message: String(exception) }
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

    // `MulterError` (thrown mid-multipart-parse when a file exceeds a
    // `FileInterceptor`'s own `limits.fileSize`) is a plain `Error`
    // subclass, never an `HttpException` — without this branch it fell
    // through to the generic 500 "An unexpected error occurred" below,
    // which told a user nothing about *why* their upload failed and
    // logged it as a genuine unhandled server error even though it's a
    // completely ordinary, expected client input problem. Found while
    // investigating a real-usage report of uploads silently failing with
    // no clear error — this was the real backend half of it (the other
    // half was the frontend having no client-side size pre-check at all,
    // fixed separately in `lib/api/client.ts`).
    if (exception instanceof MulterError) {
      return this.resolveMulterError(exception)
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
      const { message, error, code, ...rest } = body as Record<string, unknown>
      delete rest.statusCode

      if (Array.isArray(message)) {
        return { status, code: 'VALIDATION_ERROR', message: 'Validation failed', details: message }
      }

      const resolvedCode =
        typeof code === 'string' ? code : (HTTP_STATUS_CODES[status] ?? 'HTTP_ERROR')
      const resolvedMessage =
        typeof message === 'string'
          ? message
          : typeof error === 'string'
            ? error
            : exception.message
      const details = Object.keys(rest).length > 0 ? rest : undefined

      return { status, code: resolvedCode, message: resolvedMessage, details }
    }

    return { status, code: HTTP_STATUS_CODES[status] ?? 'HTTP_ERROR', message: exception.message }
  }

  private resolveMulterError(exception: MulterError): ResolvedError {
    if (exception.code === 'LIMIT_FILE_SIZE') {
      return {
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        code: 'FILE_TOO_LARGE',
        message: `File exceeds the maximum upload size of ${MAX_UPLOAD_MB}MB — please use a smaller file.`,
      }
    }

    return {
      status: HttpStatus.BAD_REQUEST,
      code: 'UPLOAD_ERROR',
      message: 'This file could not be uploaded.',
    }
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
