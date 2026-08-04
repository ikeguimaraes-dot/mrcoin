import { createZodDto } from 'nestjs-zod';
import { paginatedResponseSchema } from '../../../common/schemas/paginated-response.schema';
import { adminSummarySchema } from './admin-summary.schema';

export const listAdminsResponseSchema = paginatedResponseSchema(adminSummarySchema);
export class ListAdminsResponseDto extends createZodDto(listAdminsResponseSchema) {}
