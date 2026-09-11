import type {WorkflowBlankDocument} from './workflow-blank-document';
import {documentQuantityRow,type DocumentQuantity} from './workflow-document-quantity';
export function compareDocumentQuantities(document:WorkflowBlankDocument,sequence:number,targetSequence?:number) {
 const approved=document.quantityReviews?.find(round=>round.sequence===sequence&&round.phase==='approved');
 if(!approved)return null;
 const target=targetSequence===undefined?undefined:document.quantityReviews?.find(round=>round.sequence===targetSequence&&round.phase==='approved');
 if(targetSequence!==undefined&&!target)return null;
 const compatible=approved.source.sha256===(target?.source??document.source)?.sha256;
 const before=new Map(approved.items.map(item=>[item.id,item]));
 const after=new Map((target?.items??document.shapes.filter(shape=>shape.quantity)).map(shape=>[shape.id,shape]));
 const staleIds=new Set(target?[]:document.shapes.filter(shape=>documentQuantityRow(document,shape)?.stale).map(shape=>shape.id));
 const amount=(q:DocumentQuantity)=>Math.round((q.raw+q.correction)*q.rate);
 const rows=[...new Set([...before.keys(),...after.keys()])].map(id=>{
  const old=before.get(id),current=after.get(id);
  const stale=staleIds.has(id),unitChanged=Boolean(old&&current&&old.quantity.unit!==current.quantity!.unit);
  const beforeAmount=old?amount(old.quantity):0,afterAmount=current?amount(current.quantity!):0;
  const kind=!old?'added':!current?'removed':JSON.stringify(old.quantity)!==JSON.stringify(current.quantity)||old.label!==current.label?'changed':'same';
  return {id,label:current?.label??old!.label,page:current?.page??old?.page??1,kind,stale,unitChanged,before:old?.quantity,after:current?.quantity,beforeAmount,afterAmount,delta:compatible&&!stale?afterAmount-beforeAmount:null};
 });
 const beforeTotal=rows.reduce((sum,row)=>sum+row.beforeAmount,0);
 const afterTotal=compatible&&!rows.some(row=>row.stale)?rows.reduce((sum,row)=>sum+row.afterAmount,0):null;
 return {approved,target,compatible,rows,beforeTotal,afterTotal,delta:afterTotal===null?null:afterTotal-beforeTotal};
}
