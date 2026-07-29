-- The 8 DropIndex statements Prisma's own diff generated here are
-- spurious — real, hand-written BRIN/trigram indexes it can't see in
-- schema.prisma (see CLAUDE.md's own documented gotcha on this exact
-- failure mode). Stripped before applying; never run this migration
-- with them restored.

-- AlterTable
ALTER TABLE "psmf" ADD COLUMN     "content" JSONB;
