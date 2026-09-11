import {z} from 'zod';
import {supportingFilesSchema} from './workflow-supporting-files';
import type {WorkflowBlankDocument} from './workflow-blank-document';
const note=z.string().trim().min(1).max(500);
const inputSchema=z.object({title:z.string().trim().min(1).max(120),assignee:z.enum(['reviewer','approver']),reviewerEmail:z.string().email().max(254).optional(),reviewerName:z.string().trim().min(1).max(80).optional(),message:note,due:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const date=new Date(`${value}T00:00:00Z`);return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;})});
const attachmentSchema=z.object({documentId:z.string().min(1).max(100),documentTitle:z.string().min(1).max(120),revision:z.number().int().positive(),sourceName:z.string().max(500),drawingKey:z.string().min(1).max(500000)});
const requestSchema=inputSchema.extend({supportingFiles:supportingFilesSchema.optional(),attachmentIds:z.array(z.string().min(1).max(100)).max(9).refine(ids=>new Set(ids).size===ids.length).optional()});
export const submittalSchema=inputSchema.extend({
 id:z.number().int().min(1).max(100),previous:z.number().int().min(1).max(100).optional(),
 revision:z.number().int().positive(),documentTitle:z.string().min(1).max(120),
 sourceName:z.string().max(500),drawingKey:z.string().min(1).max(500000),
 attachments:z.array(attachmentSchema).max(9).refine(items=>new Set(items.map(item=>item.documentId)).size===items.length).optional(),
 supportingFiles:supportingFilesSchema.optional(),
 phase:z.enum(['submitted','changes','accepted']),decision:note.optional(),decisionBy:z.string().email().max(254).optional(),
}).refine(item=>item.phase==='submitted'?!item.decision:Boolean(item.decision));
export const submittalsSchema=z.array(submittalSchema).max(100).refine(items=>items.every((item,index)=>item.id===index+1&&(!item.previous||(item.previous<item.id&&items[item.previous-1]?.phase==='changes'&&items.filter(next=>next.previous===item.previous).length===1))));
export type DrawingSubmittal=z.infer<typeof submittalSchema>;
export function submittalQueue(documents:WorkflowBlankDocument[],role:string,actorEmail?:string){
 return documents.flatMap(document=>(document.submittals??[]).filter(item=>item.phase==='submitted'?item.assignee===role&&(!actorEmail||item.reviewerEmail===actorEmail):item.phase==='changes'&&role==='author'&&!document.submittals?.some(next=>next.previous===item.id)).map(item=>({document,item}))).sort((a,b)=>a.item.due.localeCompare(b.item.due)||a.document.id.localeCompare(b.document.id)||a.item.id-b.item.id);
}
function drawingKey(doc:WorkflowBlankDocument){return JSON.stringify([doc.title,doc.revision??1,doc.source??null,doc.layers??[],doc.shapes],(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);}
export function submittalMatches(doc:WorkflowBlankDocument,item:DrawingSubmittal,documents:WorkflowBlankDocument[]=[]){return item.drawingKey===drawingKey(doc)&&(item.attachments??[]).every(attachment=>{const related=documents.find(document=>document.id===attachment.documentId);return related&&related.projectId===doc.projectId&&attachment.drawingKey===drawingKey(related);});}
export function submittalAttachmentMatches(doc:WorkflowBlankDocument,attachment:z.infer<typeof attachmentSchema>){return attachment.documentId===doc.id&&attachment.drawingKey===drawingKey(doc);}
export function submitDrawing(doc:WorkflowBlankDocument,role:string,input:unknown,previous?:number,documents:WorkflowBlankDocument[]=[]):WorkflowBlankDocument{
 const parsed=requestSchema.safeParse(input),items=doc.submittals??[];
 if(role!=='author'||!parsed.success||items.length>=100)return doc;
 const related=(parsed.data.attachmentIds??[]).map(id=>documents.find(document=>document.id===id));
 if(related.some(document=>!document||document.id===doc.id||document.projectId!==doc.projectId))return doc;
 const attachments=related.map(document=>({documentId:document!.id,documentTitle:document!.title,revision:document!.revision??1,sourceName:document!.source?.name??'원본 없는 작업',drawingKey:drawingKey(document!)}));
 if(previous!==undefined&&(!items.some(item=>item.id===previous&&item.phase==='changes')||items.some(item=>item.previous===previous)))return doc;
 const item=submittalSchema.safeParse({...parsed.data,...(attachments.length?{attachments}:{}),id:items.length+1,...(previous===undefined?{}:{previous}),revision:doc.revision??1,documentTitle:doc.title,sourceName:doc.source?.name??'원본 없는 작업',drawingKey:drawingKey(doc),phase:'submitted'});
 return item.success?{...doc,submittals:[...items,item.data]}:doc;
}
export function decideSubmittal(doc:WorkflowBlankDocument,id:number,role:string,phase:'changes'|'accepted',message:string,documents:WorkflowBlankDocument[]=[],verifiedFileHashes:string[]=[],actorEmail?:string):WorkflowBlankDocument{
 const item=doc.submittals?.find(item=>item.id===id),parsed=note.safeParse(message);
 if(item?.reviewerEmail&&item.reviewerEmail!==actorEmail)return doc;
 if(!item||item.phase!=='submitted'||role!==item.assignee||!parsed.success||(phase==='accepted'&&!submittalMatches(doc,item,documents)))return doc;
 if(phase==='accepted'&&item.supportingFiles?.some(file=>!verifiedFileHashes.includes(file.sha256)))return doc;
 return {...doc,submittals:doc.submittals?.map(row=>row.id===id?{...row,phase,decision:parsed.data,...(actorEmail?{decisionBy:actorEmail}:{})}:row)};
}
