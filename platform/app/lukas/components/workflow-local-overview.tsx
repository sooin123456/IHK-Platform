import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {documentReviewPhase} from '../lib/workflow-document-review';
import {localDocumentFindings,type LocalDocumentFinding} from '../lib/workflow-document-findings';
import {quantityReviewMatches} from '../lib/workflow-quantity-review';
import {fieldNoteMatches} from '../lib/workflow-document-field';
type Destination='workspace'|'quantities'|'field'|'materials'|'delivery';
const labels={draft:'작성 중',requested:'검토 대기',changes:'보완 요청',reviewed:'승인 대기',approved:'승인됨'};
export function WorkflowLocalOverview({documents,onOpen,onStart,onLocate}:{documents:WorkflowBlankDocument[];onOpen:(id:string,page:Destination)=>void;onStart:()=>void;onLocate:(id:string,finding:LocalDocumentFinding)=>void}){
 const fieldCount=documents.reduce((sum,doc)=>sum+(doc.fieldNotes?.length??0),0);
 const materialCount=documents.reduce((sum,doc)=>sum+(doc.materialEvents?.length??0),0);
 const waiting=documents.filter(doc=>['requested','changes','reviewed'].includes(documentReviewPhase(doc))).length;
 return <section aria-label="내 도면 진행 개요"><h2>내 도면 진행 개요</h2><p>이 탭에 보관된 도면을 기준으로 집계합니다. 서버 프로젝트 전체 현황이나 실제 공정률이 아닙니다.</p>
 <div className="flow-grid-three"><div className="flow-card">도면 {documents.length}건<br/>도면 검토·보완·승인 대기 {waiting}건</div><div className="flow-card">현장 기록 {fieldCount}건</div><div className="flow-card">자재 기록 {materialCount}건<br/>취소·반품 포함 처리 건수이며 수량 합계가 아닙니다.</div></div>
 {!documents.length&&<div className="flow-card"><h3>아직 만든 도면이 없습니다</h3><p>빈 작업이나 PDF로 시작하면 진행 상태가 여기에 표시됩니다.</p><button onClick={onStart}>새 도면 시작</button></div>}
 <div className="flow-grid-two">{documents.map(doc=>{
  const review=doc.quantityReviews?.at(-1),findings=localDocumentFindings(doc);
  const quantity=review&&quantityReviewMatches(doc,review)?labels[review.phase]:doc.shapes.some(shape=>shape.quantity)?'현재 기준 검산 필요':'수량 미등록';
  const staleField=doc.fieldNotes?.filter(note=>!fieldNoteMatches(doc,note)).length??0;
  return <article key={doc.id} className="flow-card"><h3>{doc.title}</h3><p>{doc.source?.name??'원본 미연결'} · R{doc.revision??1} · 객체 {doc.shapes.length}개</p>
   <dl><dt>도면 검토</dt><dd>{labels[documentReviewPhase(doc)]}</dd><dt>수량·금액 검토</dt><dd>{quantity}</dd><dt>현장 기록</dt><dd>{doc.fieldNotes?.length??0}건 · 위치 재확인 {staleField}건</dd><dt>자재 처리</dt><dd>{doc.materialEvents?.length??0}건</dd><dt>납품 체험</dt><dd>{doc.delivery?doc.delivery.status==='received'?'수신 확인':doc.delivery.status==='correction'?'보완 요청':'구성 준비됨':'미준비'}</dd></dl>
   {findings.length>0&&<p>확인 항목 {findings.length}건 · {findings[0].title}<br/>적산하지 않는 객체의 수량 미등록은 오류가 아닙니다.</p>}
   {findings.length>0&&<details><summary>확인할 일 펼치기</summary><ul>{[...findings].sort((a,b)=>Number(a.kind==='quantity-missing')-Number(b.kind==='quantity-missing')).map(finding=><li key={`${finding.kind}:${finding.objectId??''}`}><button aria-label={`${doc.title} · ${finding.title}`} onClick={()=>onLocate(doc.id,finding)}>{finding.title}</button><p>{finding.detail}</p></li>)}</ul></details>}
   {staleField>0&&<button onClick={()=>onOpen(doc.id,'field')}>현장 위치 재확인 {staleField}건 보기</button>}
   <div className="flow-actions">{([['workspace','도면 열기'],['quantities','수량 보기'],['field','현장 보기'],['materials','자재 보기'],['delivery','납품 보기']] as const).map(([page,label])=><button key={page} aria-label={`${doc.title} ${label}`} onClick={()=>onOpen(doc.id,page)}>{label}</button>)}</div>
  </article>;
 })}</div></section>;
}
