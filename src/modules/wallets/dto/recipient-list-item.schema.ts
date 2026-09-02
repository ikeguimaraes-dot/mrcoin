import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Resultado de GET /wallet/transfer/recipients — só o suficiente pro app montar um
 * seletor e o usuário escolher exatamente uma pessoa antes de confirmar a transferência. */
export const recipientListItemSchema = z.object({
  membershipId: z.string(),
  name: z.string(),
});

export const recipientListResponseSchema = z.object({
  items: z.array(recipientListItemSchema),
});

export class RecipientListResponseDto extends createZodDto(recipientListResponseSchema) {}
