import type {WorkflowBlankDocument} from './workflow-blank-document';
import {deliveryQuantityReview} from './workflow-document-delivery';
export function transmittalRows(documents:WorkflowBlankDocument[]){
 return documents.flatMap(document=>[...(document.delivery?[{delivery:document.delivery,current:true}]:[]),...(document.deliveryHistory??[]).slice().reverse().map(delivery=>({delivery,current:false}))].map(({delivery,current})=>{
  const round=document.reviewRounds?.find(round=>round.phase==='approved'&&round.revision===delivery.revision);
  const valid=Boolean(round)&&(delivery.quantityReviewSequence===undefined||Boolean(deliveryQuantityReview(document,delivery.revision,delivery.quantityReviewSequence)));
  return {key:JSON.stringify([document.id,delivery.sequence??0]),document,delivery,current,round,available:current&&valid&&delivery.linkStatus!=='expired'};
 }));
}
export type TransmittalRow=ReturnType<typeof transmittalRows>[number];
export function distributionManifest(rows:TransmittalRow[],batchId:string){
 const members=rows.filter(row=>row.delivery.batchId===batchId);
 if(!members.length)return null;
 return {format:'1hk-local-distribution-manifest',version:1,simulated:true,includesOriginalFiles:false,batchId,
  notice:'Local UI manifest only. No original files, transmission, verified receipt or quantity approvals are included. Document titles and receipt states reflect the current local register; source metadata references the selected approved revision.',
  drawings:members.map(row=>({documentId:row.document.id,currentDocumentTitle:row.document.title,projectId:row.document.projectId??null,packageSequence:row.delivery.sequence??0,reference:row.delivery.reference??null,issuedOn:row.delivery.issuedOn??null,recipient:row.delivery.recipient,revision:row.delivery.revision,source:row.round?{...row.round.source}:null,approvedObjectCount:row.round?.objects.length??null,status:row.delivery.status,feedback:row.delivery.feedback??null,current:row.current,available:row.available,linkStatus:row.delivery.linkStatus??'active'}))};
}
export function filterTransmittals(rows:TransmittalRow[],query:string,status:string){
 const search=query.trim().toLocaleLowerCase();
 return rows.filter(row=>(!search||`${row.document.title} ${row.delivery.recipient} ${row.delivery.reference??''} ${row.delivery.issuedOn??''} ${row.round?.source.name??''}`.toLocaleLowerCase().includes(search))&&(status==='all'||status==='waiting'&&row.available&&row.delivery.status==='prepared'||status==='received'&&row.delivery.status==='received'||status==='correction'&&row.delivery.status==='correction'||status==='history'&&!row.current||status==='unavailable'&&row.current&&!row.available));
}
