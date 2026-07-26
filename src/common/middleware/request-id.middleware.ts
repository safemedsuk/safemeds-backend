import { randomUUID } from 'crypto'
import type { NextFunction, Request, Response } from 'express'

const REQUEST_ID_HEADER = 'x-request-id'

export type RequestWithId = Request & { id: string }

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[REQUEST_ID_HEADER]
  const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID()

  ;(req as RequestWithId).id = id
  res.setHeader('X-Request-Id', id)

  next()
}
