import type {WorkflowBlankDocument} from './workflow-blank-document';
import {documentLayers} from './workflow-document-layers';
type Shape=WorkflowBlankDocument['shapes'][number];
function signature(shape:Shape) {
 return JSON.stringify([shape.x,shape.y,shape.page??1,shape.kind??'rectangle',shape.label,shape.layerId??'default',shape.width??120,shape.height??80,shape.rotation??0,shape.stroke??'#aaa0d0',shape.fill??'#ede9fe',shape.lineWidth??2,shape.points?.map(p=>[p.x,p.y])??[],shape.closed??false]);
}
export function compareDrawingObjects(document:WorkflowBlankDocument,revision:number,targetRevision?:number) {
 const approved=document.reviewRounds?.find(round=>round.revision===revision&&round.phase==='approved');
 const target=targetRevision===undefined?undefined:document.reviewRounds?.find(round=>round.revision===targetRevision&&round.phase==='approved');
 if(!approved||(targetRevision!==undefined&&!target))return null;
 const before=new Map(approved.objects.map(shape=>[shape.id,shape]));const after=new Map((target?.objects??document.shapes).map(shape=>[shape.id,shape]));
 const rows=[...new Set([...before.keys(),...after.keys()])].map(id=>{
  const a=before.get(id),b=after.get(id);
  const kind=!a?'added':!b?'removed':signature(a)!==signature(b)?'changed':'same';
  return {id,before:a,after:b,kind} as const;
 });
 const priorLayers=documentLayers(approved),nextLayers=documentLayers(target??document);
 const layerRows=[...new Set([...priorLayers.map(layer=>layer.id),...nextLayers.map(layer=>layer.id)])].map(id=>{
  const beforeIndex=priorLayers.findIndex(layer=>layer.id===id),afterIndex=nextLayers.findIndex(layer=>layer.id===id);
  const before=priorLayers[beforeIndex],after=nextLayers[afterIndex];
  const changes:string[]=[];
  if(before&&after){for(const key of ['name','visible','locked'] as const)if(before[key]!==after[key])changes.push(key);if(beforeIndex!==afterIndex)changes.push('order');}
  const kind=!before?'added':!after?'removed':changes.length?'changed':'same';
  return {id,before,after,beforeIndex,afterIndex,changes,kind} as const;
 });
 return {approved,target,compatible:approved.source.sha256===(target?.source??document.source)?.sha256,rows,layerRows};
}
