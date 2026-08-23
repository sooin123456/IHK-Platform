export const drawingIssueStatuses = [
  "open",
  "in_progress",
  "resolution_requested",
  "closed",
] as const;

export type DrawingIssueStatus = (typeof drawingIssueStatuses)[number];
export type DrawingProjectRole =
  | "owner"
  | "staff"
  | "reviewer"
  | "estimator"
  | "site"
  | "procurement"
  | "viewer";

const reviewTransitions = new Set([
  "open:in_progress",
  "in_progress:resolution_requested",
  "resolution_requested:in_progress",
  "closed:open",
]);
const workerTransitions = new Set([
  "open:in_progress",
  "in_progress:resolution_requested",
]);

export function canAssignDrawingIssue(role: DrawingProjectRole): boolean {
  return role === "owner" || role === "staff" || role === "reviewer";
}

export function canRecordDrawingApproval(
  role: DrawingProjectRole,
  actorId: string,
  issueCreatorId: string,
  status: DrawingIssueStatus,
): boolean {
  return (
    canAssignDrawingIssue(role) &&
    actorId !== issueCreatorId &&
    status === "resolution_requested"
  );
}

export function canTransitionDrawingIssue(
  role: DrawingProjectRole,
  from: DrawingIssueStatus,
  to: DrawingIssueStatus,
): boolean {
  if (from === to) return true;
  const transition = `${from}:${to}`;
  if (role === "owner" || role === "staff" || role === "reviewer")
    return reviewTransitions.has(transition);
  if (role === "estimator" || role === "site" || role === "procurement")
    return workerTransitions.has(transition);
  return false;
}

export type PdfRegion = {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function validatePdfRegion(region: PdfRegion): boolean {
  const values = [region.x, region.y, region.width, region.height];
  return (
    Number.isInteger(region.pageNumber) &&
    region.pageNumber > 0 &&
    values.every(Number.isFinite) &&
    region.x >= 0 &&
    region.y >= 0 &&
    region.width > 0 &&
    region.height > 0 &&
    region.x + region.width <= 1 &&
    region.y + region.height <= 1
  );
}
