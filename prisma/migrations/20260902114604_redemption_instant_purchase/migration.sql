-- Redemption vira compra instantânea: nasce CONFIRMED (débito imediato), DELIVERED marca
-- só a entrega física. PENDING/EXPIRED ficam no enum (Postgres não tem DROP VALUE) mas a
-- aplicação nunca mais escreve nenhum dos dois — ver RedemptionsService.

-- AlterEnum: aditivo, sem tocar valores existentes.
ALTER TYPE "RedemptionStatus" ADD VALUE 'DELIVERED';

-- CreateEnum
CREATE TYPE "DeliveredByType" AS ENUM ('PARTNER', 'PLATFORM_ADMIN');

-- DropIndex (a coluna expiresAt que ele indexava está saindo)
DROP INDEX IF EXISTS "Redemption_status_expiresAt_idx";

-- RenameColumn: code -> pickupCode (preserva o unique constraint/index, nenhum dado perdido)
ALTER TABLE "Redemption" RENAME COLUMN "code" TO "pickupCode";

-- AlterTable: remove expiresAt (TTL não existe mais), status perde o default (a aplicação
-- sempre define explicitamente CONFIRMED na criação), adiciona os campos de entrega.
ALTER TABLE "Redemption"
  DROP COLUMN "expiresAt",
  ALTER COLUMN "status" DROP DEFAULT,
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "deliveredByType" "DeliveredByType",
  ADD COLUMN "deliveredById" TEXT;

-- AlterTable: PIN de transação (hash argon2id, nulo = ainda não configurado).
ALTER TABLE "User" ADD COLUMN "transactionPinHash" TEXT;
