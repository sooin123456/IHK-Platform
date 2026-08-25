import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  createDrawingCanvasCommand,
  createDrawingPageCommand,
  deleteDrawingCanvasCommand,
  deleteDrawingPageCommand,
  drawingCanvasDeletionReason,
  drawingPageDeletionReason,
  renameDrawingCanvasCommand,
  renameDrawingPageCommand,
  reorderDrawingCanvasCommand,
  reorderDrawingPageCommand,
  type DrawingCommand,
  type DrawingDocumentState,
} from "~/lukas/lib/drawing-commands";

type Props = {
  activeCanvasId: string | null;
  actorId: string;
  canEdit: boolean;
  onCanvasSelect: (canvasId: string) => void;
  onCommand: (command: DrawingCommand) => void;
  state: Pick<DrawingDocumentState, "revisionId" | "layers" | "structure">;
};

function ordered<T extends { id: string; sortOrder: number }>(items: T[]) {
  return [...items].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
  );
}

function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "페이지 구조를 변경하지 못했습니다.";
}

export function DrawingPagesPanel({
  activeCanvasId,
  actorId,
  canEdit,
  onCanvasSelect,
  onCommand,
  state,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const canvasButtons = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (activeCanvasId) canvasButtons.current.get(activeCanvasId)?.focus();
  }, [activeCanvasId]);
  const structure = state.structure;
  if (!structure) return null;
  const pages = ordered(Object.values(structure.pages));

  function run(command: () => DrawingCommand) {
    try {
      onCommand(command());
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  }

  function createPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const command = createDrawingPageCommand(
        state,
        actorId,
        String(new FormData(form).get("page_name") ?? ""),
      );
      onCommand(command);
      const canvasAction = command.actions.find(
        (action) => action.kind === "put_canvas",
      );
      if (canvasAction && "entity" in canvasAction)
        onCanvasSelect(canvasAction.entity.id);
      setError(null);
      form.reset();
    } catch (caught) {
      setError(message(caught));
    }
  }

  function createCanvas(pageId: string, spaceKind: "paper" | "model") {
    try {
      const command = createDrawingCanvasCommand(
        state,
        actorId,
        pageId,
        spaceKind,
        spaceKind === "paper" ? "Paper" : "Model",
      );
      onCommand(command);
      const canvasAction = command.actions.find(
        (action) => action.kind === "put_canvas",
      );
      if (canvasAction && "entity" in canvasAction)
        onCanvasSelect(canvasAction.entity.id);
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  }

  return (
    <section aria-labelledby="drawing-pages-title">
      <h2 className="text-sm font-bold" id="drawing-pages-title">
        페이지 및 canvas
      </h2>
      {canEdit ? (
        <form
          className="mt-3 grid gap-2"
          data-drawing-shortcuts="ignore"
          onSubmit={createPage}
        >
          <label className="text-xs text-slate-300" htmlFor="new-page-name">
            새 페이지 이름
          </label>
          <input
            className="min-h-10 rounded-md border border-white/15 bg-slate-950 px-2 text-sm"
            id="new-page-name"
            maxLength={255}
            name="page_name"
          />
          <button
            className="min-h-10 rounded-md bg-indigo-500 px-3 text-sm font-semibold text-white"
            type="submit"
          >
            페이지 추가
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="mt-3 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      <ul
        className="mt-4 space-y-3"
        aria-label="도면 페이지와 canvas"
      >
        {pages.map((page, pageIndex) => {
          const canvases = ordered(
            Object.values(structure.canvases).filter(
              (canvas) => canvas.pageId === page.id,
            ),
          );
          const pageDeleteReason = drawingPageDeletionReason(state, page.id);
          return (
            <li key={page.id}>
              <div className="rounded-md border border-white/10 bg-white/5 p-2">
                {canEdit ? (
                  <div className="flex items-center gap-1">
                    <label className="sr-only" htmlFor={`page-name-${page.id}`}>
                      페이지 이름: {page.name}
                    </label>
                    <input
                      className="min-h-9 min-w-0 flex-1 rounded border border-white/10 bg-slate-950 px-2 text-sm"
                      defaultValue={page.name}
                      id={`page-name-${page.id}`}
                      key={`${page.id}:${page.version}`}
                      maxLength={255}
                      onBlur={(event) => {
                        const name = event.currentTarget.value.trim();
                        if (name !== page.name)
                          run(() =>
                            renameDrawingPageCommand(
                              state,
                              actorId,
                              page.id,
                              name,
                            ),
                          );
                      }}
                    />
                    <button
                      aria-label={`페이지 위로 이동: ${page.name}`}
                      disabled={pageIndex === 0}
                      onClick={() =>
                        run(() =>
                          reorderDrawingPageCommand(
                            state,
                            actorId,
                            page.id,
                            "up",
                          ),
                        )
                      }
                      type="button"
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`페이지 아래로 이동: ${page.name}`}
                      disabled={pageIndex === pages.length - 1}
                      onClick={() =>
                        run(() =>
                          reorderDrawingPageCommand(
                            state,
                            actorId,
                            page.id,
                            "down",
                          ),
                        )
                      }
                      type="button"
                    >
                      ↓
                    </button>
                    <button
                      aria-label={`페이지 삭제: ${page.name}`}
                      aria-describedby={pageDeleteReason ? `page-delete-reason-${page.id}` : undefined}
                      disabled={Boolean(pageDeleteReason)}
                      onClick={() =>
                        run(() =>
                          deleteDrawingPageCommand(state, actorId, page.id),
                        )
                      }
                      type="button"
                    >
                      삭제
                    </button>
                    {pageDeleteReason ? <p className="text-xs text-slate-400" id={`page-delete-reason-${page.id}`}>{pageDeleteReason}</p> : null}
                  </div>
                ) : (
                  <p className="font-medium">{page.name}</p>
                )}
                {canEdit ? (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <button
                      onClick={() => createCanvas(page.id, "paper")}
                      type="button"
                    >
                      Paper canvas 추가
                    </button>
                    <button
                      onClick={() => createCanvas(page.id, "model")}
                      type="button"
                    >
                      Model canvas 추가
                    </button>
                  </div>
                ) : null}
              </div>
              <ul
                className="ml-3 mt-2 space-y-2 border-l border-white/10 pl-3"
              >
                {canvases.map((canvas, canvasIndex) => {
                  const reason = drawingCanvasDeletionReason(state, canvas.id);
                  return (
                    <li key={canvas.id}>
                      <div className="rounded-md border border-white/10 p-2">
                        <button
                          aria-current={
                            activeCanvasId === canvas.id ? "page" : undefined
                          }
                          className="min-h-9 text-left text-sm font-medium"
                          ref={(node) => {
                            if (node) canvasButtons.current.set(canvas.id, node);
                            else canvasButtons.current.delete(canvas.id);
                          }}
                          onClick={() => onCanvasSelect(canvas.id)}
                          type="button"
                        >
                          {canvas.name}{" "}
                          <span className="text-xs text-slate-400">
                            ({canvas.spaceKind})
                          </span>
                        </button>
                        {canEdit ? (
                          <div className="mt-2 flex items-center gap-1">
                            <label
                              className="sr-only"
                              htmlFor={`canvas-name-${canvas.id}`}
                            >
                              canvas 이름: {canvas.name}
                            </label>
                            <input
                              className="min-h-8 min-w-0 flex-1 rounded border border-white/10 bg-slate-950 px-2 text-xs"
                              defaultValue={canvas.name}
                              id={`canvas-name-${canvas.id}`}
                              key={`${canvas.id}:${canvas.version}`}
                              maxLength={255}
                              onBlur={(event) => {
                                const name = event.currentTarget.value.trim();
                                if (name !== canvas.name)
                                  run(() =>
                                    renameDrawingCanvasCommand(
                                      state,
                                      actorId,
                                      canvas.id,
                                      name,
                                    ),
                                  );
                              }}
                            />
                            <button
                              aria-label={`canvas 위로 이동: ${canvas.name}`}
                              disabled={canvasIndex === 0}
                              onClick={() =>
                                run(() =>
                                  reorderDrawingCanvasCommand(
                                    state,
                                    actorId,
                                    canvas.id,
                                    "up",
                                  ),
                                )
                              }
                              type="button"
                            >
                              ↑
                            </button>
                            <button
                              aria-label={`canvas 아래로 이동: ${canvas.name}`}
                              disabled={canvasIndex === canvases.length - 1}
                              onClick={() =>
                                run(() =>
                                  reorderDrawingCanvasCommand(
                                    state,
                                    actorId,
                                    canvas.id,
                                    "down",
                                  ),
                                )
                              }
                              type="button"
                            >
                              ↓
                            </button>
                            <button
                              aria-label={`canvas 삭제: ${canvas.name}`}
                              aria-describedby={reason ? `canvas-delete-reason-${canvas.id}` : undefined}
                              disabled={Boolean(reason)}
                              onClick={() =>
                                run(() =>
                                  deleteDrawingCanvasCommand(
                                    state,
                                    actorId,
                                    canvas.id,
                                  ),
                                )
                              }
                              type="button"
                            >
                              삭제
                            </button>
                            {reason ? <p className="text-xs text-slate-400" id={`canvas-delete-reason-${canvas.id}`}>{reason}</p> : null}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
