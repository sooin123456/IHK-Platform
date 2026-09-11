import { useState } from "react";
import type { WorkflowBlankDocument } from "../lib/workflow-blank-document";
import {
  documentLayers,
  documentLayersSchema,
  editableDraftLayer,
  type DocumentLayer,
} from "../lib/workflow-document-layers";
export function WorkflowDocumentLayers({
  document,
  writable,
  active,
  onActive,
  onLayers,
  selected,
  onAssign,
  showHidden,
  onShowHidden,
}: {
  document: WorkflowBlankDocument;
  writable: boolean;
  active: string;
  onActive: (id: string) => void;
  onLayers: (layers: DocumentLayer[]) => void;
  selected?: WorkflowBlankDocument["shapes"][number];
  onAssign: (id: string) => void;
  showHidden: boolean;
  onShowHidden: (show: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );
  const layers = documentLayers(document);
  const validRename = Boolean(
    renaming &&
      renaming.name.trim() &&
      layers.some((layer) => layer.id === renaming.id) &&
      !layers.some(
        (layer) =>
          layer.id !== renaming.id && layer.name === renaming.name.trim(),
      ),
  );
  const valid =
    name.trim() &&
    name.trim().length <= 80 &&
    !layers.some((layer) => layer.name === name.trim()) &&
    layers.length < 30;
  return (
    <section
      aria-label="도면 레이어"
      className="flow-card flow-document-layers"
    >
      <h3>레이어 · {layers.length}</h3>
      <p>
        PDF 원본은 별도 잠긴 배경입니다. 목록 위쪽 레이어가 앞에 표시됩니다.
        객체 편집과 레이어 설정은 같은 실행 취소·다시 실행으로 되돌릴 수
        있습니다.
      </p>
      <label>
        <input
          type="checkbox"
          aria-label="숨긴 레이어 임시 표시"
          checked={showHidden}
          onChange={(event) => onShowHidden(event.target.checked)}
        />
        숨긴 레이어 임시 표시 · 저장 상태는 유지
      </label>
      {layers.map((layer, index) => (
        <div className="flow-document-layer-row" key={layer.id}>
          <strong>{layer.name}</strong> ·{" "}
          {
            document.shapes.filter(
              (shape) => (shape.layerId ?? "default") === layer.id,
            ).length
          }
          개
          <div className="flow-actions">
            <label>
              <input
                type="checkbox"
                aria-label={`${layer.name} 표시`}
                disabled={!writable}
                checked={layer.visible}
                onChange={(event) =>
                  onLayers(
                    layers.map((item) =>
                      item.id === layer.id
                        ? { ...item, visible: event.target.checked }
                        : item,
                    ),
                  )
                }
              />
              표시
            </label>
            <label>
              <input
                type="checkbox"
                aria-label={`${layer.name} 잠금`}
                disabled={!writable}
                checked={layer.locked}
                onChange={(event) =>
                  onLayers(
                    layers.map((item) =>
                      item.id === layer.id
                        ? { ...item, locked: event.target.checked }
                        : item,
                    ),
                  )
                }
              />
              잠금
            </label>
          </div>
          <div className="flow-actions">
            <button
              aria-label={`${layer.name} 이름 변경`}
              disabled={!writable}
              onClick={() => setRenaming({ id: layer.id, name: layer.name })}
            >
              이름 변경
            </button>
            {([-1, 1] as const).map((direction) => (
              <button
                key={direction}
                aria-label={`${layer.name} ${direction < 0 ? "앞으로" : "뒤로"}`}
                disabled={
                  !writable ||
                  index + direction < 0 ||
                  index + direction >= layers.length
                }
                onClick={() => {
                  const next = [...layers];
                  [next[index], next[index + direction]] = [
                    next[index + direction],
                    next[index],
                  ];
                  onLayers(next);
                }}
              >
                {direction < 0 ? "앞으로" : "뒤로"}
              </button>
            ))}
            <button
              aria-label={`${layer.name} 레이어 삭제`}
              disabled={
                !writable ||
                layer.id === "default" ||
                layer.locked ||
                document.shapes.some(
                  (shape) => (shape.layerId ?? "default") === layer.id,
                )
              }
              onClick={() =>
                onLayers(layers.filter((item) => item.id !== layer.id))
              }
            >
              빈 레이어 삭제
            </button>
          </div>
        </div>
      ))}
      {renaming && (
        <div className="flow-card">
          <label className="flow-input">
            변경할 레이어 이름
            <input
              aria-label="변경할 레이어 이름"
              maxLength={80}
              disabled={!writable}
              value={renaming.name}
              onChange={(event) =>
                setRenaming({ ...renaming, name: event.target.value })
              }
            />
          </label>
          <button
            disabled={!writable || !validRename}
            onClick={() => {
              if (!writable || !validRename) return;
              onLayers(
                layers.map((layer) =>
                  layer.id === renaming.id
                    ? { ...layer, name: renaming.name.trim() }
                    : layer,
                ),
              );
              setRenaming(null);
            }}
          >
            레이어 이름 저장
          </button>
          <button onClick={() => setRenaming(null)}>이름 변경 취소</button>
          {!validRename && <p>중복되지 않는 이름을 입력하세요.</p>}
        </div>
      )}
      <label className="flow-input">
        작성 레이어
        <select
          aria-label="작성 레이어"
          value={active}
          onChange={(event) => onActive(event.target.value)}
          disabled={!writable}
        >
          {layers.map((layer) => (
            <option
              key={layer.id}
              value={layer.id}
              disabled={!layer.visible || layer.locked}
            >
              {layer.name}
            </option>
          ))}
        </select>
      </label>
      {!editableDraftLayer(document, { layerId: active }) && (
        <p>
          작성 레이어가 숨김·잠금 상태입니다. 다른 레이어를 선택하거나 잠금을
          해제하세요.
        </p>
      )}
      {selected && (
        <label className="flow-input">
          객체 레이어
          <select
            aria-label="객체 레이어"
            value={selected.layerId ?? "default"}
            disabled={!writable || !editableDraftLayer(document, selected)}
            onChange={(event) => onAssign(event.target.value)}
          >
            {layers.map((layer) => (
              <option
                key={layer.id}
                value={layer.id}
                disabled={!layer.visible || layer.locked}
              >
                {layer.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flow-input">
        새 레이어 이름
        <input
          aria-label="새 레이어 이름"
          value={name}
          maxLength={80}
          disabled={!writable}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <button
        disabled={!writable || !valid}
        onClick={() => {
          if (!writable || !valid) return;
          const id = crypto.randomUUID();
          const next = [
            { id, name: name.trim(), visible: true, locked: false },
            ...layers,
          ];
          if (documentLayersSchema.safeParse(next).success) {
            onLayers(next);
            onActive(id);
            setName("");
          }
        }}
      >
        레이어 추가
      </button>
      {!valid && name.trim() && (
        <p>중복되지 않는 이름을 입력하세요. 최대 30개까지 만들 수 있습니다.</p>
      )}
    </section>
  );
}
