import { useState } from "react";
import type { Workflow, WorkflowAction } from "../lib/workflow-prototype";

export function WorkflowRatePanel({
  state,
  run,
}: {
  state: Workflow;
  run: (action: WorkflowAction) => void;
}) {
  const [value, setValue] = useState(String(state.object.rate));
  const [query, setQuery] = useState("");
  const rate = Number(value);
  const invalid = !value.trim() || !Number.isFinite(rate) || rate < 0;
  const locked =
    state.role !== "author" || !["draft", "changes"].includes(state.phase);
  const base =
    state.scenario === "civil"
      ? 85000
      : state.scenario === "ifc"
        ? 65000
        : 42000;
  const candidates = [
    { name: "표준 시공 예시", rate: base },
    { name: "대안 시공 예시", rate: base + 5000 },
  ].filter((item) => item.name.includes(query.trim()));
  return (
    <section aria-label="예시 단가 연결">
      <p>
        {state.object.id} · {state.object.name} · {state.object.unit}
      </p>
      <p>DEMO-2026-01 · 아래 금액은 시나리오 자료이며 시장 단가가 아닙니다.</p>
      <label className="flow-input">
        단가 항목 검색
        <input
          aria-label="단가 항목 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="flow-actions">
        {candidates.map((item) => (
          <button
            disabled={locked}
            key={item.name}
            onClick={() => setValue(String(item.rate))}
          >
            {item.name} · {item.rate.toLocaleString("ko-KR")}원/
            {state.object.unit}
          </button>
        ))}
      </div>
      {!candidates.length && (
        <p role="status">
          검색 결과가 없습니다. 검색어를 지우거나 예시 단가를 직접 입력하세요.
        </p>
      )}
      <label className="flow-input">
        적용 단가 (원/{state.object.unit})
        <input
          aria-label="적용 단가"
          type="number"
          min="0"
          step="1"
          disabled={locked}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={invalid}
        />
      </label>
      {invalid && <p role="alert">0 이상의 유한한 금액을 입력하세요.</p>}
      <dl>
        <dt>현재 단가</dt>
        <dd>
          {state.object.rate.toLocaleString("ko-KR")}원/{state.object.unit}
        </dd>
        <dt>변경 후 금액 미리보기</dt>
        <dd>
          {invalid
            ? "입력 확인 필요"
            : `${(state.object.quantity * rate).toLocaleString("ko-KR")}원`}
        </dd>
      </dl>
      <p>
        단가 변경은 새 개정으로 기록하며 산출 근거를 다시 확인해야 합니다.
        승인본은 덮어쓰지 않습니다.
      </p>
      {locked && (
        <p role="status">작성 중인 개정의 작성자만 변경할 수 있습니다.</p>
      )}
      <button
        disabled={locked || invalid || rate === state.object.rate}
        onClick={() => run({ type: "rate", rate, unit: state.object.unit })}
      >
        예시 단가 적용
      </button>
    </section>
  );
}
