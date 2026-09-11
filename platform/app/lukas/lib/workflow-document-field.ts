import {z} from 'zod';
import type {WorkflowBlankDocument} from './workflow-blank-document';
import {fieldPhotoSchema} from './workflow-field-photo';
import {scheduleDate} from './workflow-schedule';
const segment=z.string().trim().min(1).max(50);
export const fieldLocationSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('building'),building:segment,floor:segment,room:segment}),
 z.object({kind:z.literal('civil'),route:segment,section:segment,station:segment}),
]);
export type FieldLocation=z.infer<typeof fieldLocationSchema>;
export function formatFieldLocation(path:FieldLocation){return (path.kind==='building'?[path.building,path.floor,path.room]:[path.route,path.section,path.station]).join(' / ');}
const input=z.object({observedOn:z.string().refine(value=>scheduleDate(value,1)!==null).optional(),title:z.string().trim().min(1).max(120),note:z.string().trim().min(1).max(1000),location:z.string().trim().min(1).max(160),locationPath:fieldLocationSchema.optional(),photos:z.array(fieldPhotoSchema).max(3).refine(photos=>new Set(photos.map(photo=>photo.sha256)).size===photos.length).optional(),condition:z.enum(['changed','conforming','needs-check'])});
export const documentFieldNoteSchema=input.extend({id:z.number().int().positive().max(100),objectId:z.string().min(1).max(100),objectLabel:z.string().max(120),page:z.number().int().positive(),revision:z.number().int().positive(),x:z.number().finite(),y:z.number().finite(),source:z.object({name:z.string().min(1).max(500),sha256:z.string().regex(/^[a-f0-9]{64}$/),pages:z.number().int().positive()})}).refine(note=>note.page<=note.source.pages).refine(note=>!note.locationPath||note.location===formatFieldLocation(note.locationPath));
export type DocumentFieldNote=z.infer<typeof documentFieldNoteSchema>;
export function addDocumentFieldNote(document:WorkflowBlankDocument,objectId:string,role:string,value:z.infer<typeof input>):WorkflowBlankDocument {
 const shape=document.shapes.find(item=>item.id===objectId),parsed=input.safeParse(value);
 const id=Math.max(0,...(document.fieldNotes??[]).map(item=>item.id))+1;
 if(!shape||!document.source||!['author','reviewer'].includes(role)||!parsed.success||id>100)return document;
 const note=documentFieldNoteSchema.safeParse({...parsed.data,id,source:{...document.source},objectId:shape.id,objectLabel:shape.label,page:shape.page??1,revision:document.revision??1,x:shape.x,y:shape.y});
 return note.success?{...document,fieldNotes:[...(document.fieldNotes??[]),note.data]}:document;
}
export function fieldNoteMatches(document:WorkflowBlankDocument,note:DocumentFieldNote) {
 const shape=document.shapes.find(item=>item.id===note.objectId);
 return Boolean(shape&&document.source?.sha256===note.source.sha256&&(document.revision??1)===note.revision&&(shape.page??1)===note.page&&shape.x===note.x&&shape.y===note.y);
}
