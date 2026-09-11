import {z} from 'zod';
import {supportingFilesSchema} from './workflow-supporting-files';
import type {WorkflowBlankDocument} from './workflow-blank-document';
import {documentFieldNoteSchema,fieldNoteMatches} from './workflow-document-field';
import {inspectionSchema,inspectionPhase} from './workflow-inspections';
const label=z.string().trim().min(1).max(120),note=z.string().trim().min(1).max(500);
const assetSchema=z.object({objectId:z.string().min(1).max(100),code:label,name:label,location:label,manufacturer:label,model:label,manual:note,archived:z.boolean().optional(),manualFiles:supportingFilesSchema.optional(),warrantyEnd:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}).optional(),maintenanceContact:label.optional(),maintenancePlan:note.optional()});
export const assetRegisterSchema=z.array(assetSchema).max(100).refine(items=>new Set(items.map(item=>item.objectId)).size===items.length&&new Set(items.map(item=>item.code.toLowerCase())).size===items.length);
export type AssetEntry=z.infer<typeof assetSchema>;
const handoverAsset=assetSchema.extend({evidence:documentFieldNoteSchema,inspection:inspectionSchema}).refine(item=>item.objectId===item.evidence.objectId&&item.evidence.id===item.inspection.fieldNoteId&&inspectionPhase(item.inspection)==='closed');
const handoverSchema=z.object({id:z.number().int().min(1).max(20),previous:z.number().int().positive().optional(),revision:z.number().int().positive(),recipient:label,assets:z.array(handoverAsset).min(1).max(100),phase:z.enum(['prepared','changes','received']),feedback:note.optional()}).refine(item=>new Set(item.assets.map(asset=>asset.objectId)).size===item.assets.length&&item.assets.every(asset=>asset.evidence.revision===item.revision&&asset.evidence.source.sha256===item.assets[0].evidence.source.sha256)&&(item.phase==='prepared'?!item.feedback:Boolean(item.feedback)));
export const handoversSchema=z.array(handoverSchema).max(20).refine(items=>items.filter(item=>item.phase==='prepared').length<=1&&items.every((item,index)=>item.id===index+1&&(!item.previous||(item.previous<item.id&&items[item.previous-1]?.phase==='changes'&&items.filter(next=>next.previous===item.previous).length===1))));
export type Handover=z.infer<typeof handoverSchema>;
export function saveAsset(doc:WorkflowBlankDocument,role:string,input:unknown):WorkflowBlankDocument{
 const asset=assetSchema.safeParse(input);if(role!=='author'||!asset.success||doc.assetRegister?.some(row=>row.objectId===asset.data.objectId&&row.archived)||!doc.shapes.some(shape=>shape.id===asset.data.objectId))return doc;
 const items=doc.assetRegister??[],updated=items.some(item=>item.objectId===asset.data.objectId)?items.map(item=>item.objectId===asset.data.objectId?asset.data:item):[...items,asset.data];
 const result=assetRegisterSchema.safeParse(updated);return result.success?{...doc,assetRegister:result.data}:doc;
}
export function setAssetArchived(doc:WorkflowBlankDocument,role:string,objectId:string,archived:boolean):WorkflowBlankDocument{
 const asset=doc.assetRegister?.find(row=>row.objectId===objectId);if(role!=='author'||!asset||Boolean(asset.archived)===archived)return doc;
 return {...doc,assetRegister:doc.assetRegister!.map(row=>row.objectId===objectId?{...row,archived}:row)};
}
export function handoverReadiness(doc:WorkflowBlankDocument,revision:number){
 const round=doc.reviewRounds?.find(row=>row.revision===revision&&row.phase==='approved');
 const rows=(doc.assetRegister??[]).filter(asset=>!asset.archived).map(asset=>{
  const evidence=round?[...(doc.fieldNotes??[])].reverse().find(record=>record.objectId===asset.objectId&&fieldNoteMatches({...doc,source:round.source,revision:round.revision,shapes:round.objects},record)):undefined;
  const inspection=evidence?doc.inspections?.find(row=>row.fieldNoteId===evidence.id):undefined;
  return {asset,evidence,inspection,ready:!!round&&!!evidence&&inspectionPhase(inspection)==='closed'};
 });
 return {round,rows,ready:!!round&&rows.length>0&&rows.every(row=>row.ready)};
}
export function prepareHandover(doc:WorkflowBlankDocument,role:string,revision:number,recipient:string,previous?:number,objectIds?:string[]):WorkflowBlankDocument{
 const check=handoverReadiness(doc,revision),items=doc.handovers??[];
 if(objectIds&&(!objectIds.length||new Set(objectIds).size!==objectIds.length||objectIds.some(id=>!check.rows.some(row=>row.asset.objectId===id))))return doc;
 const selected=objectIds?check.rows.filter(row=>objectIds.includes(row.asset.objectId)):check.rows;
 if(role!=='author'||!check.round||!selected.length||!selected.every(row=>row.ready)||items.length>=20||items.some(item=>item.phase==='prepared'))return doc;
 if(previous!==undefined&&(!items.some(item=>item.id===previous&&item.phase==='changes')||items.some(item=>item.previous===previous)))return doc;
 const result=handoverSchema.safeParse({id:items.length+1,...(previous===undefined?{}:{previous}),revision,recipient,assets:selected.map(row=>({...row.asset,evidence:row.evidence,inspection:row.inspection})),phase:'prepared'});
 return result.success?{...doc,handovers:[...items,result.data]}:doc;
}
export function decideHandover(doc:WorkflowBlankDocument,id:number,role:string,phase:'changes'|'received',message:string,verifiedFileHashes:string[]=[]):WorkflowBlankDocument{
 const item=doc.handovers?.find(item=>item.id===id),parsed=note.safeParse(message);
 if(phase==='received'&&item?.assets.some(asset=>asset.manualFiles?.some(file=>!verifiedFileHashes.includes(file.sha256))))return doc;
 if(role!=='recipient'||!item||item.phase!=='prepared'||!parsed.success)return doc;
 return {...doc,handovers:doc.handovers!.map(row=>row.id===id?{...row,phase,feedback:parsed.data}:row)};
}
