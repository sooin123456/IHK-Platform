import {z} from 'zod';
export const deliveryIdentityFields={reference:z.string().trim().min(1).max(80).optional(),issuedOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}).optional()};
export const deliveryIdentitySchema=z.object(deliveryIdentityFields).refine(value=>Boolean(value.reference)===Boolean(value.issuedOn));
