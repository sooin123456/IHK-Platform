import {z} from 'zod';
import type {WorkflowBlankDocument,WorkflowDeliveryPackage} from './workflow-blank-document';
import {deliveryQuantityReview} from './workflow-document-delivery';
export const outputJobSchema=z.object({phase:z.enum(['processing','failed','cancelled','ready']),attempt:z.number().int().min(1).max(100),sourceHash:z.string().regex(/^[a-f0-9]{64}$/)});
export type OutputJob=z.infer<typeof outputJobSchema>;
function basis(document:WorkflowBlankDocument,delivery:WorkflowDeliveryPackage){
 const drawing=document.reviewRounds?.find(round=>round.revision===delivery.revision&&round.phase==='approved');
 if(!drawing||(delivery.quantityReviewSequence!==undefined&&!deliveryQuantityReview(document,delivery.revision,delivery.quantityReviewSequence)))return undefined;
 return drawing.source.sha256;
}
export function validOutputJobs(document:WorkflowBlankDocument){return [...(document.deliveryHistory??[]),...(document.delivery?[document.delivery]:[])].every(delivery=>!delivery.output||delivery.output.sourceHash===basis(document,delivery));}
export function updateOutputJob(document:WorkflowBlankDocument,sequence:number,action:'start'|'failed'|'cancelled'|'ready'):WorkflowBlankDocument{
 const delivery=document.delivery;if(!delivery||delivery.sequence!==sequence)return document;
 const sourceHash=basis(document,delivery);if(!sourceHash||(delivery.output&&delivery.output.sourceHash!==sourceHash))return document;
 const previous=delivery.output;
 if(action==='start'&&(previous?.phase==='processing'||(previous?.attempt??0)>=100))return document;
 if(action!=='start'&&previous?.phase!=='processing')return document;
 const output:OutputJob={phase:action==='start'?'processing':action,attempt:action==='start'?(previous?.attempt??0)+1:previous!.attempt,sourceHash};
 return {...document,delivery:{...delivery,output}};
}
