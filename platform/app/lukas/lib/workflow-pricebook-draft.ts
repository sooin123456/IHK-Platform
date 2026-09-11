import {z} from 'zod';
import {parsePriceBookCsvRows} from './workflow-pricebook';
export const priceBookFileDraftSchema=z.object({name:z.string().min(1).max(500),text:z.string().max(300000),mapping:z.array(z.number().int().min(-1).max(10000)).length(5)}).refine(file=>{const parsed=parsePriceBookCsvRows(file.text);return !parsed.errors.length&&parsed.rows.length>0&&file.mapping.every(index=>index<parsed.rows[0].length);});
export const priceBookDraftSchema=z.object({csv:z.string().max(300000),file:priceBookFileDraftSchema.optional()});
export type PriceBookDraft=z.infer<typeof priceBookDraftSchema>;
export type PriceBookFileDraft=z.infer<typeof priceBookFileDraftSchema>;
