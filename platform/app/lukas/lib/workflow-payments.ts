import {z} from 'zod';
import type {WorkflowBlankDocument} from './workflow-blank-document';
import {quantityReviewSchema,type QuantityReviewRound} from './workflow-quantity-review';
import {reportSchema,type DailyReport} from './workflow-daily-reports';
import {inspectionPhase} from './workflow-inspections';
const money=z.number().int().min(1).max(1e12),note=z.string().trim().min(1).max(500);
const terms=z.object({name:z.string().trim().min(1).max(120),partner:z.string().trim().min(1).max(120),amount:money});
export const contractSchema=terms.extend({version:z.number().int().min(1).max(100)});
export type Contract=z.infer<typeof contractSchema>;
const inputSchema=z.object({period:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),amount:money,note,quantitySequence:z.number().int().positive(),dailyId:z.number().int().positive()});
export function quantityAmount(round:QuantityReviewRound){return round.items.reduce((sum,item)=>sum+Math.round((item.quantity.raw+item.quantity.correction)*item.quantity.rate),0);}
export function paymentEvidenceMatches(quantity:QuantityReviewRound,report:DailyReport){return quantity.phase==='approved'&&report.phase==='accepted'&&inspectionPhase(report.inspection)==='closed'&&quantity.source.sha256===report.evidence.source.sha256&&quantity.revision===report.evidence.revision&&quantity.items.some(item=>item.id===report.evidence.objectId&&item.page===report.evidence.page);}
const claimSchema=inputSchema.extend({id:z.number().int().min(1).max(30),previous:z.number().int().positive().optional(),contract:contractSchema,quantity:quantityReviewSchema,report:reportSchema,previousConfirmed:z.number().int().min(0).max(1e12),phase:z.enum(['submitted','changes','accepted']),decision:note.optional()}).refine(item=>item.quantity.sequence===item.quantitySequence&&item.report.id===item.dailyId&&paymentEvidenceMatches(item.quantity,item.report)&&Number.isSafeInteger(quantityAmount(item.quantity))&&item.amount+item.previousConfirmed<=Math.min(item.contract.amount,quantityAmount(item.quantity))&&(item.phase==='submitted'?!item.decision:Boolean(item.decision)));
export const paymentClaimsSchema=z.array(claimSchema).max(30).refine(items=>items.filter(item=>item.phase==='submitted').length<=1&&items.every((item,index)=>item.id===index+1&&(!item.previous||(item.previous<item.id&&items[item.previous-1]?.phase==='changes'&&items.filter(next=>next.previous===item.previous).length===1))));
export type PaymentClaim=z.infer<typeof claimSchema>;
export function confirmedPayments(doc:WorkflowBlankDocument){return (doc.paymentClaims??[]).filter(item=>item.phase==='accepted').reduce((sum,item)=>sum+item.amount,0);}
export function saveContract(doc:WorkflowBlankDocument,role:string,input:unknown):WorkflowBlankDocument{
 const parsed=terms.safeParse(input);if(role!=='author'||!parsed.success||parsed.data.amount<confirmedPayments(doc))return doc;
 const contract=contractSchema.safeParse({...parsed.data,version:(doc.contract?.version??0)+1});return contract.success?{...doc,contract:contract.data}:doc;
}
export function submitPayment(doc:WorkflowBlankDocument,role:string,input:unknown,previous?:number):WorkflowBlankDocument{
 const parsed=inputSchema.safeParse(input),items=doc.paymentClaims??[];
 if(role!=='author'||!doc.contract||!parsed.success||items.length>=30||items.some(item=>item.phase==='submitted'))return doc;
 if(previous!==undefined&&(!items.some(item=>item.id===previous&&item.phase==='changes')||items.some(item=>item.previous===previous)))return doc;
 const claim=claimSchema.safeParse({...parsed.data,id:items.length+1,...(previous===undefined?{}:{previous}),contract:doc.contract,quantity:doc.quantityReviews?.find(item=>item.sequence===parsed.data.quantitySequence),report:doc.dailyReports?.find(item=>item.id===parsed.data.dailyId),previousConfirmed:confirmedPayments(doc),phase:'submitted'});
 return claim.success?{...doc,paymentClaims:[...items,claim.data]}:doc;
}
export function decidePayment(doc:WorkflowBlankDocument,id:number,role:string,phase:'changes'|'accepted',message:string):WorkflowBlankDocument{
 const item=doc.paymentClaims?.find(item=>item.id===id),parsed=note.safeParse(message);
 if(role!=='reviewer'||!item||item.phase!=='submitted'||!parsed.success||(phase==='accepted'&&(doc.contract?.version!==item.contract.version||confirmedPayments(doc)!==item.previousConfirmed)))return doc;
 return {...doc,paymentClaims:doc.paymentClaims!.map(row=>row.id===id?{...row,phase,decision:parsed.data}:row)};
}
