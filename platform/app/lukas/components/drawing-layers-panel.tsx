import { useState, type FormEvent } from "react";

import {
  createDrawingLayerCommand,
  isEditableDrawingLayer,
  moveDrawingLayerToCanvasCommand,
  reorderDrawingLayerCommand,
  updateDrawingLayerCommand,
  type DrawingCommand,
  type DrawingDocumentState,
  type LayerPatch,
} from "~/lukas/lib/drawing-commands";

type Props = {
  activeCanvasId: string | null;
  activeLayerId: string | null;
  actorId: string;
  canEdit: boolean;
  onActiveLayerChange: (layerId: string) => void;
  onCommand: (command: DrawingCommand) => void;
  state: Pick<DrawingDocumentState, "revisionId" | "layers" | "structure">;
};

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "레이어를 변경하지 못했습니다.";
}

export function DrawingLayersPanel({
  activeCanvasId,
  activeLayerId,
  actorId,
  canEdit,
  onActiveLayerChange,
  onCommand,
  state,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const layers = Object.values(state.layers)
    .filter((layer) => !activeCanvasId || layer.canvasId === activeCanvasId)
    .sort(
      (left, right) =>
        (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
        left.id.localeCompare(right.id),
    );
  const canvases =
    state.structure && activeCanvasId
      ? Object.values(state.structure.canvases)
          .filter(
            (canvas) =>
              canvas.pageId ===
              state.structure?.canvases[activeCanvasId]?.pageId,
          )
          .sort(
            (left, right) =>
              left.sortOrder - right.sortOrder ||
              left.id.localeCompare(right.id),
          )
      : [];
  function createLayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const command = createDrawingLayerCommand(
        state,
        actorId,
        String(new FormData(form).get("layer_name") ?? ""),
        undefined,
        activeCanvasId ?? undefined,
      );
      onCommand(command);
      onActiveLayerChange(command.layer.id);
      setError(null);
      form.reset();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }
  function updateLayer(layerId: string, patch: LayerPatch) {
    try {
      onCommand(updateDrawingLayerCommand(state, actorId, layerId, patch));
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }
  if (!canEdit)
    return (
      <section aria-labelledby="drawing-layers-title">
        <h2 className="text-sm font-bold" id="drawing-layers-title">
          레이어
        </h2>
        <p className="mt-3 text-xs text-slate-400">읽기 전용 레이어 목록</p>
        <ul className="mt-4 space-y-2 text-sm">
          {layers.map((layer) => (
            <li
              className="rounded-md border border-white/10 bg-white/5 p-2"
              key={layer.id}
            >
              <p className="font-medium">{layer.name}</p>
              <p className="mt-2 text-xs text-slate-400">
                {layer.visible ? "표시" : "숨김"} ·{" "}
                {layer.locked ? "잠금" : "잠금 해제"}
                {layer.systemKind === "source" ? " · 원본 레이어" : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>
    );
  const movableLayers = layers.filter((layer) => layer.systemKind !== "source");
  return (
    <section aria-labelledby="drawing-layers-title">
      <h2 className="text-sm font-bold" id="drawing-layers-title">
        레이어
      </h2>
      <form
        className="mt-3 grid gap-2"
        data-drawing-shortcuts="ignore"
        onSubmit={createLayer}
      >
        <label className="text-xs text-slate-300" htmlFor="new-layer-name">
          새 레이어 이름
        </label>
        <input
          className="min-h-10 min-w-0 rounded-md border border-white/15 bg-slate-950 px-2 text-sm"
          id="new-layer-name"
          maxLength={255}
          name="layer_name"
        />
        <button
          className="min-h-10 rounded-md bg-indigo-500 px-3 text-sm font-semibold text-white"
          type="submit"
        >
          레이어 추가
        </button>
      </form>
      {error ? (
        <p className="mt-3 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="mt-4 space-y-2 text-sm">
        {layers.map((layer) => {
          const source = layer.systemKind === "source";
          const editable = isEditableDrawingLayer(layer);
          const position = movableLayers.findIndex(
            (candidate) => candidate.id === layer.id,
          );
          return (
            <li
              className="rounded-md border border-white/10 bg-white/5 p-2"
              key={layer.id}
            >
              {source ? (
                <p className="font-medium">{layer.name}</p>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    aria-label={`활성 레이어: ${layer.name}`}
                    checked={activeLayerId === layer.id}
                    disabled={!editable}
                    name="active_drawing_layer"
                    onChange={() => onActiveLayerChange(layer.id)}
                    type="radio"
                  />
                  <label className="sr-only" htmlFor={`layer-name-${layer.id}`}>
                    레이어 이름: {layer.name}
                  </label>
                  <input
                    className="min-h-9 min-w-0 flex-1 rounded border border-white/10 bg-slate-950 px-2"
                    defaultValue={layer.name}
                    id={`layer-name-${layer.id}`}
                    key={`${layer.id}:${layer.version}:name`}
                    maxLength={255}
                    onBlur={(event) => {
                      const name = event.currentTarget.value.trim();
                      if (name !== layer.name) updateLayer(layer.id, { name });
                    }}
                  />
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-300">
                {!source ? (
                  <label className="inline-flex min-h-8 items-center gap-1">
                    <input
                      aria-label={`레이어 표시: ${layer.name}`}
                      checked={layer.visible}
                      onChange={(event) =>
                        updateLayer(layer.id, { visible: event.target.checked })
                      }
                      type="checkbox"
                    />
                    레이어 표시
                  </label>
                ) : null}
                {!source ? (
                  <label className="inline-flex min-h-8 items-center gap-1">
                    <input
                      aria-label={`레이어 잠금: ${layer.name}`}
                      checked={layer.locked}
                      onChange={(event) =>
                        updateLayer(layer.id, { locked: event.target.checked })
                      }
                      type="checkbox"
                    />
                    레이어 잠금
                  </label>
                ) : null}
                {source ? <span>원본 레이어</span> : null}
                {!source ? (
                  <>
                    <button
                      aria-label={`레이어 위로 이동: ${layer.name}`}
                      disabled={position <= 0}
                      onClick={() => {
                        try {
                          onCommand(
                            reorderDrawingLayerCommand(
                              state,
                              actorId,
                              layer.id,
                              "up",
                            ),
                          );
                          setError(null);
                        } catch (caught) {
                          setError(errorMessage(caught));
                        }
                      }}
                      type="button"
                    >
                      위로
                    </button>
                    <button
                      aria-label={`레이어 아래로 이동: ${layer.name}`}
                      disabled={position === movableLayers.length - 1}
                      onClick={() => {
                        try {
                          onCommand(
                            reorderDrawingLayerCommand(
                              state,
                              actorId,
                              layer.id,
                              "down",
                            ),
                          );
                          setError(null);
                        } catch (caught) {
                          setError(errorMessage(caught));
                        }
                      }}
                      type="button"
                    >
                      아래로
                    </button>
                    {canvases.length > 1 ? (
                      <label className="inline-flex items-center gap-1">
                        다른 canvas로 이동
                        <select
                          aria-label={`레이어 canvas 이동: ${layer.name}`}
                          value={layer.canvasId}
                          onChange={(event) => {
                            try {
                              onCommand(
                                moveDrawingLayerToCanvasCommand(
                                  state,
                                  actorId,
                                  layer.id,
                                  event.target.value,
                                ),
                              );
                              setError(null);
                            } catch (caught) {
                              setError(errorMessage(caught));
                            }
                          }}
                        >
                          {canvases.map((canvas) => (
                            <option key={canvas.id} value={canvas.id}>
                              {canvas.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
