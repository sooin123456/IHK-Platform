import { useState, type FormEvent } from "react";

import {
  createDrawingLayerCommand,
  isEditableDrawingLayer,
  updateDrawingLayerCommand,
  type DrawingCommand,
  type DrawingDocumentState,
  type LayerPatch,
} from "~/lukas/lib/drawing-commands";

type Props = {
  activeLayerId: string | null;
  actorId: string;
  canEdit: boolean;
  onActiveLayerChange: (layerId: string) => void;
  onCommand: (command: DrawingCommand) => void;
  state: Pick<DrawingDocumentState, "layers">;
};

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "레이어를 변경하지 못했습니다.";
}

export function DrawingLayersPanel({
  activeLayerId,
  actorId,
  canEdit,
  onActiveLayerChange,
  onCommand,
  state,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const layers = Object.values(state.layers);

  function createLayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const command = createDrawingLayerCommand(
        state,
        actorId,
        String(data.get("layer_name") ?? ""),
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

  if (!canEdit) {
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
  }

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
          disabled={!canEdit}
          id="new-layer-name"
          maxLength={255}
          name="layer_name"
        />
        <button
          className="min-h-10 rounded-md bg-indigo-500 px-3 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!canEdit}
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
          return (
            <li
              className="rounded-md border border-white/10 bg-white/5 p-2"
              key={layer.id}
            >
              <div className="flex items-center gap-2">
                <input
                  aria-label={`활성 레이어: ${layer.name}`}
                  checked={activeLayerId === layer.id}
                  disabled={!canEdit || !editable}
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
                  disabled={!canEdit || source}
                  id={`layer-name-${layer.id}`}
                  key={`${layer.id}:${layer.version}:name`}
                  maxLength={255}
                  onBlur={(event) => {
                    const name = event.currentTarget.value.trim();
                    if (name !== layer.name) updateLayer(layer.id, { name });
                  }}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-300">
                <label className="inline-flex min-h-8 items-center gap-1">
                  <input
                    aria-label={`레이어 표시: ${layer.name}`}
                    checked={layer.visible}
                    disabled={!canEdit || source}
                    onChange={(event) =>
                      updateLayer(layer.id, { visible: event.target.checked })
                    }
                    type="checkbox"
                  />
                  레이어 표시
                </label>
                <label className="inline-flex min-h-8 items-center gap-1">
                  <input
                    aria-label={`레이어 잠금: ${layer.name}`}
                    checked={layer.locked}
                    disabled={!canEdit || source}
                    onChange={(event) =>
                      updateLayer(layer.id, { locked: event.target.checked })
                    }
                    type="checkbox"
                  />
                  레이어 잠금
                </label>
                {source ? <span>원본 레이어</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs leading-5 text-slate-400">
        P0/P1에서는 레이어 삭제를 지원하지 않습니다.
      </p>
    </section>
  );
}
