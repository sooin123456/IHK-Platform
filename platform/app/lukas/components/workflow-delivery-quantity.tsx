import type { WorkflowBlankDocument, WorkflowDeliveryPackage } from '../lib/workflow-blank-document';
import {WorkflowMeasurementEvidence} from './workflow-measurement-evidence';
import { deliveryQuantityReview } from '../lib/workflow-document-delivery';

export function WorkflowDeliveryQuantity({document, delivery}: {document:WorkflowBlankDocument; delivery:WorkflowDeliveryPackage}) {
  if (delivery.quantityReviewSequence === undefined) return <p>수량·금액 승인 결과 미포함 · 도면만 전달하는 구성입니다.</p>;
  const round = deliveryQuantityReview(document, delivery.revision, delivery.quantityReviewSequence);
  if (!round) return <p role="alert">납품 검산 근거가 일치하지 않습니다. 구성을 다시 확인하세요.</p>;
  const amount = (q:typeof round.items[number]['quantity']) => Math.round((q.raw+q.correction)*q.rate);
  return <section className="flow-card" aria-label="납품 수량 검산 결과">
    <h3>수량 검산 #{round.sequence} · R{round.revision} 금액 승인 (체험)</h3>
    <p>고정 금액 {round.items.reduce((sum,item)=>sum+amount(item.quantity),0).toLocaleString('ko-KR')}원 · {round.items.length}개 산출 항목</p>
    <p>수량 미등록 객체 {round.excludedCount}개 제외. 전체 공사비나 실제 납품 파일이 아닙니다.</p>
    <p>검산 의견: {round.reviewNote || '기록 없음'} · 승인 의견: {round.approvalNote || '기록 없음'}</p>
    <details><summary>승인 당시 수량·단가 근거</summary><ul>{round.items.map(item=><li key={item.id}>
      <strong>{item.page}쪽 · {item.label}</strong>
      <p>원수량 {item.quantity.raw} + 보정 {item.quantity.correction} = {item.quantity.raw+item.quantity.correction}{item.quantity.unit} · 단가 {item.quantity.rate.toLocaleString('ko-KR')}원 · 금액 {amount(item.quantity).toLocaleString('ko-KR')}원</p>
      <p>산출 사유: {item.quantity.reason}</p>
      <WorkflowMeasurementEvidence evidence={item.quantity.measurementSource}/>
      <p>단가 출처: {item.quantity.rateSource
        ? `${item.quantity.rateSource.name} · ${item.quantity.rateSource.code} · v${item.quantity.rateSource.version} · ${item.quantity.rateSource.source}`
        : item.quantity.rateReference
          ? `${item.quantity.rateReference.catalogVersion} · ${item.quantity.rateReference.code} (예시 단가)`
          : '수동 입력 단가 · 외부 단가표 연결 없음'}</p>
    </li>)}</ul></details>
  </section>;
}
