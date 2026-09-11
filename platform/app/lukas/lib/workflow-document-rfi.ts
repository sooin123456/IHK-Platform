import {z} from 'zod';
import {commentMatches,objectCommentSchema} from './workflow-document-comments';
import type {WorkflowBlankDocument} from './workflow-blank-document';
const note=z.string().trim().min(1).max(1000);
const due=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
 const date=new Date(`${value}T00:00:00Z`);return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
});
const assignmentHistorySchema=z.array(z.object({id:z.number().int().min(1).max(20),fromAssignee:z.enum(['reviewer','approver']),fromDue:due,assignee:z.enum(['reviewer','approver']),due,reason:note})).min(1).max(20).refine(items=>items.every((item,index)=>item.id===index+1&&(!index||(item.fromAssignee===items[index-1].assignee&&item.fromDue===items[index-1].due))));
const inputSchema=z.object({objectId:z.string(),title:z.string().trim().min(1).max(120),question:note,assignee:z.enum(['reviewer','approver']),due});
export const rfiSchema=objectCommentSchema.extend({id:z.number().int().positive().max(100),role:z.literal('author'),title:z.string().trim().min(1).max(120),assignee:z.enum(['reviewer','approver']),due,phase:z.enum(['requested','answered','closed']),answer:note.optional(),closure:note.optional(),assignmentHistory:assignmentHistorySchema.optional(),reopenedFrom:z.number().int().positive().max(100).optional(),reopenReason:note.optional()}).refine(record=>!record.assignmentHistory||record.assignmentHistory.at(-1)?.assignee===record.assignee&&record.assignmentHistory.at(-1)?.due===record.due).refine(record=>Boolean(record.reopenedFrom)===Boolean(record.reopenReason)&&(!record.reopenedFrom||record.reopenedFrom<record.id)).refine(record=>record.phase==='requested'?!record.answer&&!record.closure:record.phase==='answered'?Boolean(record.answer)&&!record.closure:Boolean(record.answer&&record.closure));
export type DocumentRfi=z.infer<typeof rfiSchema>;
export const rfiDraftSchema=z.object({key:z.string().min(1).max(600),title:z.string().max(120),question:z.string().max(1000),due:z.string().max(10),assignee:z.enum(['reviewer','approver']),text:z.string().max(1000)});
export type RfiDraft=z.infer<typeof rfiDraftSchema>;
export function rfiDraftKey(document:WorkflowBlankDocument,objectId:string,role:string,stage:string){
 const shape=document.shapes.find(shape=>shape.id===objectId);
 return JSON.stringify([document.id,document.source?.sha256??'',document.revision??1,objectId,shape?.page??1,shape?.x,shape?.y,role,stage]);
}
export function saveRfiDraft(document:WorkflowBlankDocument,input:unknown):WorkflowBlankDocument{
 const parsed=rfiDraftSchema.safeParse(input);if(!parsed.success)return document;
 const drafts=document.rfiDrafts??[];const exists=drafts.some(draft=>draft.key===parsed.data.key);
 if(!exists&&drafts.length>=200)return document;
 return {...document,rfiDrafts:exists?drafts.map(draft=>draft.key===parsed.data.key?parsed.data:draft):[...drafts,parsed.data]};
}
function consumeDraft(document:WorkflowBlankDocument,key:string){return document.rfiDrafts?document.rfiDrafts.filter(draft=>draft.key!==key):undefined;}
export function selectRfis(documents:WorkflowBlankDocument[],filters:{search?:string;phase?:string;assignee?:string;document?:string;queue?:boolean;role?:string}){
 const search=filters.search?.trim().toLocaleLowerCase()??'';
 return documents.flatMap(document=>(document.rfis??[]).map(record=>({document,record}))).filter(({document,record})=>{
  if(filters.document&&filters.document!==document.id)return false;
  if(filters.phase&&filters.phase!==record.phase)return false;
  if(filters.assignee&&filters.assignee!==record.assignee)return false;
  if(search&&!`${document.title} ${record.title} ${record.objectLabel} ${record.text} ${record.answer??''}`.toLocaleLowerCase().includes(search))return false;
  if(filters.queue)return record.phase==='requested'?record.assignee===filters.role:record.phase==='answered'&&filters.role==='author';
  return true;
 });
}
export function createRfi(document:WorkflowBlankDocument,role:string,input:unknown):WorkflowBlankDocument{
 const parsed=inputSchema.safeParse(input);if(role!=='author'||!parsed.success)return document;
 const shape=document.shapes.find(shape=>shape.id===parsed.data.objectId);if(!shape)return document;
 const record=rfiSchema.safeParse({...parsed.data,id:Math.max(0,...(document.rfis??[]).map(record=>record.id))+1,objectLabel:shape.label,page:shape.page??1,revision:document.revision??1,x:shape.x,y:shape.y,sourceHash:document.source?.sha256,text:parsed.data.question,role:'author',phase:'requested'});
 return record.success?{...document,rfis:[...(document.rfis??[]),record.data],rfiDrafts:consumeDraft(document,rfiDraftKey(document,shape.id,role,'compose'))}:document;
}
export function actOnRfi(document:WorkflowBlankDocument,id:number,role:string,action:'answer'|'close',text:string):WorkflowBlankDocument{
 const record=document.rfis?.find(record=>record.id===id);const parsed=note.safeParse(text);
 if(!record||!parsed.success||!commentMatches(document,record))return document;
 if(action==='answer'&&(record.phase!=='requested'||role!==record.assignee))return document;
 if(action==='close'&&(record.phase!=='answered'||role!=='author'))return document;
 const next:DocumentRfi=action==='answer'?{...record,phase:'answered',answer:parsed.data}:{...record,phase:'closed',closure:parsed.data};
 return {...document,rfis:document.rfis?.map(record=>record.id===id?next:record),rfiDrafts:consumeDraft(document,rfiDraftKey(document,record.objectId,role,`${record.id}:${record.phase}`))};
}
export function reopenRfi(document:WorkflowBlankDocument,id:number,role:string,input:unknown):WorkflowBlankDocument{
 const record=document.rfis?.find(row=>row.id===id),parsed=z.object({reason:note,due,assignee:z.enum(['reviewer','approver'])}).safeParse(input);
 if(role!=='author'||!record||record.phase!=='closed'||!parsed.success||!commentMatches(document,record)||document.rfis?.some(row=>row.reopenedFrom===id))return document;
 const next=rfiSchema.safeParse({...record,id:Math.max(0,...(document.rfis??[]).map(row=>row.id))+1,phase:'requested',answer:undefined,closure:undefined,assignmentHistory:undefined,assignee:parsed.data.assignee,due:parsed.data.due,reopenedFrom:id,reopenReason:parsed.data.reason});
 return next.success?{...document,rfis:[...(document.rfis??[]),next.data],rfiDrafts:consumeDraft(document,rfiDraftKey(document,record.objectId,role,`${record.id}:${record.phase}`))}:document;
}
export function reassignRfi(document:WorkflowBlankDocument,id:number,role:string,input:unknown):WorkflowBlankDocument{
 const record=document.rfis?.find(row=>row.id===id),parsed=z.object({reason:note,due,assignee:z.enum(['reviewer','approver'])}).safeParse(input);
 if(role!=='author'||!record||record.phase!=='requested'||!parsed.success||!commentMatches(document,record)||(record.assignmentHistory?.length??0)>=20)return document;
 const change=parsed.data;if(record.assignee===change.assignee&&record.due===change.due)return document;
 const history={id:(record.assignmentHistory?.length??0)+1,fromAssignee:record.assignee,fromDue:record.due,...change};
 const next=rfiSchema.safeParse({...record,assignee:change.assignee,due:change.due,assignmentHistory:[...(record.assignmentHistory??[]),history]});
 return next.success?{...document,rfis:document.rfis?.map(row=>row.id===id?next.data:row),rfiDrafts:consumeDraft(document,rfiDraftKey(document,record.objectId,role,`${record.id}:${record.phase}`))}:document;
}
