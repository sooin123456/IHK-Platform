import { useState } from "react";
import {
  getWorkflowLayers,
  type Workflow,
  type WorkflowAction,
} from "../lib/workflow-prototype";

export function WorkflowLayerControls({
  state,
  dispatch,
}: {
  state: Workflow;
  dispatch: (action: WorkflowAction) => void;
}) {
  const [name, setName] = useState("");
  const layers = getWorkflowLayers(state);
  const locked =
    state.role !== "author" || !["draft", "changes"].includes(state.phase);
  const invalid =
    !name.trim() ||
    layers.some((layer) => layer.name === name.trim()) ||
    layers.length >= 30;
  return (
    <details className="flow-layer-controls">
      <summary>레이어 관리 · {layers.length}</summary>
      <p>
        표시·잠금은 현재 탭의 예시 설정입니다. 원본 배경은 항상 편집 잠금입니다.
      </p>
      {layers.map((layer) => (
        <div className="flow-layer-row" key={layer.name}>
          <strong>{layer.name}</strong>
          <small>
            {layer.kind === "source"
              ? "원본"
              : layer.name === (state.object.appearance?.layer ?? "물량 근거")
                ? "객체 1개"
                : "빈 레이어"}
          </small>
          <label>
            <input
              type="checkbox"
              aria-label={`${layer.name} 표시`}
              checked={layer.visible}
              disabled={locked}
              onChange={() =>
                dispatch({
                  type: "layer-toggle",
                  name: layer.name,
                  property: "visible",
                })
              }
            />
            표시
          </label>
          <label>
            <input
              type="checkbox"
              aria-label={`${layer.name} 잠금`}
              checked={layer.locked}
              disabled={locked || layer.kind === "source"}
              onChange={() =>
                dispatch({
                  type: "layer-toggle",
                  name: layer.name,
                  property: "locked",
                })
              }
            />
            잠금
          </label>
        </div>
      ))}
      <label>
        새 레이어
        <input
          aria-label="새 레이어 이름"
          maxLength={80}
          value={name}
          disabled={locked}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button
        disabled={locked || invalid}
        onClick={() => dispatch({ type: "layer-create", name })}
      >
        레이어 추가
      </button>
      <p>
        객체는 속성의 ‘표시 레이어’에서 이동합니다. 잠긴 레이어의 객체는 먼저
        잠금을 해제하세요.
      </p>
    </details>
  );
}
