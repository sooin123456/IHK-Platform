import type {WorkflowBlankDocument} from './workflow-blank-document';
import {documentQuantityRow,documentDemoRates} from './workflow-document-quantity';
type Item={document:WorkflowBlankDocument;shape:WorkflowBlankDocument['shapes'][number]};
type Group={key:string;label:string;basis:string;unit:string;rate:number;quantity:number;amount:number;items:Item[]};
export function groupDocumentBoq(documents:WorkflowBlankDocument[]){
 const groups=new Map<string,Group>();let missing=0,stale=0;
 for(const document of documents)for(const shape of document.shapes){
  const row=documentQuantityRow(document,shape);if(!row){missing++;continue;}if(row.stale){stale++;continue;}
  const source=row.rateSource,reference=row.rateReference;
  const identity=source?['registered',source.code,source.version,source.source,source.name]:reference?['demo',reference.catalogVersion,reference.code]:['manual',document.id,shape.id];
  const key=JSON.stringify([...identity,row.unit,row.rate]);
  let group=groups.get(key);
  if(!group){group={key,label:source?.name??documentDemoRates.find(item=>item.code===reference?.code)?.name??(shape.label||'이름 없는 객체'),basis:source?`${source.code} · v${source.version} · ${source.source}`:reference?`${reference.catalogVersion} · ${reference.code}`:'직접 입력 · 항목 코드 미연결',unit:row.unit,rate:row.rate,quantity:0,amount:0,items:[]};groups.set(key,group);}
  group.quantity+=row.final;group.amount+=row.amount;group.items.push({document,shape});
 }
 return {groups:[...groups.values()],missing,stale,total:[...groups.values()].reduce((sum,group)=>sum+group.amount,0)};
}
