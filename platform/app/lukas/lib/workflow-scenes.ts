import {z} from 'zod';
const point=z.tuple([z.number().finite().min(-10000).max(10000),z.number().finite().min(-10000).max(10000),z.number().finite().min(-10000).max(10000)]);
const schema=z.object({id:z.string().min(1).max(80),name:z.string().trim().min(1).max(80),scenario:z.enum(['architecture','ifc','civil']),revision:z.number().int().positive(),position:point,target:point,section:z.boolean(),grid:z.boolean(),isolated:z.boolean()}).refine(scene=>Math.hypot(...scene.position.map((value,index)=>value-scene.target[index]))>.001);
export type WorkflowScene=z.infer<typeof schema>;
export function readScene(raw:string|undefined):WorkflowScene|null{try{const parsed=schema.safeParse(JSON.parse(raw??''));return parsed.success?parsed.data:null;}catch{return null;}}
export function savedScenes(drafts:Record<string,string>,scenario:string){
 const scenes=Object.entries(drafts).flatMap(([key,value])=>{if(!key.startsWith('scene:'))return [];const scene=readScene(value);return scene&&key===`scene:${scene.id}`&&scene.scenario===scenario?[scene]:[];});
 try{const parsed=z.array(z.string()).max(12).safeParse(JSON.parse(drafts[`scene-order:${scenario}`]??''));if(!parsed.success)return scenes;const order=parsed.data;return scenes.sort((a,b)=>(order.includes(a.id)?order.indexOf(a.id):order.length)-(order.includes(b.id)?order.indexOf(b.id):order.length));}catch{return scenes;}
}
