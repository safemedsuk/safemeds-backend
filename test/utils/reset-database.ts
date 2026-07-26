import { PrismaClient } from '@prisma/client'

/**
 * Truncates every application table between e2e tests so specs never leak
 * state into one another. Generic over whatever tables exist at a given
 * phase — a no-op today (Phase 0 has no models yet), and requires no
 * changes as Phase 1+ adds tables.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations')
  `

  if (tables.length === 0) {
    return
  }

  const names = tables.map((table) => `"public"."${table.tablename}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE;`)
}
