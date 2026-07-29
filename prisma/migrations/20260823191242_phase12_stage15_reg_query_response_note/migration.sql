-- The 8 leading DROP INDEX statements Prisma's own diff proposed here are
-- spurious — see the identical entry in the previous migration
-- (phase12_stage15_16_17) for the full explanation. Stripped.

-- AlterTable
ALTER TABLE "reg_query" ADD COLUMN     "response_note_encrypted" TEXT;
