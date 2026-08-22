export const drawingIssuePageSize = 50;

export type DrawingIssuePageInfo = ReturnType<typeof drawingIssuePageInfo>;

const drawingIssueIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseDrawingIssuePage(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= 1_000_000 ? page : 1;
}

export function parseDrawingIssueId(value: string | null) {
  if (!value || !drawingIssueIdPattern.test(value)) return null;
  return value.toLowerCase();
}

export function drawingIssuePageHref(search: string, page: number) {
  const params = new URLSearchParams(search);
  params.set("page", String(page));
  return `?${params.toString()}`;
}

export function drawingIssueRange(page: number) {
  const from = (page - 1) * drawingIssuePageSize;
  return { from, to: from + drawingIssuePageSize - 1 };
}

export function drawingIssuePageInfo(page: number, totalCount: number) {
  const totalPages = Math.max(1, Math.ceil(totalCount / drawingIssuePageSize));
  return {
    page: Math.min(page, totalPages),
    pageSize: drawingIssuePageSize,
    totalCount,
    totalPages,
  };
}

export function mergeFocusedIssue<T extends { id: string }>(
  page: T[],
  focused: T | null,
) {
  if (!focused || page.some((issue) => issue.id === focused.id)) return page;
  return [focused, ...page];
}

export function reconcileDrawingIssueSelection<T extends { id: string }>(
  issues: T[],
  selectedIssueId: string | null,
  initialIssueId: string | null,
  previousInitialIssueId: string | null,
) {
  if (
    initialIssueId !== previousInitialIssueId &&
    issues.some((issue) => issue.id === initialIssueId)
  )
    return initialIssueId;
  if (issues.some((issue) => issue.id === selectedIssueId))
    return selectedIssueId;
  if (issues.some((issue) => issue.id === initialIssueId))
    return initialIssueId;
  return issues[0]?.id ?? null;
}
