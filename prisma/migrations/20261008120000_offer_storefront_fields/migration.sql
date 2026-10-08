-- Categorias passam a ser administráveis sem alterar o contrato textual de Offer.category.
CREATE TABLE "OfferCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OfferCategory_name_key" ON "OfferCategory"("name");
CREATE UNIQUE INDEX "OfferCategory_slug_key" ON "OfferCategory"("slug");

-- O hash evita colisões entre nomes cuja normalização resulte no mesmo slug.
INSERT INTO "OfferCategory" ("id", "name", "slug")
SELECT
    'legacy-' || md5("category"),
    "category",
    trim(BOTH '-' FROM lower(regexp_replace("category", '[^a-zA-Z0-9]+', '-', 'g')))
      || '-' || substring(md5("category"), 1, 8)
FROM "Offer"
GROUP BY "category";

ALTER TABLE "Offer"
    ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "originalCost" INTEGER;

CREATE INDEX "Offer_category_idx" ON "Offer"("category");
CREATE INDEX "Offer_featured_idx" ON "Offer"("featured");

ALTER TABLE "Offer" ADD CONSTRAINT "Offer_category_fkey"
FOREIGN KEY ("category") REFERENCES "OfferCategory"("name")
ON DELETE RESTRICT ON UPDATE CASCADE;
