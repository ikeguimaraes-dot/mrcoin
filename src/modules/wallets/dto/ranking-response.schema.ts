import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const rankingItemSchema = z.object({
  position: z.number().int().positive(),
  name: z.string(),
  coinsEarned: z.number().int(),
});

export const rankingResponseSchema = z.object({
  items: z.array(rankingItemSchema),
  currentUser: z.object({
    position: z.number().int().positive(),
    coinsEarned: z.number().int(),
  }),
  period: z.string(),
});

export class RankingResponseDto extends createZodDto(rankingResponseSchema) {}
