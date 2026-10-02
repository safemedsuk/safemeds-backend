import { HttpStatus } from '@nestjs/common'
import { MulterError } from 'multer'

import { AllExceptionsFilter } from './all-exceptions.filter'
import { MAX_UPLOAD_MB } from '../upload-limits.const'

describe('AllExceptionsFilter', () => {
  function buildHost() {
    const json = jest.fn()
    const status = jest.fn().mockReturnValue({ json })
    const response = { status }
    const request = { id: 'req-1' }
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    }
    return { host, status, json }
  }

  function buildFilter(): AllExceptionsFilter {
    const logger = { error: jest.fn() } as unknown as import('nestjs-pino').Logger
    return new AllExceptionsFilter(logger)
  }

  // Real-usage report, 1 Oct 2026 — a file upload exceeding the
  // configured multer limit used to fall through to a generic 500
  // "An unexpected error occurred" with no mention of the real cause
  // (MulterError isn't an HttpException). This is the regression test
  // for the fix.
  it('maps a MulterError LIMIT_FILE_SIZE to a clear 413 FILE_TOO_LARGE response', () => {
    const filter = buildFilter()
    const { host, status, json } = buildHost()

    const error = new MulterError('LIMIT_FILE_SIZE')
    filter.catch(error, host as unknown as import('@nestjs/common').ArgumentsHost)

    expect(status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'FILE_TOO_LARGE',
          message: expect.stringContaining(`${MAX_UPLOAD_MB}MB`),
        }),
      }),
    )
  })

  it('maps any other MulterError to a 400 UPLOAD_ERROR response', () => {
    const filter = buildFilter()
    const { host, status, json } = buildHost()

    const error = new MulterError('LIMIT_UNEXPECTED_FILE')
    filter.catch(error, host as unknown as import('@nestjs/common').ArgumentsHost)

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'UPLOAD_ERROR' }) }),
    )
  })

  it('still falls back to a generic 500 for a genuinely unknown exception', () => {
    const filter = buildFilter()
    const { host, status, json } = buildHost()

    filter.catch(new Error('boom'), host as unknown as import('@nestjs/common').ArgumentsHost)

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'INTERNAL_SERVER_ERROR' }) }),
    )
  })
})
