import { useState, type FormEvent } from "react";

import {
  createDrawingStyleCommand,
  deleteDrawingStyleCommand,
  updateDrawingStyleCommand,
  type DrawingCommand,
  type DrawingDocumentState,
} from "~/lukas/lib/drawing-commands";
import type { DrawingStyle } from "~/lukas/lib/drawing-workspace.types";

type Props = {
  actorId: string;
  canEdit: boolean;
  onCommand: (command: DrawingCommand) => void;
  state: Pick<DrawingDocumentState, "revisionId" | "layers" | "objects" | "structure">;
};

const defaultValue: DrawingStyle = { stroke: "#2563eb", strokeWidth: 2, fill: null };

function message(error: unknown) {
  return error instanceof Error ? error.message : "스타일을 변경하지 못했습니다.";
}

function styleValue(data: FormData): DrawingStyle {
  const fill = String(data.get("fill") ?? "").trim();
  const fontSize = String(data.get("fontSize") ?? "").trim();
  return {
    stroke: String(data.get("stroke") ?? "").trim(),
    strokeWidth: Number(data.get("strokeWidth")),
    fill: fill || null,
    ...(fontSize ? { fontSize: Number(fontSize) } : {}),
  };
}

/** Canonical reusable style definition controls. Hidden entirely for viewers. */
export function DrawingStylesPanel({ actorId, canEdit, onCommand, state }: Props) {
  const [error, setError] = useState<string | null>(null);
  const structure = state.structure;
  if (!canEdit || !structure) return null;
  const styles = Object.values(structure.styles).sort(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
  const referenced = (styleId: string) =>
    Object.values(state.objects).some((object) => object.styleId === styleId) ||
    Object.values(structure.blocks).some((block) =>
      block.primitives.some((primitive) => primitive.styleId === styleId),
    );

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const data = new FormData(form);
      onCommand(createDrawingStyleCommand(state, actorId, String(data.get("name") ?? ""), styleValue(data)));
      setError(null);
      form.reset();
    } catch (caught) {
      setError(message(caught));
    }
  }

  function update(styleId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const data = new FormData(event.currentTarget);
      onCommand(updateDrawingStyleCommand(state, actorId, styleId, {
        name: String(data.get("name") ?? ""), value: styleValue(data),
      }));
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  }

  return (
    <section aria-labelledby="drawing-styles-title" className="mt-6 border-t border-white/10 pt-6">
      <h2 className="text-sm font-bold" id="drawing-styles-title">스타일 라이브러리</h2>
      <form className="mt-3 grid gap-2" data-drawing-shortcuts="ignore" onSubmit={create}>
        <label className="text-xs text-slate-300" htmlFor="new-drawing-style-name">새 스타일 이름</label>
        <input className="min-h-10 rounded-md border border-white/15 bg-slate-950 px-2 text-sm" id="new-drawing-style-name" maxLength={255} name="name" required />
        <input name="stroke" type="hidden" value={defaultValue.stroke} />
        <input name="strokeWidth" type="hidden" value={defaultValue.strokeWidth} />
        <button className="min-h-10 rounded-md bg-indigo-500 px-3 text-sm font-semibold text-white" type="submit">스타일 추가</button>
      </form>
      {error ? <p className="mt-3 text-xs text-red-300" role="alert">{error}</p> : null}
      <ul aria-label="도면 스타일" className="mt-4 space-y-3">
        {styles.map((style) => {
          const used = referenced(style.id);
          return (
            <li className="rounded-md border border-white/10 bg-white/5 p-2" key={style.id}>
              <form className="grid gap-2" data-drawing-shortcuts="ignore" key={`${style.id}:${style.version}`} onSubmit={(event) => update(style.id, event)}>
                <label className="sr-only" htmlFor={`style-name-${style.id}`}>스타일 이름: {style.name}</label>
                <input className="min-h-9 rounded border border-white/10 bg-slate-950 px-2 text-sm" defaultValue={style.name} id={`style-name-${style.id}`} maxLength={255} name="name" required />
                <label className="grid gap-1 text-xs" htmlFor={`style-stroke-${style.id}`}>선 색상
                  <input className="min-h-9 rounded border border-white/10 bg-slate-950 px-2 font-mono text-sm" defaultValue={style.value.stroke} id={`style-stroke-${style.id}`} name="stroke" pattern="#[0-9a-fA-F]{6}" required />
                </label>
                <label className="grid gap-1 text-xs" htmlFor={`style-width-${style.id}`}>선 두께
                  <input className="min-h-9 rounded border border-white/10 bg-slate-950 px-2 text-sm" defaultValue={style.value.strokeWidth} id={`style-width-${style.id}`} max={1000} min={0.000001} name="strokeWidth" step="any" type="number" required />
                </label>
                <label className="grid gap-1 text-xs" htmlFor={`style-fill-${style.id}`}>채우기
                  <input className="min-h-9 rounded border border-white/10 bg-slate-950 px-2 font-mono text-sm" defaultValue={style.value.fill ?? ""} id={`style-fill-${style.id}`} name="fill" pattern="#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?" placeholder="비우면 없음" />
                </label>
                <label className="grid gap-1 text-xs" htmlFor={`style-font-size-${style.id}`}>글꼴 크기
                  <input className="min-h-9 rounded border border-white/10 bg-slate-950 px-2 text-sm" defaultValue={style.value.fontSize ?? ""} id={`style-font-size-${style.id}`} max={10000} min={0.000001} name="fontSize" step="any" type="number" />
                </label>
                <button className="min-h-9 rounded bg-indigo-500 px-2 text-sm font-semibold text-white" type="submit">스타일 저장</button>
              </form>
              <button aria-label={`스타일 삭제: ${style.name}`} className="mt-2 min-h-9 rounded border border-white/20 px-2 text-sm disabled:opacity-50" disabled={used} onClick={() => {
                try { onCommand(deleteDrawingStyleCommand(state, actorId, style.id)); setError(null); } catch (caught) { setError(message(caught)); }
              }} title={used ? "사용 중인 스타일은 삭제할 수 없습니다." : undefined} type="button">스타일 삭제</button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
