import { useState } from "react";
import type { Workflow, WorkflowAction } from "../lib/workflow-prototype";

export function WorkflowAssistantPanel({
  state,
  run,
  open,
  reason,
  setReason,
  unavailable,
}: {
  state: Workflow;
  run: (action: WorkflowAction) => void;
  open: (panel: string) => void;
  reason: string;
  setReason: (value: string) => void;
  unavailable: boolean;
}) {
  const [evidenceChecked, setEvidenceChecked] = useState(false);
  const decision = state.aiDecision;
  const current = decision?.revision === state.revision;
  const quantity = state.object.quantity - state.object.baseline;
  const disabled =
    unavailable ||
    state.role === "viewer" ||
    !reason.trim() ||
    !evidenceChecked;
  return (
    <section
      className="flow-ai flow-assistant"
      aria-label="근거 기반 AI 제안 예시"
    >
      <header>
        <b>변경 근거 검토 제안</b>
        <span className="flow-badge">AI 응답 시나리오 · 실제 분석 아님</span>
      </header>
      <p>
        {state.object.name}의{" "}
        {quantity === 0 ? "기준 수량과 공제 범위" : "변경 수량과 연결 내역"}를
        검토 의견에 포함하는 것을 제안합니다.
      </p>
      <dl>
        <dt>대상</dt>
        <dd>
          {state.object.id} · {state.object.location}
        </dd>
        <dt>근거 개정</dt>
        <dd>
          {state.object.sourceId} · R{state.revision}
        </dd>
        <dt>수량 차이 예시</dt>
        <dd>
          {quantity > 0 ? "+" : ""}
          {quantity} {state.object.unit}
        </dd>
        <dt>확인하지 못한 내용</dt>
        <dd>실제 도면 판독, 누락 객체, 시방서 일치, 현장 적합성</dd>
      </dl>
      <p>
        제안 채택은 검토 의견 기록만 남깁니다. 수량·금액·승인 상태는 변경하지
        않습니다.
      </p>
      {unavailable && (
        <p role="alert">
          자료 부족 또는 원본 연결 문제를 먼저 확인해야 합니다. 현재는 제안
          판단을 기록할 수 없습니다.
        </p>
      )}
      <button onClick={() => open("compare")}>원본·변경 근거 비교</button>
      {decision && (
        <div className="flow-assistant-decision" role="status">
          <strong>
            {current
              ? decision.decision === "accepted"
                ? "검토 의견으로 채택됨"
                : "기각됨"
              : `이전 R${decision.revision}의 판단 · 현재 개정 재확인 필요`}
          </strong>
          <p>{decision.reason}</p>
        </div>
      )}
      <label className="flow-input">
        판단 이유
        <textarea
          aria-label="AI 제안 판단 이유"
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={state.role === "viewer"}
        />
      </label>
      <label className="flow-assistant-check">
        <input
          type="checkbox"
          checked={evidenceChecked}
          onChange={(e) => setEvidenceChecked(e.target.checked)}
          disabled={state.role === "viewer"}
        />{" "}
        R{state.revision}의 근거와 미검사 범위를 확인했습니다
      </label>
      <div className="flow-actions">
        <button
          disabled={disabled}
          onClick={() =>
            run({
              type: "ai-decision",
              revision: state.revision,
              decision: "accepted",
              reason,
            })
          }
        >
          검토 의견으로 채택
        </button>
        <button
          disabled={disabled}
          onClick={() =>
            run({
              type: "ai-decision",
              revision: state.revision,
              decision: "dismissed",
              reason,
            })
          }
        >
          이유를 남기고 기각
        </button>
      </div>
      <small>
        이 예시는 신뢰도 수치나 자동 안전 판단을 제공하지 않습니다. 최종 검토는
        담당자가 수행합니다.
      </small>
    </section>
  );
}
