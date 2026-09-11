import { useState } from "react";
import type { Workflow, WorkflowAction } from "../lib/workflow-prototype";

export function WorkflowScalePanel({
  state,
  run,
}: {
  state: Workflow;
  run: (action: WorkflowAction) => void;
}) {
  const [length, setLength] = useState(String(state.scale?.length ?? 6000));
  const [unit, setUnit] = useState<"mm" | "m">(state.scale?.unit ?? "mm");
  const value = Number(length);
  const invalid =
    !length.trim() || !Number.isFinite(value) || value <= 0 || value > 1e9;
  const locked =
    state.role !== "author" || !["draft", "changes"].includes(state.phase);
  return (
    <section aria-label="축척 기준 설정">
      <p>
        {state.object.sourceId} / {state.object.id} · {state.object.location}
      </p>
      <svg
        viewBox="0 0 400 100"
        role="img"
        aria-label="축척 기준 구간 예시 · 실제 측정 아님"
        style={{
          width: "100%",
          maxHeight: 120,
          background: "#f7f8fc",
          borderRadius: 12,
        }}
      >
        <path
          d="M50 50H350M50 35V65M350 35V65"
          stroke="#6557d8"
          strokeWidth="2"
        />
        <circle cx="50" cy="50" r="5" fill="#6557d8" />
        <circle cx="350" cy="50" r="5" fill="#6557d8" />
        <text x="200" y="30" textAnchor="middle" fontSize="13">
          기준점 A → B · 예시 구간
        </text>
        <text x="200" y="82" textAnchor="middle" fontSize="12">
          {invalid
            ? "기준 길이를 입력하세요"
            : `${value.toLocaleString("ko-KR")} ${unit}`}
        </text>
      </svg>
      <label className="flow-input">
        실제 기준 길이
        <input
          aria-label="축척 기준 길이"
          type="number"
          min="0.001"
          step="any"
          max="1000000000"
          value={length}
          disabled={locked}
          onChange={(e) => setLength(e.target.value)}
          aria-invalid={invalid}
        />
      </label>
      <label className="flow-input">
        길이 단위
        <select
          aria-label="축척 길이 단위"
          value={unit}
          disabled={locked}
          onChange={(e) => setUnit(e.target.value as "mm" | "m")}
        >
          <option value="mm">밀리미터 (mm)</option>
          <option value="m">미터 (m)</option>
        </select>
      </label>
      {!invalid && (
        <p>
          미터 환산:{" "}
          {(unit === "mm" ? value / 1000 : value).toLocaleString("ko-KR", {
            maximumFractionDigits: 6,
          })}{" "}
          m
        </p>
      )}
      {invalid && (
        <p role="alert">0보다 크고 10억 이하인 기준 길이를 입력하세요.</p>
      )}
      <p>
        보관된 기준:{" "}
        {state.scale
          ? `${state.scale.length} ${state.scale.unit}`
          : state.calibrated
            ? "시나리오 기본 단위 · 사용자 설정 없음"
            : "아직 설정하지 않음"}
      </p>
      <p className="flow-note">
        실제 도면에서 두 점을 측정하지 않습니다. 입력은 화면 흐름 확인용이며
        기존 수량을 자동 환산하지 않습니다. 변경 후 산출 근거를 다시 확인해야
        합니다.
      </p>
      {locked && (
        <p role="status">작성 중인 개정의 작성자만 설정할 수 있습니다.</p>
      )}
      <button
        disabled={locked || invalid}
        onClick={() => run({ type: "calibrate", length: value, unit })}
      >
        축척 설정 체험
      </button>
    </section>
  );
}
