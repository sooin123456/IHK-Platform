import {z} from 'zod';
import type {WorkflowBlankDocument} from './workflow-blank-document';
import {canEditDocument} from './workflow-document-review';
import {editableDraftLayer} from './workflow-document-layers';
const label=z.string().trim().min(1).max(120);
const common={key:z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),label,required:z.boolean()};
const fieldSchema=z.discriminatedUnion('type',[
 z.object({...common,type:z.literal('text')}),
 z.object({...common,type:z.literal('number'),unit:z.string().trim().max(20).optional()}),
 z.object({...common,type:z.literal('choice'),options:z.array(label).min(1).max(20).refine(values=>new Set(values).size===values.length)}),
]);
const inputSchema=z.object({name:label,code:label,fields:z.array(fieldSchema).min(1).max(12).refine(fields=>new Set(fields.map(field=>field.key)).size===fields.length&&new Set(fields.map(field=>field.label)).size===fields.length)});
export const propertyStandardSchema=inputSchema.extend({id:z.string().min(1).max(80),version:z.number().int().min(1).max(50)});
export type PropertyStandard=z.infer<typeof propertyStandardSchema>;
export const propertyStandardsSchema=z.array(propertyStandardSchema).max(50).refine(items=>new Set(items.map(item=>`${item.id}:${item.version}`)).size===items.length);
export const customPropertiesSchema=z.object({standard:propertyStandardSchema,values:z.record(z.string(),z.union([z.string().max(500),z.number().finite()]))}).refine(({standard,values})=>Object.keys(values).every(key=>standard.fields.some(field=>field.key===key))&&standard.fields.every(field=>{
 const value=values[field.key];if(value===undefined||value==='')return !field.required;
 return field.type==='number'?typeof value==='number':typeof value==='string'&&(field.type==='text'||field.options.includes(value));
}));
export type CustomProperties=z.infer<typeof customPropertiesSchema>;
export function savePropertyStandard(items:PropertyStandard[],id:string,input:unknown):PropertyStandard[]{
 const parsed=propertyStandardSchema.safeParse({...input as object,id,version:Math.max(0,...items.filter(item=>item.id===id).map(item=>item.version))+1});
 if(!parsed.success||items.length>=50||items.some(item=>item.id!==id&&item.code.toLowerCase()===parsed.data.code.toLowerCase()))return items;
 return [...items,parsed.data];
}
export function applyPropertyStandard(doc:WorkflowBlankDocument,objectId:string,role:string,standard:PropertyStandard,values:unknown):WorkflowBlankDocument{
 const shape=doc.shapes.find(shape=>shape.id===objectId),parsed=customPropertiesSchema.safeParse({standard,values});
 if(role!=='author'||!canEditDocument(doc,'author')||!shape||!editableDraftLayer(doc,shape)||!parsed.success)return doc;
 return {...doc,shapes:doc.shapes.map(shape=>shape.id===objectId?{...shape,customProperties:parsed.data}:shape)};
}
