import { StreamableFile } from '@nestjs/common'
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { map, Observable } from 'rxjs'

import { PaginatedResult } from '../pagination'

interface SuccessEnvelope<T> {
  data: T
  meta?: unknown
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, SuccessEnvelope<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<SuccessEnvelope<T>> {
    return next.handle().pipe(
      map((response) => {
        // A file stream is the body itself — never wrap it in the JSON envelope.
        if (response instanceof StreamableFile) {
          return response as unknown as SuccessEnvelope<T>
        }
        if (response instanceof PaginatedResult) {
          return { data: response.data as unknown as T, meta: response.meta }
        }

        return { data: response }
      }),
    )
  }
}
