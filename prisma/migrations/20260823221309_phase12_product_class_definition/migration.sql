-- The 8 DropIndex statements Prisma's own diff generated here are
-- spurious — real, hand-written BRIN/trigram indexes it can't see in
-- schema.prisma (see CLAUDE.md's own documented gotcha on this exact
-- failure mode). Stripped before applying; never run this migration
-- with them restored.

-- CreateTable
CREATE TABLE "product_class_definition" (
    "id" UUID NOT NULL,
    "authority_id" UUID,
    "class_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "source_reference" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_class_definition_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "product_class_definition" ADD CONSTRAINT "product_class_definition_authority_id_fkey" FOREIGN KEY ("authority_id") REFERENCES "regulatory_authority"("id") ON DELETE SET NULL ON UPDATE CASCADE;
