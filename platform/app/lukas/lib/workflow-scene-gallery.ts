import {z} from 'zod';
export const sceneGalleryKey='1hk-sample-scene-gallery-v1';
const frameSchema=z.object({id:z.string().min(1).max(100),name:z.string().trim().min(1).max(80),scenario:z.enum(['architecture','ifc','civil']),revision:z.number().int().positive(),width:z.number().int().positive().max(8192),height:z.number().int().positive().max(8192),dataUrl:z.string().max(2_000_000).regex(/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/)});
const gallerySchema=z.array(frameSchema).max(6).refine(items=>new Set(items.map(item=>item.id)).size===items.length&&JSON.stringify(items).length<=3_000_000);
export type GalleryFrame=z.infer<typeof frameSchema>;
export function readGallery(raw:string|null){return gallerySchema.parse(raw===null?[]:JSON.parse(raw));}
export function addGalleryFrame(items:GalleryFrame[],input:unknown):{ok:true;items:GalleryFrame[]}|{ok:false;error:string}{
 const frame=frameSchema.safeParse(input);if(!frame.success)return {ok:false,error:'유효한 PNG 이미지와 장면 이름을 확인하세요. 이미지당 최대 2MB입니다.'};
 const next=gallerySchema.safeParse([...items,frame.data]);return next.success?{ok:true,items:next.data}:{ok:false,error:'이미지 보관 한도(전체 6개·약 3MB) 또는 중복 항목을 확인하세요. 기존 이미지는 덮어쓰지 않습니다.'};
}
