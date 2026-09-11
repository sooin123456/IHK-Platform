import {z} from 'zod';
import type {WorkflowBlankDocument} from './workflow-blank-document';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const parsed=new Date(value+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;});
const input=z.object({sequence:z.number().int().min(1).max(20),objectId:z.string().min(1).max(100),kind:z.enum(['order','receive','install','cancel-order','return','uninstall']),amount:z.number().finite().positive().max(1e6),reason:z.string().trim().min(1).max(500),recordedOn:date.optional(),expectedOn:date.optional(),supplier:z.string().trim().min(1).max(120).optional(),orderId:z.number().int().positive().max(500).optional()});
const validFields=(entry:z.infer<typeof input>)=>(!entry.expectedOn||(!!entry.recordedOn&&entry.expectedOn>=entry.recordedOn))&&(entry.kind==='order'?entry.orderId===undefined:entry.expectedOn===undefined&&entry.supplier===undefined);
export const materialEventSchema=input.extend({id:z.number().int().positive().max(500)}).refine(validFields);
export type MaterialEvent=z.infer<typeof materialEventSchema>;
const effects={order:['order',1],receive:['receive',1],install:['install',1],'cancel-order':['order',-1],return:['receive',-1],uninstall:['install',-1]} as const;
export function materialEventSign(kind:MaterialEvent['kind']){return effects[kind][1];}
export function validMaterialHistory(document:WorkflowBlankDocument){
 let replay:WorkflowBlankDocument={...document,materialEvents:[]};
 for(const event of document.materialEvents??[]){
  const next=recordMaterialEvent(replay,'author',event);
  if(next===replay||next.materialEvents?.at(-1)?.id!==event.id)return false;
  replay=next;
 }
 return true;
}
export function materialTotals(document:WorkflowBlankDocument,sequence:number,objectId:string){
 const total={order:0,receive:0,install:0};
 for(const event of document.materialEvents??[])if(event.sequence===sequence&&event.objectId===objectId){const [bucket,sign]=effects[event.kind];total[bucket]+=sign*event.amount;}
 return total;
}
export function recordMaterialEvent(document:WorkflowBlankDocument,role:string,value:z.infer<typeof input>):WorkflowBlankDocument{
 const parsed=input.refine(validFields).safeParse(value);
 if(role!=='author'||!parsed.success)return document;
 const entry=parsed.data,round=document.quantityReviews?.find(round=>round.sequence===entry.sequence&&round.phase==='approved');
 if(!round?.items.some(item=>item.id===entry.objectId))return document;
 const events=document.materialEvents??[],id=Math.max(0,...events.map(event=>event.id))+1;
 if(id>500)return document;
 if(entry.orderId!==undefined){const order=events.find(event=>event.id===entry.orderId&&event.kind==='order'&&event.sequence===entry.sequence&&event.objectId===entry.objectId);if(!order)return document;const linked=materialOrderTotals(document,entry.orderId);const [bucket,sign]=effects[entry.kind];linked[bucket]+=sign*entry.amount;if(Object.values(linked).some(value=>value<0)||linked.receive>linked.order||linked.install>linked.receive)return document;}
 const totals=materialTotals(document,entry.sequence,entry.objectId);
 const [bucket,sign]=effects[entry.kind];totals[bucket]+=sign*entry.amount;
 if(Object.values(totals).some(value=>!Number.isFinite(value)||value<0)||totals.receive>totals.order||totals.install>totals.receive)return document;
 return {...document,materialEvents:[...events,{...entry,id}]};
}

export function materialOrderTotals(document:WorkflowBlankDocument,orderId:number){
 const total={order:0,receive:0,install:0};
 for(const event of document.materialEvents??[])if((event.id===orderId&&event.kind==='order')||event.orderId===orderId){const [bucket,sign]=effects[event.kind];total[bucket]+=sign*event.amount;}return total;
}
export function materialOrderDue(document:WorkflowBlankDocument,orderId:number,today:string){
 const order=document.materialEvents?.find(event=>event.id===orderId&&event.kind==='order'),total=materialOrderTotals(document,orderId);
 if(!order)return 'missing';if(total.order===0)return 'cancelled';if(total.receive>=total.order)return 'received';if(!order.expectedOn)return 'unknown';return order.expectedOn<today?'late':order.expectedOn===today?'due':'planned';
}
