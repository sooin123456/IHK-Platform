import { useState } from "react";
import {
  phaseLabels,
  type Workflow,
  type WorkflowAction,
} from "../lib/workflow-prototype";

export function WorkflowEvidenceSummary({
  state,
  approved = false,
}: {
  state: Workflow;
  approved?: boolean;
}) {
  const snapshot = approved ? state.approved : null;
  if (approved && !snapshot) return <p>아직 고정된 승인 기준이 없습니다.</p>;
  const revision = snapshot?.revision ?? state.revision;
  const amount = snapshot?.amount ?? state.object.quantity * state.object.rate;
  return (
    <section
      className="flow-evidence-summary"
      aria-label={approved ? "승인된 납품 기준" : "승인 대상 근거"}
    >
      <header>
        <strong>
          {approved ? "고정된 승인본" : "확인할 작업 개정"} · R{revision}
        </strong>
        <span className="flow-badge">시나리오 예시</span>
      </header>
      <dl>
        <dt>도면</dt>
        <dd>
          {approved
            ? (snapshot?.document ?? "이전 승인본 · 도면명 기록 없음")
            : state.document}
        </dd>
        <dt>객체</dt>
        <dd>
          {approved
            ? (snapshot?.objectId ?? "이전 승인본 · 객체 ID 기록 없음")
            : state.object.id}{" "}
          ·{" "}
          {approved
            ? (snapshot?.objectName ?? "명칭 기록 없음")
            : state.object.name}
        </dd>
        <dt>원본 근거</dt>
        <dd>
          {approved
            ? (snapshot?.sourceId ?? "원본 ID 기록 없음")
            : state.object.sourceId}
        </dd>
        <dt>수량</dt>
        <dd>
          {snapshot?.quantity ?? state.object.quantity}{" "}
          {snapshot?.unit ?? state.object.unit}
        </dd>
        <dt>금액</dt>
        <dd>{amount.toLocaleString("ko-KR")}원 · 예시</dd>
      </dl>
      {approved && revision !== state.revision && (
        <p>
          현재 작업본은 R{state.revision}입니다. 위 값은 이전 승인본 R{revision}
          이며 현재 편집 내용과 분리되어 있습니다.
        </p>
      )}
    </section>
  );
}

export function WorkflowApprovalPanel({
  state,
  run,
}: {
  state: Workflow;
  run: (action: WorkflowAction) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const ready = state.role === "approver" && state.phase === "reviewed";
  return (
    <>
      <p>현재 상태: {phaseLabels[state.phase]}</p>
      <WorkflowEvidenceSummary state={state} />
      <label className="flow-assistant-check">
        <input
          type="checkbox"
          disabled={!ready}
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />{" "}
        도면 개정·수량·금액의 근거를 확인했습니다
      </label>
      <button
        disabled={!ready || !confirmed}
        onClick={() => run({ type: "approve" })}
      >
        승인 체험
      </button>
      <button
        disabled={state.role !== "author" || state.phase !== "approved"}
        onClick={() => run({ type: "new-revision" })}
      >
        승인본 유지하고 새 개정
      </button>
      {state.approved && <WorkflowEvidenceSummary state={state} approved />}
      <p>
        통합 검토 시나리오입니다. 실제 도면 승인·수량 검산·계약 금액 승인이나
        대외 효력은 발생하지 않습니다.
      </p>
    </>
  );
}
