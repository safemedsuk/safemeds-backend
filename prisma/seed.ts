import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // Phase 0: no seed data yet. Idempotent upserts land here per phase —
  // roles & permissions (P2), countries & Kenya config (P4),
  // workflow definitions (P5), demo tenant for dev.
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
