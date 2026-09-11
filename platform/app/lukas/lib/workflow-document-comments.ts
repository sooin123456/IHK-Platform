import {z} from 'zod';
import type {WorkflowBlankDocument} from './workflow-blank-document';
export const objectCommentSchema=z.object({id:z.number().int().positive().max(200),objectId:z.string().min(1).max(100),objectLabel:z.string().max(120),page:z.number().int().positive(),revision:z.number().int().positive(),x:z.number().finite(),y:z.number().finite(),sourceHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),text:z.string().trim().min(1).max(1000),role:z.enum(['author','reviewer','approver'])});
export type ObjectComment=z.infer<typeof objectCommentSchema>;
export function addObjectComment(document:WorkflowBlankDocument,objectId:string,role:string,text:string):WorkflowBlankDocument{
 const shape=document.shapes.find(shape=>shape.id===objectId);if(!shape)return document;
 const id=Math.max(0,...(document.objectComments??[]).map(comment=>comment.id))+1;
 const parsed=objectCommentSchema.safeParse({id,objectId,objectLabel:shape.label,page:shape.page??1,revision:document.revision??1,x:shape.x,y:shape.y,sourceHash:document.source?.sha256,text,role});
 return parsed.success?{...document,objectComments:[...(document.objectComments??[]),parsed.data]}:document;
}
export function commentMatches(document:WorkflowBlankDocument,comment:ObjectComment){
 const shape=document.shapes.find(shape=>shape.id===comment.objectId);
 return Boolean(shape&&(document.revision??1)===comment.revision&&document.source?.sha256===comment.sourceHash&&(shape.page??1)===comment.page&&shape.x===comment.x&&shape.y===comment.y);
}
