import {z} from 'zod';
import type {WorkflowBlankDocument} from './workflow-blank-document';
const inputSchema=z.object({recipient:z.string().trim().email().max(254),permission:z.enum(['view','comment']),includeQuantity:z.boolean()});
export const shareAccessSchema=z.object({id:z.number().int().min(1).max(20),message:z.string().trim().min(1).max(500),status:z.enum(['pending','allowed','denied']),decision:z.string().trim().min(1).max(500).optional()}).refine(request=>request.status==='pending'?!request.decision:Boolean(request.decision));
export type ShareAccess=z.infer<typeof shareAccessSchema>;
export type DocumentShare={sequence:number;recipient:string;permission:'view'|'comment';includeQuantity:boolean;title:string;revision:number;source?:WorkflowBlankDocument['source'];objects:WorkflowBlankDocument['shapes'];status:'active'|'expired';feedback:string[];accessRequests?:ShareAccess[];invitation?:'pending'|'accepted'|'declined'};
export function respondShareInvitation(document:WorkflowBlankDocument,sequence:number,email:string,response:'accepted'|'declined'):WorkflowBlankDocument{
 const share=document.shares?.find(item=>item.sequence===sequence);
 if(!share||share.status!=='active'||share.invitation!=='pending'||email.trim().toLowerCase()!==share.recipient.toLowerCase())return document;
 return {...document,shares:document.shares?.map(item=>item===share?{...item,invitation:response}:item)};
}
export function requestShareAccess(document:WorkflowBlankDocument,sequence:number,message:string):WorkflowBlankDocument{
 const share=document.shares?.find(share=>share.sequence===sequence),requests=share?.accessRequests??[];
 if(!share||share.status!=='expired'||requests.some(request=>request.status==='pending')||requests.length>=20)return document;
 const parsed=shareAccessSchema.safeParse({id:requests.length+1,message,status:'pending'});if(!parsed.success)return document;
 return {...document,shares:document.shares?.map(item=>item===share?{...item,accessRequests:[...requests,parsed.data]}:item)};
}
export function decideShareAccess(document:WorkflowBlankDocument,sequence:number,id:number,role:string,action:'allow'|'deny',decision:string):WorkflowBlankDocument{
 const share=document.shares?.find(share=>share.sequence===sequence),request=share?.accessRequests?.find(request=>request.id===id);
 if(role!=='author'||!share||share.status!=='expired'||request?.status!=='pending')return document;
 const parsed=shareAccessSchema.safeParse({...request,status:action==='allow'?'allowed':'denied',decision});if(!parsed.success)return document;
 return {...document,shares:document.shares?.map(item=>item===share?{...item,status:action==='allow'?'active':'expired',accessRequests:item.accessRequests?.map(value=>value.id===id?parsed.data:value)}:item)};
}
export function createDocumentShare(document:WorkflowBlankDocument,role:string,input:unknown):WorkflowBlankDocument{
 const parsed=inputSchema.safeParse(input);if(role!=='author'||!parsed.success||(document.shares?.length??0)>=20)return document;
 const objects=document.shapes.filter(shape=>document.layers?.find(layer=>layer.id===shape.layerId)?.visible!==false).map(shape=>{const {quantity,layerId,...geometry}=shape;return {...geometry,...(parsed.data.includeQuantity&&quantity?{quantity}:{} )};});
 const share:DocumentShare={...parsed.data,sequence:Math.max(0,...(document.shares??[]).map(share=>share.sequence))+1,title:document.title,revision:document.revision??1,source:document.source?structuredClone(document.source):undefined,objects:structuredClone(objects),status:'active',feedback:[],invitation:'pending'};
 return {...document,shares:[...(document.shares??[]),share]};
}
export function shareFeedback(document:WorkflowBlankDocument,sequence:number,message:string):WorkflowBlankDocument{
 const share=document.shares?.find(share=>share.sequence===sequence);
 if(!share||share.status!=='active'||(share.invitation&&share.invitation!=='accepted')||share.permission!=='comment'||!message.trim()||message.length>500||share.feedback.length>=50)return document;
 return {...document,shares:document.shares?.map(item=>item===share?{...item,feedback:[...item.feedback,message.trim()]}:item)};
}
export function expireDocumentShare(document:WorkflowBlankDocument,sequence:number,role:string):WorkflowBlankDocument{
 if(role!=='author'||!document.shares?.some(share=>share.sequence===sequence&&share.status==='active'))return document;
 return {...document,shares:document.shares.map(share=>share.sequence===sequence?{...share,status:'expired'}:share)};
}
