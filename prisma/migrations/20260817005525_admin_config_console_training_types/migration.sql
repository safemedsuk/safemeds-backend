-- CreateTable
CREATE TABLE "training_type_catalog_entry" (
    "id" UUID NOT NULL,
    "country_id" UUID,
    "type_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "training_type_catalog_entry_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "training_type_catalog_entry" ADD CONSTRAINT "training_type_catalog_entry_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE SET NULL ON UPDATE CASCADE;
