import {z} from 'zod';
export const fieldPhotoSchema=z.object({name:z.string().min(1).max(500),sha256:z.string().regex(/^[a-f0-9]{64}$/),size:z.number().int().positive().max(10*1024*1024),mime:z.enum(['image/jpeg','image/png','image/webp'])});
export type FieldPhoto=z.infer<typeof fieldPhotoSchema>;
export function readFieldPhotoDraft(drafts:Record<string,string>,prefix:string):FieldPhoto[]{
 return [0,1,2].flatMap(index=>{const key=`${prefix}:${index}`;const parsed=fieldPhotoSchema.safeParse({name:drafts[`${key}:name`],sha256:drafts[`${key}:sha256`],size:Number(drafts[`${key}:size`]),mime:drafts[`${key}:mime`]});return parsed.success?[parsed.data]:[];});
}
export function fieldPhotoDraftPatch(photos:FieldPhoto[],prefix:string):Record<string,string>{
 const parsed=z.array(fieldPhotoSchema).max(3).safeParse(photos);if(!parsed.success)return {};
 return Object.fromEntries([0,1,2].flatMap(index=>(['name','sha256','size','mime'] as const).map(field=>[`${prefix}:${index}:${field}`,parsed.data[index]?String(parsed.data[index][field]):''])));
}
const files=new Map<string,File>();
export function recallFieldPhoto(hash:string){return files.get(hash)??null;}
export async function inspectFieldPhoto(file:File,expected?:FieldPhoto):Promise<FieldPhoto>{
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<=0||file.size>10*1024*1024)throw new Error('JPEG·PNG·WebP 사진을 10MB 이하로 선택하세요.');
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');
 if(expected&&sha256!==expected.sha256)throw new Error('기록한 사진과 내용이 다릅니다. 같은 원본 사진을 선택하세요.');
 const bitmap=await createImageBitmap(file);bitmap.close();
 const photo=fieldPhotoSchema.parse({name:file.name,sha256,size:file.size,mime:file.type});
 files.delete(sha256);files.set(sha256,file);
 while(files.size>12||[...files.values()].reduce((sum,file)=>sum+file.size,0)>30*1024*1024){const first=files.keys().next().value;if(!first)break;files.delete(first);}
 return photo;
}
