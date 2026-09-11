import {z} from 'zod';
export const supportingFileSchema=z.object({name:z.string().min(1).max(500),sha256:z.string().regex(/^[a-f0-9]{64}$/),size:z.number().int().positive().max(10*1024*1024)});
export const supportingFilesSchema=z.array(supportingFileSchema).max(5).refine(files=>new Set(files.map(file=>file.sha256)).size===files.length);
export type SupportingFile=z.infer<typeof supportingFileSchema>;
export const supportingFileAccept='.pdf,.docx,.xlsx,.csv,.txt,.png,.jpg,.jpeg';
// Raw files live only in bounded runtime memory; snapshots contain metadata only.
const files=new Map<string,File>();
export function recallSupportingFile(hash:string){return files.get(hash)??null;}
export async function inspectSupportingFile(file:File,expected?:SupportingFile):Promise<SupportingFile>{
 if(!/\.(pdf|docx|xlsx|csv|txt|png|jpe?g)$/i.test(file.name)||file.size<=0||file.size>10*1024*1024)throw new Error('지원하는 보조 자료 PDF·DOCX·XLSX·CSV·TXT·PNG·JPEG를 10MB 이하로 선택하세요.');
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');
 if(expected&&(expected.sha256!==sha256||expected.size!==file.size))throw new Error('기록한 원본과 내용이 다릅니다. 동일한 파일을 다시 선택하세요.');
 const metadata=supportingFileSchema.parse({name:file.name,sha256,size:file.size});
 files.delete(sha256);files.set(sha256,file);
 while(files.size>10||[...files.values()].reduce((sum,file)=>sum+file.size,0)>64*1024*1024){const first=files.keys().next().value;if(first===undefined)break;files.delete(first);}
 return metadata;
}
export function readSupportingFileDraft(drafts:Record<string,string>,prefix:string){
 return [0,1,2,3,4].flatMap(index=>{const key=`${prefix}:${index}`,parsed=supportingFileSchema.safeParse({name:drafts[`${key}:name`],sha256:drafts[`${key}:sha256`],size:Number(drafts[`${key}:size`])});return parsed.success?[parsed.data]:[];});
}
export function supportingFileDraftPatch(files:SupportingFile[],prefix:string):Record<string,string>{
 if(!supportingFilesSchema.safeParse(files).success)return {};
 return Object.fromEntries([0,1,2,3,4].flatMap(index=>(['name','sha256','size'] as const).map(field=>[`${prefix}:${index}:${field}`,files[index]?String(files[index][field]):''])));
}
