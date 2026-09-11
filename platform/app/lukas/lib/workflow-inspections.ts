import {z} from 'zod';
import type {WorkflowBlankDocument} from './workflow-blank-document';
import {fieldNoteMatches} from './workflow-document-field';

export const inspectionChecks=['도면·시공 위치 일치','치수·설치 상태','작업 구역 안전 상태'] as const;
const note=z.string().trim().min(1).max(500);
const checks=z.tuple([z.enum(['pass','fail','na']),z.enum(['pass','fail','na']),z.enum(['pass','fail','na'])]).refine(values=>values.some(value=>value!=='na'));
const eventSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('inspect'),note,checks}),
 z.object({action:z.literal('rectify'),note}),
 z.object({action:z.literal('reinspect'),note,checks}),
]);
type Event=z.infer<typeof eventSchema>;
type Phase='new'|'correction'|'reinspection'|'closed';
function after(event:Event):Phase{return event.action==='rectify'?'reinspection':event.checks.includes('fail')?'correction':'closed';}
const allowed=(phase:Phase,action:string)=>phase==='new'?action==='inspect':phase==='correction'?action==='rectify':phase==='reinspection'?action==='reinspect':false;
export const inspectionSchema=z.object({fieldNoteId:z.number().int().positive(),events:z.array(eventSchema).min(1).max(30)}).refine(item=>{
 let phase:Phase='new';
 for(const event of item.events){if(!allowed(phase,event.action))return false;phase=after(event);}
 return true;
});
export const inspectionsSchema=z.array(inspectionSchema).max(100).refine(items=>new Set(items.map(item=>item.fieldNoteId)).size===items.length);
export type Inspection=z.infer<typeof inspectionSchema>;
export function inspectionPhase(item?:Inspection):Phase{return item?after(item.events[item.events.length-1]):'new';}
export function recordInspection(doc:WorkflowBlankDocument,fieldNoteId:number,role:string,action:string,input:unknown):WorkflowBlankDocument {
 const source=doc.fieldNotes?.find(item=>item.id===fieldNoteId),item=doc.inspections?.find(item=>item.fieldNoteId===fieldNoteId);
 if(!source||!fieldNoteMatches(doc,source)||role!==(action==='rectify'?'author':'reviewer')||!allowed(inspectionPhase(item),action))return doc;
 const event=eventSchema.safeParse({...input as object,action});if(!event.success)return doc;
 const updated=inspectionSchema.safeParse({fieldNoteId,events:[...(item?.events??[]),event.data]});if(!updated.success)return doc;
 return {...doc,inspections:item?doc.inspections!.map(row=>row.fieldNoteId===fieldNoteId?updated.data:row):[...(doc.inspections??[]),updated.data]};
}
