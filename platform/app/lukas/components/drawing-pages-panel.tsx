import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  createDrawingCanvasCommand,
  createDrawingPageCommand,
  deleteDrawingCanvasCommand,
  deleteDrawingPageCommand,
  drawingStructureDeletionReasons,
  renameDrawingCanvasCommand,
  renameDrawingPageCommand,
  reorderDrawingCanvasCommand,
  reorderDrawingPageCommand,
  type DrawingCommand,
  type DrawingDocumentState,
} from "~/lukas/lib/drawing-commands";
import {
  nextDrawingCanvasFocusIntent,
  type DrawingCanvasFocusIntent,
} from "~/lukas/lib/drawing-pages-focus";

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

function translatedReason(reason: string | null) {
  if (!reason) return null;
  return (
    {
      "A drawing document requires at least one page.":
        "도면 문서에는 페이지가 하나 이상 필요합니다.",
      "A page requires at least one canvas.":
        "페이지에는 캔버스가 하나 이상 필요합니다.",
      "Canvas with objects or blocks cannot be deleted.":
        "객체 또는 블록이 있는 캔버스는 삭제할 수 없습니다.",
      "The default paper canvas can only be deleted with its page.":
        "기본 용지 캔버스는 페이지와 함께만 삭제할 수 있습니다.",
    }[reason] ?? reason
  );
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
  const [focusIntent, setFocusIntent] =
    useState<DrawingCanvasFocusIntent | null>(null);
  const canvasButtons = useRef(new Map<string, HTMLButtonElement>());
  const previousActiveCanvasId = useRef(activeCanvasId);
  useEffect(() => {
    if (activeCanvasId && previousActiveCanvasId.current !== activeCanvasId)
      canvasButtons.current.get(activeCanvasId)?.focus();
    previousActiveCanvasId.current = activeCanvasId;
  }, [activeCanvasId]);
  useLayoutEffect(() => {
    if (focusIntent) canvasButtons.current.get(focusIntent.canvasId)?.focus();
  }, [focusIntent]);
  const structure = state.structure;
  const deletionReasons = useMemo(
    () =>
      state.structure
        ? drawingStructureDeletionReasons(state)
        : { canvases: {}, pages: {} },
    [state.layers, state.revisionId, state.structure],
  );
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

  function runDelete(
    command: () => Extract<DrawingCommand, { type: "mutate_structure" }>,
  ) {
    try {
      const currentStructure = state.structure;
      if (!currentStructure)
        throw new Error(
          "Drawing structure state is required for deletion focus.",
        );
      const next = command();
      onCommand(next);
      const deletedCanvasIds = next.actions.flatMap((action) =>
        action.kind === "delete_canvas" ? [action.id] : [],
      );
      const deletedPageIds = next.actions.flatMap((action) =>
        action.kind === "delete_page" ? [action.id] : [],
      );
      setFocusIntent((previous) =>
        nextDrawingCanvasFocusIntent(
          {
            activeCanvasId,
            pages: Object.values(currentStructure.pages),
            canvases: Object.values(currentStructure.canvases),
          },
          { deletedCanvasIds, deletedPageIds },
          previous?.token ?? 0,
        ),
      );
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
        spaceKind === "paper" ? "용지" : "모델",
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
        페이지 및 캔버스
      </h2>
      {canEdit ? (
        <details className="mt-3 rounded-md border border-slate-200 p-2">
          <summary className="cursor-pointer text-xs font-semibold text-indigo-600">
            페이지 만들기
          </summary>
          <form
            className="mt-3 grid gap-2"
            data-drawing-shortcuts="ignore"
            onSubmit={createPage}
          >
            <label className="text-xs text-slate-700" htmlFor="new-page-name">
              새 페이지 이름
            </label>
            <input
              className="min-h-10 rounded-md border border-slate-200 bg-white px-2 text-sm"
              id="new-page-name"
              maxLength={255}
              name="page_name"
            />
            <button
              className="min-h-10 rounded-md bg-indigo-600 px-3 text-sm font-semibold text-white"
              type="submit"
            >
              페이지 추가
            </button>
          </form>
        </details>
      ) : null}
      {error ? (
        <p className="mt-3 text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="mt-4 space-y-3" aria-label="도면 페이지와 캔버스">
        {pages.map((page, pageIndex) => {
          const canvases = ordered(
            Object.values(structure.canvases).filter(
              (canvas) => canvas.pageId === page.id,
            ),
          );
          const pageDeleteReason = translatedReason(
            deletionReasons.pages[page.id] ?? null,
          );
          return (
            <li key={page.id}>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                {canEdit ? (
                  <div className="flex min-w-0 flex-wrap items-center gap-1 [&>button]:shrink-0">
                    <label className="sr-only" htmlFor={`page-name-${page.id}`}>
                      페이지 이름: {page.name}
                    </label>
                    <input
                      className="min-h-9 min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 text-sm"
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
                      aria-describedby={
                        pageDeleteReason
                          ? `page-delete-reason-${page.id}`
                          : undefined
                      }
                      disabled={Boolean(pageDeleteReason)}
                      onClick={() =>
                        runDelete(() =>
                          deleteDrawingPageCommand(state, actorId, page.id),
                        )
                      }
                      type="button"
                    >
                      삭제
                    </button>
                    {pageDeleteReason ? (
                      <p
                        className="mt-2 w-full shrink-0 basis-full text-xs leading-5 text-slate-500"
                        id={`page-delete-reason-${page.id}`}
                      >
                        {pageDeleteReason}
                      </p>
                    ) : null}
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
                      용지 캔버스 추가
                    </button>
                    <button
                      onClick={() => createCanvas(page.id, "model")}
                      type="button"
                    >
                      모델 캔버스 추가
                    </button>
                  </div>
                ) : null}
              </div>
              <ul className="ml-3 mt-2 space-y-2 border-l border-slate-200 pl-3">
                {canvases.map((canvas) => {
                  const reason = translatedReason(
                    deletionReasons.canvases[canvas.id] ?? null,
                  );
                  const defaultCanvas =
                    canvas.spaceKind === "paper" && canvas.sortOrder === 0;
                  const tail = canvases.filter(
                    (candidate) =>
                      !(
                        candidate.spaceKind === "paper" &&
                        candidate.sortOrder === 0
                      ),
                  );
                  const tailIndex = tail.findIndex(
                    (candidate) => candidate.id === canvas.id,
                  );
                  const orderReason = defaultCanvas
                    ? "기본 용지 캔버스는 페이지 맨 위에 고정됩니다."
                    : tailIndex === 0
                      ? "이 캔버스는 기본 용지 캔버스 다음의 첫 항목입니다."
                      : null;
                  return (
                    <li key={canvas.id}>
                      <div className="rounded-md border border-slate-200 p-2">
                        <button
                          aria-current={
                            activeCanvasId === canvas.id ? "page" : undefined
                          }
                          className="min-h-9 text-left text-sm font-medium"
                          ref={(node) => {
                            if (node)
                              canvasButtons.current.set(canvas.id, node);
                            else canvasButtons.current.delete(canvas.id);
                          }}
                          onClick={() => onCanvasSelect(canvas.id)}
                          type="button"
                        >
                          {canvas.name}{" "}
                          <span className="text-xs text-slate-500">
                            ({canvas.spaceKind === "paper" ? "용지" : "모델"})
                          </span>
                        </button>
                        {canEdit ? (
                          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1 [&>button]:shrink-0">
                            <label
                              className="sr-only"
                              htmlFor={`canvas-name-${canvas.id}`}
                            >
                              캔버스 이름: {canvas.name}
                            </label>
                            <input
                              className="min-h-8 min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 text-xs"
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
                              aria-label={`캔버스 위로 이동: ${canvas.name}`}
                              aria-describedby={
                                orderReason
                                  ? `canvas-order-reason-${canvas.id}`
                                  : undefined
                              }
                              disabled={defaultCanvas || tailIndex === 0}
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
                              aria-label={`캔버스 아래로 이동: ${canvas.name}`}
                              aria-describedby={
                                defaultCanvas
                                  ? `canvas-order-reason-${canvas.id}`
                                  : undefined
                              }
                              disabled={
                                defaultCanvas || tailIndex === tail.length - 1
                              }
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
                              aria-label={`캔버스 삭제: ${canvas.name}`}
                              aria-describedby={
                                reason
                                  ? `canvas-delete-reason-${canvas.id}`
                                  : undefined
                              }
                              disabled={Boolean(reason)}
                              onClick={() =>
                                runDelete(() =>
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
                            {reason || orderReason ? (
                              <div className="mt-2 w-full shrink-0 basis-full space-y-1">
                                {reason ? (
                                  <p
                                    className="w-full text-xs leading-5 text-slate-500"
                                    id={`canvas-delete-reason-${canvas.id}`}
                                  >
                                    {reason}
                                  </p>
                                ) : null}
                                {orderReason ? (
                                  <p
                                    className="w-full text-xs leading-5 text-slate-500"
                                    id={`canvas-order-reason-${canvas.id}`}
                                  >
                                    {orderReason}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}
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
