import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const searchRecipientsQuerySchema = z.object({
  organizationId: z.string().min(1),
  query: z.string().min(1),
});

export type SearchRecipientsQuery = z.infer<typeof searchRecipientsQuerySchema>;
export class SearchRecipientsQueryDto extends createZodDto(searchRecipientsQuerySchema) {}
