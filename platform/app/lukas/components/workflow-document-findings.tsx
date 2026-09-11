import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {localDocumentFindings,type LocalDocumentFinding} from '../lib/workflow-document-findings';
export function WorkflowDocumentFindings({document,onLocate}:{document:WorkflowBlankDocument;onLocate:(finding:LocalDocumentFinding)=>void}) {
 const findings=localDocumentFindings(document);
 return <details className="flow-card"><summary>다음 확인할 항목 · {findings.length}건</summary>
  <section aria-label="내 도면 확인할 항목">
   <p>로컬 상태 규칙 v1 · AI 분석이나 실측 검증이 아닙니다. 선택적으로 확인할 수량 미등록 객체도 포함합니다.</p>
   {!findings.length?<p>현재 규칙에서 확인할 항목이 없습니다. 전체 도면의 정확성·완전성을 검증한 것은 아닙니다.</p>:<ul>{findings.map(item=><li key={`${item.kind}:${item.objectId??document.id}`}>
    <strong>{item.title}</strong><p>{item.detail}</p>
    {item.page&&<p>{item.page}쪽 · 객체 {item.objectId}</p>}
    <button onClick={()=>onLocate(item)}>{item.kind==='source'?'PDF 연결 위치로':item.kind==='quantity-review'?'검산 화면 열기':`수량 근거 확인: ${item.title}`}</button>
   </li>)}</ul>}
  </section>
 </details>;
}
