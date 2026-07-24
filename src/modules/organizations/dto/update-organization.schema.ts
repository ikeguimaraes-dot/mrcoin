import { OrganizationPlan } from '@prisma/client';
import { z } from 'zod';

export const updateOrganizationSchema = z
  .object({
    name: z.string().min(1).optional(),
    plan: z.nativeEnum(OrganizationPlan).optional(),
  })
  .refine((data) => data.name !== undefined || data.plan !== undefined, {
    message: 'Informe ao menos um campo (name ou plan).',
  });

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
