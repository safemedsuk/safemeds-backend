import { PrismaClient } from '@prisma/client'

/**
 * A single PrismaClient shared by test setup/teardown hooks and specs that
 * need to arrange or assert against `safemeds_test` directly.
 */
export const testPrisma = new PrismaClient()
