import {z} from 'zod';
import {measurementValue} from './workflow-measurement';
const point=z.object({x:z.number().finite().min(0).max(1),y:z.number().finite().min(0).max(1)});
export const measurementRecordSchema=z.object({
 id:z.number().int().positive().max(100),source:z.object({name:z.string().min(1).max(500),sha256:z.string().regex(/^[a-f0-9]{64}$/),pages:z.number().int().positive()}),page:z.number().int().positive(),revision:z.number().int().positive(),
 kind:z.enum(['distance','path','area']),reference:z.array(point).length(2),target:z.array(point).min(2).max(100),length:z.number().finite().positive(),aspect:z.number().finite().positive(),
}).refine(record=>record.page<=record.source.pages&&measurementValue(record)!==null);
