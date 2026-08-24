import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  isEditableDrawingLayer,
  updateDrawingSelectionProperties,
  type DrawingCommand,
  type DrawingDocumentState,
  type DrawingInspectorPatch,
} from "~/lukas/lib/drawing-commands";
import type { DrawingObject } from "~/lukas/lib/drawing-workspace.types";

type Props = {
  actorId: string;
  canEdit: boolean;
  onCommand: (command: DrawingCommand) => void;
  selectedIds: string[];
  state: Pick<DrawingDocumentState, "layers" | "objects">;
};

function sharedValue(
  objects: DrawingObject[],
  value: (object: DrawingObject) => string,
) {
  const first = objects[0] ? value(objects[0]) : "";
  return objects.every((object) => value(object) === first) ? first : "";
}

function inspectorError(error: unknown) {
  return error instanceof Error ? error.message : "속성을 변경하지 못했습니다.";
}

export function DrawingInspector({
  actorId,
  canEdit,
  onCommand,
  selectedIds,
  state,
}: Props) {
  const dirtyFields = useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const selectedObjects = useMemo(
    () => selectedIds.map((id) => state.objects[id]).filter(Boolean),
    [selectedIds, state.objects],
  );
  const selectionKey = selectedObjects
    .map((object) => `${object.id}:${object.version}`)
    .join("|");
  useEffect(() => {
    dirtyFields.current.clear();
    setError(null);
  }, [selectionKey]);

  const selectionEligible =
    selectedObjects.length === selectedIds.length &&
    selectedObjects.every((object) =>
      isEditableDrawingLayer(state.layers[object.layerId]),
    );
  const textOnly =
    selectedObjects.length > 0 &&
    selectedObjects.every((object) => object.geometry.type === "text");
  const editableLayers = Object.values(state.layers).filter(
    isEditableDrawingLayer,
  );

  function markDirty(field: string) {
    dirtyFields.current.add(field);
  }

  function applyProperties(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const dirty = dirtyFields.current;
    const patch: DrawingInspectorPatch = {};
    if (dirty.has("name")) patch.name = String(data.get("name") ?? "");
    if (dirty.has("layerId")) patch.layerId = String(data.get("layerId") ?? "");
    if (dirty.has("stroke")) patch.stroke = String(data.get("stroke") ?? "");
    if (dirty.has("strokeWidth"))
      patch.strokeWidth = Number(data.get("strokeWidth"));
    if (dirty.has("fill")) {
      const fill = String(data.get("fill") ?? "");
      patch.fill = fill === "" ? null : fill;
    }
    if (dirty.has("text")) patch.text = String(data.get("text") ?? "");
    try {
      const command = updateDrawingSelectionProperties(
        state,
        selectedIds,
        actorId,
        patch,
      );
      if (command) onCommand(command);
      dirty.clear();
      setError(null);
    } catch (caught) {
      setError(inspectorError(caught));
    }
  }

  if (selectedObjects.length === 0) {
    return (
      <section aria-labelledby="drawing-inspector-title">
        <h2 className="text-sm font-bold" id="drawing-inspector-title">
          속성
        </h2>
        <p className="mt-4 text-sm leading-6 text-slate-400">
          객체를 선택하면 속성을 편집할 수 있습니다.
        </p>
      </section>
    );
  }

  if (!selectionEligible) {
    return (
      <section aria-labelledby="drawing-inspector-title">
        <h2 className="text-sm font-bold" id="drawing-inspector-title">
          속성
        </h2>
        <p className="mt-4 text-sm text-amber-300" role="status">
          숨김 또는 잠긴 레이어의 선택은 편집할 수 없습니다.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="drawing-inspector-title">
      <h2 className="text-sm font-bold" id="drawing-inspector-title">
        속성
      </h2>
      <p className="mt-1 text-xs text-slate-400">
        {selectedObjects.length}개 객체 선택
      </p>
      <form
        className="mt-4 grid gap-3"
        data-drawing-shortcuts="ignore"
        key={selectionKey}
        onSubmit={applyProperties}
      >
        <label className="grid gap-1 text-xs" htmlFor="inspector-object-name">
          객체 이름
          <input
            className="min-h-10 rounded-md border border-white/15 bg-slate-950 px-2 text-sm"
            defaultValue={sharedValue(selectedObjects, (object) => object.name)}
            disabled={!canEdit}
            id="inspector-object-name"
            maxLength={255}
            name="name"
            onChange={() => markDirty("name")}
          />
        </label>

        <label className="grid gap-1 text-xs" htmlFor="inspector-layer">
          레이어
          <select
            className="min-h-10 rounded-md border border-white/15 bg-slate-950 px-2 text-sm"
            defaultValue={sharedValue(
              selectedObjects,
              (object) => object.layerId,
            )}
            disabled={!canEdit}
            id="inspector-layer"
            name="layerId"
            onChange={() => markDirty("layerId")}
          >
            <option disabled value="">
              혼합 값
            </option>
            {editableLayers.map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.name}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-xs" htmlFor="inspector-stroke">
          선 색상
          <input
            className="min-h-10 rounded-md border border-white/15 bg-slate-950 px-2 font-mono text-sm"
            defaultValue={sharedValue(
              selectedObjects,
              (object) => object.style.stroke,
            )}
            disabled={!canEdit}
            id="inspector-stroke"
            name="stroke"
            onChange={() => markDirty("stroke")}
            pattern="#[0-9a-fA-F]{6}"
            placeholder="#000000"
          />
        </label>

        <label className="grid gap-1 text-xs" htmlFor="inspector-stroke-width">
          선 두께
          <input
            className="min-h-10 rounded-md border border-white/15 bg-slate-950 px-2 text-sm"
            defaultValue={sharedValue(selectedObjects, (object) =>
              String(object.style.strokeWidth),
            )}
            disabled={!canEdit}
            id="inspector-stroke-width"
            max={1000}
            min={0.000001}
            name="strokeWidth"
            onChange={() => markDirty("strokeWidth")}
            step="any"
            type="number"
          />
        </label>

        <label className="grid gap-1 text-xs" htmlFor="inspector-fill">
          채우기
          <input
            className="min-h-10 rounded-md border border-white/15 bg-slate-950 px-2 font-mono text-sm"
            defaultValue={sharedValue(
              selectedObjects,
              (object) => object.style.fill ?? "",
            )}
            disabled={!canEdit}
            id="inspector-fill"
            name="fill"
            onChange={() => markDirty("fill")}
            pattern="#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?"
            placeholder="비우면 채우기 없음"
          />
        </label>

        {textOnly ? (
          <label className="grid gap-1 text-xs" htmlFor="inspector-text">
            텍스트
            <textarea
              className="min-h-24 rounded-md border border-white/15 bg-slate-950 p-2 text-sm"
              defaultValue={sharedValue(selectedObjects, (object) =>
                object.geometry.type === "text" ? object.geometry.text : "",
              )}
              disabled={!canEdit}
              id="inspector-text"
              maxLength={10000}
              name="text"
              onChange={() => markDirty("text")}
            />
          </label>
        ) : null}

        <button
          className="min-h-10 rounded-md bg-indigo-500 px-3 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!canEdit}
          type="submit"
        >
          속성 적용
        </button>
      </form>
      {error ? (
        <p className="mt-3 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
