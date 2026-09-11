import type {WorkflowBlankDocument} from './workflow-blank-document';
import {documentQuantityRow} from './workflow-document-quantity';
import {quantityReviewMatches} from './workflow-quantity-review';
export type LocalDocumentFinding = {kind:'source'|'quantity-missing'|'quantity-stale'|'quantity-review'; objectId?:string;page?:number;title:string;detail:string};
export function localDocumentFindings(document:WorkflowBlankDocument):LocalDocumentFinding[] {
 if(!document.source)return [{kind:'source',title:'원본 PDF 연결 필요',detail:'구상 객체는 유지됩니다. 수량 근거를 남기려면 원본을 연결하세요.'}];
 const findings:LocalDocumentFinding[]=document.shapes.flatMap(shape=>{
  const row=documentQuantityRow(document,shape);
  const kind=!shape.quantity?'quantity-missing':row?.stale?'quantity-stale':null;
  return kind?[{kind,objectId:shape.id,page:shape.page??1,title:`${shape.label||'이름 없는 객체'} · ${kind==='quantity-missing'?'수량 미등록':'수량 근거 재확인'}`,detail:kind==='quantity-missing'?'적산 대상인 경우 수량과 입력 근거를 연결하세요. 모든 객체가 적산 대상인 것은 아닙니다.':'객체나 원본 근거가 입력 당시와 다릅니다. 현재 위치와 산출 근거를 확인하세요.'} as LocalDocumentFinding]:[];
 });
 const registered=document.shapes.some(shape=>shape.quantity);
 if(registered&&!findings.some(item=>item.kind==='quantity-stale')) {
  const latest=document.quantityReviews?.at(-1);
  if(!latest||!quantityReviewMatches(document,latest)||latest.phase!=='approved') findings.push({kind:'quantity-review',title:latest&&quantityReviewMatches(document,latest)?({requested:'수량 검산 대기',reviewed:'금액 승인 대기',changes:'수량 보완 요청',approved:'새 검산 필요'}[latest.phase]):'수량 검산 요청 필요',detail:'도면 승인과 별개입니다. 등록한 수량 범위와 단가를 검산 화면에서 확인하세요.'});
 }
 return findings;
}
