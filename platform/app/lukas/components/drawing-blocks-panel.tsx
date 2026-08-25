import { useState, type FormEvent } from "react";

import {
  createBlockFromSelection,
  deleteDrawingBlockCommand,
  insertDrawingBlockInstanceCommand,
  updateDrawingBlockCommand,
} from "~/lukas/lib/drawing-blocks";
import type {
  DrawingBlock,
  DrawingBlockInstance,
} from "~/lukas/lib/drawing-workspace.types";
import type {
  DrawingCommand,
  DrawingDocumentState,
} from "~/lukas/lib/drawing-commands";
import { DrawingBlockSchema } from "~/lukas/lib/drawing-workspace.types";

type Props = {
  activeLayerId: string | null;
  actorId: string;
  canEdit: boolean;
  onCommand: (command: DrawingCommand) => void;
  onSelectionChange: (selectedIds: string[]) => void;
  selectedIds: string[];
  state: DrawingDocumentState;
};

export function DrawingBlockInstancesList({
  block,
  canEdit,
  instances,
  onSelectionChange,
}: {
  block: DrawingBlock;
  canEdit: boolean;
  instances: DrawingBlockInstance[];
  onSelectionChange: (selectedIds: string[]) => void;
}) {
  return (
    <ul
      aria-label={`${block.name} instances`}
      className="mt-2 space-y-1 border-t border-white/10 pt-2"
    >
      {instances.map((instance) => (
        <li className="flex items-center gap-2" key={instance.id}>
          <button
            aria-label={`${instance.name} instance 선택`}
            className="min-h-9 flex-1 rounded border border-white/15 px-2 text-left text-sm"
            onClick={() => onSelectionChange([instance.id])}
            type="button"
          >
            {instance.name}
          </button>
          {!canEdit ? (
            <span className="text-xs text-slate-400">읽기 전용</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "블록을 변경하지 못했습니다.";
}

/** Reusable definitions remain readable to every workspace member. */
export function DrawingBlocksPanel({
  activeLayerId,
  actorId,
  canEdit,
  onCommand,
  onSelectionChange,
  selectedIds,
  state,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [expandedBlockIds, setExpandedBlockIds] = useState<Set<string>>(
    () => new Set(),
  );
  const structure = state.structure;
  if (!structure) return null;
  const canonical = structure;
  const blocks = Object.values(canonical.blocks).sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (!activeLayerId) throw new Error("활성 레이어를 선택하세요.");
      const data = new FormData(event.currentTarget);
      onCommand(
        createBlockFromSelection(
          state,
          selectedIds,
          actorId,
          String(data.get("name") ?? ""),
          { activeLayerId },
        ),
      );
      setError(null);
      event.currentTarget.reset();
    } catch (caught) {
      setError(message(caught));
    }
  }

  function update(blockId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const current = canonical.blocks[blockId];
      const data = new FormData(event.currentTarget);
      const parsed = DrawingBlockSchema.parse({
        ...current,
        name: String(data.get("name") ?? ""),
        primitives: JSON.parse(String(data.get("primitives") ?? "[]")),
      });
      onCommand(
        updateDrawingBlockCommand(state, actorId, blockId, {
          name: parsed.name,
          primitives: parsed.primitives,
        }),
      );
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  }

  const list = (
    <ul aria-label="도면 블록" className="mt-4 space-y-3">
      {blocks.map((block) => {
        const instances = Object.values(canonical.blockInstances)
          .filter((instance) => instance.blockId === block.id)
          .sort(
            (left, right) =>
              left.name.localeCompare(right.name) ||
              left.id.localeCompare(right.id),
          );
        const used = instances.length;
        const expanded = expandedBlockIds.has(block.id);
        const instancesId = `block-instances-${block.id}`;
        const reasonId = `block-delete-reason-${block.id}`;
        return (
          <li
            className="rounded-md border border-white/10 bg-white/5 p-2"
            key={block.id}
          >
            {canEdit ? (
              <form
                className="grid gap-2"
                data-drawing-shortcuts="ignore"
                key={`${block.id}:${block.version}`}
                onSubmit={(event) => update(block.id, event)}
              >
                <label
                  className="grid gap-1 text-xs"
                  htmlFor={`block-name-${block.id}`}
                >
                  블록 이름
                  <input
                    className="min-h-9 rounded border border-white/10 bg-slate-950 px-2 text-sm"
                    defaultValue={block.name}
                    id={`block-name-${block.id}`}
                    maxLength={255}
                    name="name"
                    required
                  />
                </label>
                <label
                  className="grid gap-1 text-xs"
                  htmlFor={`block-primitives-${block.id}`}
                >
                  Primitive JSON
                  <textarea
                    className="min-h-24 rounded border border-white/10 bg-slate-950 p-2 font-mono text-xs"
                    defaultValue={JSON.stringify(block.primitives, null, 2)}
                    id={`block-primitives-${block.id}`}
                    name="primitives"
                    required
                  />
                </label>
                <button
                  className="min-h-9 rounded bg-indigo-500 px-2 text-sm font-semibold"
                  type="submit"
                >
                  정의 저장
                </button>
              </form>
            ) : (
              <>
                <p className="font-medium">{block.name}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Primitive {block.primitives.length}개 · Instance {used}개
                </p>
              </>
            )}
            {canEdit ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  className="min-h-9 rounded border border-white/20 px-2 text-sm disabled:opacity-50"
                  disabled={!activeLayerId}
                  onClick={() => {
                    try {
                      if (!activeLayerId) return;
                      onCommand(
                        insertDrawingBlockInstanceCommand(
                          state,
                          actorId,
                          block.id,
                          { x: 0, y: 0 },
                          { activeLayerId },
                        ),
                      );
                      setError(null);
                    } catch (caught) {
                      setError(message(caught));
                    }
                  }}
                  type="button"
                >
                  Instance 삽입
                </button>
                <button
                  aria-describedby={used ? reasonId : undefined}
                  className="min-h-9 rounded border border-white/20 px-2 text-sm disabled:opacity-50"
                  disabled={used > 0}
                  onClick={() => {
                    try {
                      onCommand(
                        deleteDrawingBlockCommand(state, actorId, block.id),
                      );
                      setError(null);
                    } catch (caught) {
                      setError(message(caught));
                    }
                  }}
                  type="button"
                >
                  정의 삭제
                </button>
              </div>
            ) : null}
            <button
              aria-controls={instancesId}
              aria-expanded={expanded}
              aria-label={`${block.name} Instance ${used}개 ${expanded ? "접기" : "보기"}`}
              className="mt-2 min-h-9 w-full rounded border border-white/15 px-2 text-left text-xs"
              onClick={() =>
                setExpandedBlockIds((current) => {
                  const next = new Set(current);
                  if (next.has(block.id)) next.delete(block.id);
                  else next.add(block.id);
                  return next;
                })
              }
              type="button"
            >
              Instance {used}개 {expanded ? "접기" : "보기"}
            </button>
            {expanded ? (
              <div id={instancesId}>
                <DrawingBlockInstancesList
                  block={block}
                  canEdit={canEdit}
                  instances={instances}
                  onSelectionChange={onSelectionChange}
                />
              </div>
            ) : null}
            {used ? (
              <span className="mt-2 block text-xs text-slate-400" id={reasonId}>
                사용 중인 정의는 삭제할 수 없습니다.
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <section
      aria-labelledby="drawing-blocks-title"
      className="mt-6 border-t border-white/10 pt-6"
    >
      <h2 className="text-sm font-bold" id="drawing-blocks-title">
        블록 라이브러리
      </h2>
      {!canEdit ? (
        <p className="mt-2 text-xs text-slate-400">읽기 전용 블록 목록</p>
      ) : (
        <form
          className="mt-3 grid gap-2"
          data-drawing-shortcuts="ignore"
          onSubmit={create}
        >
          <label className="text-xs" htmlFor="new-drawing-block-name">
            선택 객체로 블록 만들기
          </label>
          <input
            className="min-h-10 rounded border border-white/15 bg-slate-950 px-2 text-sm"
            id="new-drawing-block-name"
            maxLength={255}
            name="name"
            required
          />
          <button
            className="min-h-10 rounded bg-indigo-500 px-3 text-sm font-semibold disabled:opacity-50"
            disabled={!activeLayerId || selectedIds.length === 0}
            type="submit"
          >
            블록 만들기
          </button>
        </form>
      )}
      {error ? (
        <p className="mt-3 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {list}
    </section>
  );
}
