import { useState } from "react";
import type { Workflow, WorkflowAction } from "../lib/workflow-prototype";
import {getWorkflowLayers} from '../lib/workflow-prototype';

export function WorkflowPropertiesPanel({
  state,
  run,
}: {
  state: Workflow;
  run: (action: WorkflowAction) => void;
}) {
  const object = state.object;
  const [name, setName] = useState(object.name);
  const [layer, setLayer] = useState(object.appearance?.layer ?? "물량 근거");
  const [stroke, setStroke] = useState(object.appearance?.stroke ?? "#7563dc");
  const [fill, setFill] = useState(object.appearance?.fill ?? "#ece8ff");
  const [width, setWidth] = useState(String(object.appearance?.lineWidth ?? 2));
  const locked =
    state.role !== "author" || !["draft", "changes"].includes(state.phase)||Boolean(getWorkflowLayers(state).find(layer=>layer.name===(object.appearance?.layer??'물량 근거'))?.locked);
  const invalid =
    !name.trim() ||
    !Number.isFinite(Number(width)) ||
    Number(width) < 0.1 ||
    Number(width) > 20;
  return (
    <section aria-label="객체 표시 속성">
      <dl>
        <dt>객체 ID</dt>
        <dd>{object.id}</dd>
        <dt>원본 근거</dt>
        <dd>
          {object.sourceId} · {object.location}
        </dd>
      </dl>
      <label className="flow-input">
        객체 이름
        <input
          aria-label="객체 이름"
          value={name}
          maxLength={120}
          disabled={locked}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="flow-input">
        표시 레이어
        <select
          aria-label="표시 레이어"
          value={layer}
          disabled={locked}
          onChange={(e) => setLayer(e.target.value)}
        >
          {getWorkflowLayers(state).filter(item=>item.kind==='overlay').map((item) => (
            <option key={item.name} disabled={item.locked}>{item.name}</option>
          ))}
        </select>
      </label>
      <div className="flow-property-colors">
        <label>
          선 색
          <input
            aria-label="선 색"
            type="color"
            value={stroke}
            disabled={locked}
            onChange={(e) => setStroke(e.target.value)}
          />
        </label>
        <label>
          채움 색
          <input
            aria-label="채움 색"
            type="color"
            value={fill}
            disabled={locked}
            onChange={(e) => setFill(e.target.value)}
          />
        </label>
      </div>
      <label className="flow-input">
        선 굵기 (화면 px)
        <input
          aria-label="선 굵기"
          type="number"
          min="0.1"
          max="20"
          step="0.1"
          value={width}
          disabled={locked}
          aria-invalid={invalid}
          onChange={(e) => setWidth(e.target.value)}
        />
      </label>
      <svg viewBox="0 0 300 70" role="img" aria-label="스타일 미리보기">
        <rect
          x="10"
          y="10"
          width="280"
          height="50"
          rx="4"
          fill={fill}
          stroke={stroke}
          strokeWidth={invalid ? 2 : Number(width)}
        />
        <text x="150" y="40" textAnchor="middle" fill="#202c3a" fontSize="12">
          {name.slice(0, 20)}
        </text>
      </svg>
      {invalid && (
        <p role="alert">이름을 입력하고 선 굵기를 0.1~20 사이로 설정하세요.</p>
      )}
      {locked && (
        <p role="status">
          작성 중인 개정의 작성자만 속성을 변경할 수 있습니다. 승인본은 새
          개정으로 수정하세요.
        </p>
      )}
      <p>
        색·선 굵기는 2D 예시 오버레이에 적용합니다. 원본 파일과 물량 값은
        변경하지 않으며 새 개정의 근거를 다시 확인해야 합니다.
      </p>
      <button
        disabled={locked || invalid}
        onClick={() =>
          run({
            type: "properties",
            name,
            layer,
            stroke,
            fill,
            lineWidth: Number(width),
          })
        }
      >
        객체 속성 적용
      </button>
    </section>
  );
}
