import {z} from 'zod';
import type {WorkflowBlankDocument} from './workflow-blank-document';
export const importManifestSchema=z.object({id:z.string().min(1).max(100),name:z.string().min(1).max(500),size:z.number().int().nonnegative(),sha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),format:z.enum(['PDF','DWG','IFC','OTHER']),status:z.enum(['pending','ready','needs-engine','unsupported','failed']),pages:z.number().int().positive().optional(),documentId:z.string().min(1).max(100).optional()}).refine(record=>record.status!=='ready'||(record.format==='PDF'&&Boolean(record.sha256&&record.pages))).refine(record=>!record.documentId||record.status==='ready');
export type ImportRecord=z.infer<typeof importManifestSchema>;
export function appendImportRecords(records:ImportRecord[],incoming:ImportRecord[]){
 const result=[...records];for(const record of incoming){
  if(!importManifestSchema.safeParse(record).success)continue;
  const index=result.findIndex(existing=>existing.id===record.id),previous=result[index];
  if(previous&&(!['pending','failed'].includes(previous.status)||previous.documentId||previous.name!==record.name||previous.size!==record.size||previous.format!==record.format||(previous.sha256&&previous.sha256!==record.sha256)))continue;
  const duplicate=record.status!=='pending'&&record.sha256&&result.some(existing=>existing.id!==record.id&&existing.status!=='pending'&&existing.sha256===record.sha256&&existing.format===record.format);
  if(duplicate){if(index>=0)result.splice(index,1);continue;}
  if(index>=0)result[index]=record;else if(result.length<100)result.push(record);
 }return result;
}
export function documentFromImport(record:ImportRecord,id:string):WorkflowBlankDocument|null{
 if(record.status!=='ready'||record.format!=='PDF'||!record.pages||!record.sha256)return null;
 return {id,title:record.name.slice(0,120),source:{name:record.name,sha256:record.sha256,pages:record.pages},page:1,revision:1,shapes:[]};
}
