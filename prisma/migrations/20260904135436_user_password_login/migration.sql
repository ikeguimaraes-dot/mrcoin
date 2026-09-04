-- Login do app vira CPF+senha, síncrono, sem OTP no caminho feliz. OTP passa a servir só
-- recuperação/definição de senha — UserLoginRequest é renomeada (mesma forma, dado e índice
-- preservados) em vez de recriada, já que a tabela sempre teve exatamente o shape que a
-- recuperação precisa.

-- RenameTable: UserLoginRequest -> UserPasswordResetRequest (sem perda de dado).
ALTER TABLE "UserLoginRequest" RENAME TO "UserPasswordResetRequest";

-- RenameIndex: acompanha o rename da tabela.
ALTER INDEX "UserLoginRequest_pkey" RENAME TO "UserPasswordResetRequest_pkey";
ALTER INDEX "UserLoginRequest_cpfHash_idx" RENAME TO "UserPasswordResetRequest_cpfHash_idx";

-- AlterTable: senha de login (hash argon2id, nulo = conta ainda sem senha).
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
