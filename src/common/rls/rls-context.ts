import type { Prisma } from '@prisma/client'
import { AsyncLocalStorage } from 'async_hooks'

export interface RlsContext {
  tx: Prisma.TransactionClient
}

/**
 * Lets a service method deep in a call chain (e.g. a private helper
 * called from several public methods) reuse the caller's already-bound
 * RLS transaction instead of needing `tx` threaded through every
 * function signature by hand. Entered exclusively by `RlsService` — see
 * its doc comment for the full model.
 */
export const rlsAls = new AsyncLocalStorage<RlsContext>()
