-- CreateTable
CREATE TABLE "UserLoginRequest" (
    "id" TEXT NOT NULL,
    "cpfHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserLoginRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserLoginRequest_cpfHash_idx" ON "UserLoginRequest"("cpfHash");
