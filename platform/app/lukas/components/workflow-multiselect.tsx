import { useState } from "react";
import type {
  WorkflowBlankDocument,
  DraftSelectionAction,
} from "../lib/workflow-blank-document";
import {
  draftLayer,
  editableDraftLayer,
} from "../lib/workflow-document-layers";
export function WorkflowMultiSelection({
  document,
  ids,
  writable,
  onToggle,
  onSelect,
  onAction,
}: {
  document: WorkflowBlankDocument;
  ids: string[];
  writable: boolean;
  onToggle: (id: string) => void;
  onSelect: (ids: string[]) => void;
  onAction: (action: DraftSelectionAction) => void;
}) {
  const [dx, setDx] = useState("20"),
    [dy, setDy] = useState("20");
  const shapes = document.shapes.filter(
    (shape) => (shape.page ?? 1) === (document.page ?? 1),
  );
  const blocked =
    !writable ||
    !ids.length ||
    ids.some((id) => {
      const shape = shapes.find((shape) => shape.id === id);
      return !shape || !editableDraftLayer(document, shape);
    });
  return (
    <section aria-label="다중 객체 편집" className="flow-card">
      <h3>{ids.length}개 선택</h3>
      <p>
        Shift+클릭 또는 목록으로 선택하세요. 여러 객체는 함께 끌거나 방향키로
        이동할 수 있습니다. 복사·삭제도 한 번에 실행 취소됩니다.
      </p>
      <div className="flow-actions">
        <button
          onClick={() =>
            onSelect(
              shapes
                .filter((shape) => draftLayer(document, shape)?.visible)
                .map((shape) => shape.id),
            )
          }
        >
          보이는 객체 모두 선택
        </button>
        <button onClick={() => onSelect([])}>선택 해제</button>
      </div>
      <details>
        <summary>다중 선택 목록</summary>
        <div style={{ maxHeight: 220, overflowY: "auto" }}>
          {shapes.map((shape, index) => (
            <label
              key={shape.id}
              style={{ display: "flex", gap: 8, padding: "6px 0" }}
            >
              <input
                type="checkbox"
                aria-label={`다중 선택: ${index + 1} · ${shape.label}`}
                checked={ids.includes(shape.id)}
                onChange={() => onToggle(shape.id)}
              />
              {index + 1} · {shape.label}
              {!editableDraftLayer(document, shape) && " · 숨김/잠금"}
            </label>
          ))}
        </div>
      </details>
      {ids.length>1&&<fieldset disabled={blocked}>
        <div className="flow-actions">
          <label className="flow-input">
            상대 이동 X
            <input
              aria-label="선택 이동 X"
              type="number"
              value={dx}
              onChange={(event) => setDx(event.target.value)}
            />
          </label>
          <label className="flow-input">
            상대 이동 Y
            <input
              aria-label="선택 이동 Y"
              type="number"
              value={dy}
              onChange={(event) => setDy(event.target.value)}
            />
          </label>
          <button
            disabled={
              !dx.trim() ||
              !dy.trim() ||
              !Number.isFinite(Number(dx)) ||
              !Number.isFinite(Number(dy))
            }
            onClick={() =>
              onAction({ type: "move", dx: Number(dx), dy: Number(dy) })
            }
          >
            선택 함께 이동
          </button>
          <button
            disabled={document.shapes.length + ids.length > 500}
            onClick={() =>
              onAction({
                type: "copy",
                newIds: ids.map(() => crypto.randomUUID()),
              })
            }
          >
            선택 함께 복사
          </button>
          <button onClick={() => onAction({ type: "delete" })}>
            선택 함께 삭제
          </button>
        </div>
      </fieldset>}
      {ids.length > 0 && blocked && (
        <p>
          숨김·잠금 또는 읽기 전용 객체가 포함되어 전체 편집을 차단했습니다.
        </p>
      )}
      {ids.length > 1 && (
        <p>개별 속성·수량·검토 요청은 객체 하나를 선택한 뒤 사용하세요.</p>
      )}
    </section>
  );
}
