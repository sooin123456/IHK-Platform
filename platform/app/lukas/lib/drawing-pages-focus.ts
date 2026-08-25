export type DrawingCanvasFocusIntent = {
  canvasId: string;
  token: number;
};

type FocusPage = { id: string; sortOrder: number };
type FocusCanvas = { id: string; pageId: string; sortOrder: number };

function ordered<T extends { id: string; sortOrder: number }>(
  items: readonly T[],
) {
  return [...items].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
  );
}

/** Picks a post-delete canvas target before dispatch, including non-active deletes. */
export function nextDrawingCanvasFocusIntent(
  state: {
    activeCanvasId: string | null;
    pages: readonly FocusPage[];
    canvases: readonly FocusCanvas[];
  },
  deletion: {
    deletedCanvasIds?: readonly string[];
    deletedPageIds?: readonly string[];
  },
  previousToken: number,
): DrawingCanvasFocusIntent | null {
  const deletedPages = new Set(deletion.deletedPageIds ?? []);
  const deletedCanvases = new Set(deletion.deletedCanvasIds ?? []);
  const allCanvases = ordered(state.canvases);
  const survivors = allCanvases.filter(
    (canvas) =>
      !deletedCanvases.has(canvas.id) && !deletedPages.has(canvas.pageId),
  );
  if (survivors.length === 0) return null;
  const active = allCanvases.find(
    (canvas) => canvas.id === state.activeCanvasId,
  );
  if (active && survivors.some((canvas) => canvas.id === active.id))
    return { canvasId: active.id, token: previousToken + 1 };
  if (active) {
    const siblings = allCanvases.filter(
      (canvas) => canvas.pageId === active.pageId,
    );
    const siblingSurvivors = siblings.filter((canvas) =>
      survivors.includes(canvas),
    );
    const activeIndex = siblings.findIndex((canvas) => canvas.id === active.id);
    const siblingTarget =
      siblingSurvivors.find(
        (canvas) =>
          siblings.findIndex((candidate) => candidate.id === canvas.id) >
          activeIndex,
      ) ?? siblingSurvivors.at(-1);
    if (siblingTarget)
      return { canvasId: siblingTarget.id, token: previousToken + 1 };
    const pages = ordered(state.pages);
    const pageIndex = pages.findIndex((page) => page.id === active.pageId);
    const pageOrder = [
      ...pages.slice(pageIndex + 1),
      ...pages.slice(0, pageIndex).reverse(),
    ];
    for (const page of pageOrder) {
      const target = survivors.find((canvas) => canvas.pageId === page.id);
      if (target) return { canvasId: target.id, token: previousToken + 1 };
    }
  }
  return { canvasId: survivors[0].id, token: previousToken + 1 };
}
