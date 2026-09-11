import {z} from 'zod';
import type {WorkflowBlankDocument} from './workflow-blank-document';
import {documentFieldNoteSchema,fieldNoteMatches} from './workflow-document-field';
import {inspectionSchema} from './workflow-inspections';
import {scheduleDate} from './workflow-schedule';
const text=z.string().trim().min(1).max(500);
const inputSchema=z.object({date:z.string().refine(value=>scheduleDate(value,1)===value),work:text,next:text,weather:z.string().trim().min(1).max(50),workers:z.number().int().min(0).max(10000),progress:z.number().finite().min(0).max(100),fieldNoteId:z.number().int().positive()});
export const reportSchema=inputSchema.extend({id:z.number().int().positive().max(100),previous:z.number().int().positive().optional(),evidence:documentFieldNoteSchema,inspection:inspectionSchema.optional(),phase:z.enum(['submitted','changes','accepted']),decision:text.optional()}).refine(item=>item.evidence.id===item.fieldNoteId&&(!item.inspection||item.inspection.fieldNoteId===item.fieldNoteId)&&(item.phase==='submitted'?!item.decision:Boolean(item.decision)));
export const dailyReportsSchema=z.array(reportSchema).max(100).refine(items=>items.every((item,index)=>item.id===index+1&&(!item.previous||(item.previous<item.id&&items[item.previous-1]?.phase==='changes'&&items.filter(next=>next.previous===item.previous).length===1))));
export type DailyReport=z.infer<typeof reportSchema>;
export function submitDailyReport(doc:WorkflowBlankDocument,role:string,input:unknown,previous?:number):WorkflowBlankDocument{
 const parsed=inputSchema.safeParse(input),items=doc.dailyReports??[];
 if(role!=='author'||!parsed.success||items.length>=100)return doc;
 const evidence=doc.fieldNotes?.find(row=>row.id===parsed.data.fieldNoteId);
 if(!evidence||!fieldNoteMatches(doc,evidence))return doc;
 if(previous!==undefined&&(!items.some(row=>row.id===previous&&row.phase==='changes')||items.some(row=>row.previous===previous)))return doc;
 const inspection=doc.inspections?.find(row=>row.fieldNoteId===evidence.id);
 const report=reportSchema.safeParse({...parsed.data,id:items.length+1,...(previous===undefined?{}:{previous}),evidence,...(inspection?{inspection}:{}),phase:'submitted'});
 return report.success?{...doc,dailyReports:[...items,report.data]}:doc;
}
export function decideDailyReport(doc:WorkflowBlankDocument,id:number,role:string,phase:'changes'|'accepted',note:string):WorkflowBlankDocument{
 const report=doc.dailyReports?.find(row=>row.id===id),parsed=text.safeParse(note);
 if(!report||report.phase!=='submitted'||role!=='reviewer'||!parsed.success)return doc;
 // Review acknowledges the frozen daily report, not current drawing conformity.
 return {...doc,dailyReports:doc.dailyReports!.map(row=>row.id===id?{...row,phase,decision:parsed.data}:row)};
}
