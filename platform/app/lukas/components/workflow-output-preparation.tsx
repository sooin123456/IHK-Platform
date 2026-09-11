import {useState} from 'react';
import type {WorkflowBlankDocument,WorkflowDeliveryPackage} from '../lib/workflow-blank-document';
import {deliveryQuantityReview} from '../lib/workflow-document-delivery';
import {updateOutputJob} from '../lib/workflow-output-job';

export function WorkflowOutputPreparation({document,delivery,onChange,readOnly=false}:{document:WorkflowBlankDocument;delivery:WorkflowDeliveryPackage;onChange:(document:WorkflowBlankDocument)=>void;readOnly?:boolean}) {
 const phase=delivery.output?.phase??'idle';
 const update=(action:'start'|'failed'|'ready'|'cancelled')=>onChange(updateOutputJob(document,delivery.sequence??0,action));
 const [outcome,setOutcome]=useState<'failed'|'ready'>('failed');
 const drawing=document.reviewRounds?.find(round=>round.revision===delivery.revision&&round.phase==='approved');
 const quantity=delivery.quantityReviewSequence===undefined?undefined:deliveryQuantityReview(document,delivery.revision,delivery.quantityReviewSequence);
 const invalid=!drawing||(delivery.quantityReviewSequence!==undefined&&!quantity)||(delivery.output&&delivery.output.sourceHash!==drawing?.source.sha256);
 return <section className="flow-card" aria-label="승인본 출력 준비">
  <h4>출력 준비 · 구성 #{delivery.sequence??0}</h4>
  <p>보관된 승인 R{delivery.revision} → {delivery.recipient}. 위에서 선택 중인 설정이 아니라 보관 구성을 기준으로 합니다.</p>
  {invalid?<p role="alert">승인 근거를 확인할 수 없어 출력 준비를 중단했습니다. 현재 작업본으로 대체하지 않습니다.</p>:<>
   <ul>
    <li>승인 도면 PDF · {drawing.source.name} · {drawing.source.pages}쪽 원본 참조 · {drawing.objects.length}개 구상 객체</li>
    <li>검토 기록 보고서 · 승인 R{drawing.revision}의 요청·검토·승인 의견</li>
    {quantity?<li>수량·내역 표 · 검산 #{quantity.sequence} · {quantity.items.length}개 항목 · 승인 당시 값</li>:<li>수량·내역 표 미포함 · 납품 구성에서 일치하는 승인 검산을 선택하세요.</li>}
   </ul>
   <details><summary>원본 식별 근거</summary><p style={{overflowWrap:'anywhere'}}>SHA-256: {drawing.source.sha256}</p></details>
   <p>PDF·보고서·Excel 파일을 실제 생성하거나 내려받지 않습니다. DWG 재저장은 지원 확인 전이며, 원본을 다른 확장자로 바꾸어 제공하지 않습니다. 처리 상태는 납품 구성별로 이 탭에 보관됩니다. 새로고침 뒤 자동 처리되지는 않습니다.</p>
   <p>출력 시도 {delivery.output?.attempt??0}회 · 상태: {{idle:'미시작',processing:'준비 중',failed:'실패',cancelled:'취소',ready:'준비 완료 예시'}[phase]}</p>
   {(delivery.output?.attempt??0)>=100&&<p>이 구성의 출력 시도 100회 한도입니다. 기존 기록은 유지됩니다.</p>}
   {readOnly?<p>이전 납품 구성의 출력 기록 · 읽기 전용</p>:<>
   {(phase==='idle'||phase==='cancelled')&&<button disabled={(delivery.output?.attempt??0)>=100} onClick={()=>update('start')}>출력 준비 체험</button>}
   {phase==='processing'&&<>
    <p role="status">출력 준비 중 · 화면 체험</p>
    <label className="flow-input">출력 결과 체험<select aria-label="출력 결과 체험" value={outcome} onChange={event=>setOutcome(event.target.value as typeof outcome)}><option value="failed">생성 실패 예시</option><option value="ready">준비 완료 예시</option></select></label>
    <button onClick={()=>update(outcome)}>결과 확인</button>
    <button onClick={()=>update('cancelled')}>출력 준비 취소</button>
   </>}
   {phase==='failed'&&<>
    <p role="alert">출력 생성 실패 예시 · 생성된 파일이나 전송된 결과는 없습니다. 기존 승인본과 수신 기록은 유지됩니다.</p>
    <p>실제 연결 시에는 원본 접근 가능 여부와 출력 서비스 상태를 확인한 뒤 같은 보관 구성으로 재시도합니다.</p>
    <button disabled={(delivery.output?.attempt??0)>=100} onClick={()=>update('start')}>출력 다시 준비</button>
   </>}
   {phase==='ready'&&<>
    <p role="status">준비 완료 예시 · 위 출력물 목록을 확인했습니다. 실제 파일 생성·전송 완료가 아닙니다.</p>
    <p>아래 ‘독립 수신 화면 열기’에서 동일한 승인본과 포함된 검산 결과를 확인할 수 있습니다.</p>
    <button disabled={(delivery.output?.attempt??0)>=100} onClick={()=>update('start')}>다시 출력 준비</button>
   </>}
   </>}
  </>}
 </section>;
}
