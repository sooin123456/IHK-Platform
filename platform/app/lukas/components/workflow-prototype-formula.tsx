import { useState } from "react";
import type { Workflow, WorkflowAction } from "../lib/workflow-prototype";

export function WorkflowFormulaPanel({
  state,
  run,
  open,
}: {
  state: Workflow;
  run: (action: WorkflowAction) => void;
  open: (panel: string) => void;
}) {
  const previous =
    state.measurement &&
    Math.round((state.measurement.raw + state.measurement.correction) * 1000) /
      1000 ===
      state.object.quantity
      ? state.measurement
      : undefined;
  const [raw, setRaw] = useState(
    String(previous?.raw ?? state.object.quantity),
  );
  const [correction, setCorrection] = useState(
    String(previous?.correction ?? 0),
  );
  const [reason, setReason] = useState(previous?.reason ?? "");
  const total = Math.round((Number(raw) + Number(correction)) * 1000) / 1000;
  const reasonRequired =
    Number(correction) !== 0 || Number(raw) !== state.object.quantity;
  const invalid =
    !raw.trim() ||
    !correction.trim() ||
    !Number.isFinite(Number(raw)) ||
    !Number.isFinite(Number(correction)) ||
    Number(raw) < 0 ||
    !Number.isFinite(total) ||
    total < 0 ||
    total > 1e9 ||
    (reasonRequired && !reason.trim());
  const locked =
    state.role !== "author" || !["draft", "changes"].includes(state.phase);
  return (
    <section className="flow-formula-panel" aria-label="산출 근거 편집">
      <p>
        {state.object.id} · {state.object.sourceId} · R{state.revision}
      </p>
      <p>
        DEMO-QTY-01 · 원수량 + 보정수량 · 소수점 셋째 자리까지 표시(넷째
        자리에서 반올림). 입력값은 화면 체험용이며 실제 도면 측정·확정 계산이
        아닙니다.
      </p>
      {state.measurement && !previous && (
        <p role="status">
          이전 R{state.measurement.revision}에 보정{" "}
          {state.measurement.correction} {state.object.unit} (
          {state.measurement.reason || "보정 없음"}) 기록이 있습니다. 변경된
          수량에는 자동 적용하지 않으므로 다시 확인하세요.
        </p>
      )}
      <label className="flow-input">
        원수량 ({state.object.unit})
        <input
          aria-label="원수량"
          type="number"
          min="0"
          step="0.001"
          disabled={locked}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
      </label>
      <label className="flow-input">
        보정수량 ({state.object.unit})
        <input
          aria-label="보정수량"
          type="number"
          step="0.001"
          disabled={locked}
          value={correction}
          onChange={(e) => setCorrection(e.target.value)}
        />
      </label>
      <small>공제는 음수, 추가는 양수로 입력합니다.</small>
      <label className="flow-input">
        보정 사유{reasonRequired ? " · 필수" : ""}
        <textarea
          aria-label="보정 사유"
          maxLength={500}
          disabled={locked}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="flow-total">
        <small>최종수량 미리보기</small>
        <strong>
          {Number.isFinite(total) && total >= 0
            ? `${total.toLocaleString("ko-KR", { maximumFractionDigits: 3 })} ${state.object.unit}`
            : "입력 확인 필요"}
        </strong>
        <span>
          {Number.isFinite(total) && total >= 0
            ? `${(total * state.object.rate).toLocaleString("ko-KR")}원 · 예시 단가 적용`
            : ""}
        </span>
      </div>
      {invalid && (
        <p role="alert">
          유효한 수량과 필요한 보정 사유를 입력하세요. 최종수량은 0 이상이어야
          합니다.
        </p>
      )}
      {!state.calibrated && (
        <>
          <p>축척·기준 길이를 먼저 확인해야 합니다.</p>
          <button onClick={() => open("scale")}>축척 먼저 설정</button>
        </>
      )}
      {state.calibrated && (
        <button onClick={() => open("scale")}>축척 기준 확인</button>
      )}
      {locked && (
        <p role="status">
          작성 중인 개정의 작성자만 산출 근거를 변경할 수 있습니다.
        </p>
      )}
      <button
        disabled={locked || invalid || !state.calibrated}
        onClick={() =>
          run({
            type: "formula",
            raw: Number(raw),
            correction: Number(correction),
            reason,
          })
        }
      >
        산출 결과 확인 체험
      </button>
    </section>
  );
}
