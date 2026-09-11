import { z } from "zod";

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export function drawingWorkspacePath(projectId: string, workspaceId: string) {
  return `/projects/${Uuid.parse(projectId)}/workspaces/${Uuid.parse(workspaceId)}`;
}

export function drawingWorkspaceNewPath(
  projectId: string,
  sourceFileId?: string,
) {
  const base = `/projects/${Uuid.parse(projectId)}/workspaces/new`;
  return sourceFileId
    ? `${base}?sourceFileId=${encodeURIComponent(Uuid.parse(sourceFileId))}`
    : base;
}

export function drawingWorkspaceOperationLocation({
  previewMode,
  projectId,
  workspaceId,
}: {
  previewMode: boolean;
  projectId: string;
  workspaceId: string;
}) {
  return previewMode
    ? "/workspace-preview/drawing-workspace/operation"
    : `${drawingWorkspacePath(projectId, workspaceId)}/operation`;
}

export function drawingWorkspaceExportPath(
  projectId: string,
  workspaceId: string,
) {
  return `${drawingWorkspacePath(projectId, workspaceId)}/export`;
}

export function drawingNativeDwgExportPath(
  projectId: string,
  workspaceId: string,
) {
  return `${drawingWorkspacePath(projectId, workspaceId)}/native-dwg`;
}

export function drawingNativeDwgDownloadPath(
  projectId: string,
  workspaceId: string,
  jobId: string,
  kind: "dwg" | "source_manifest" | "authority" | "report",
) {
  return `${drawingNativeDwgExportPath(projectId, workspaceId)}/${Uuid.parse(jobId)}/download/${kind}`;
}

export function drawingNativeDwgResavePath(
  projectId: string,
  documentId: string,
) {
  return `${drawingWorkspacePath(Uuid.parse(projectId).toLowerCase(), Uuid.parse(documentId).toLowerCase())}/native-dwg-resave`;
}

export function drawingNativeDwgResaveDownloadPath(
  projectId: string,
  documentId: string,
  jobId: string,
  kind: "dwg" | "edit_request" | "authority" | "report",
) {
  return `${drawingNativeDwgResavePath(projectId, documentId)}/${Uuid.parse(jobId).toLowerCase()}/download/${z.enum(["dwg", "edit_request", "authority", "report"]).parse(kind)}`;
}

export function drawingWorkspaceMeasurementEvidencePath({
  projectId,
  workspaceId,
  revisionId,
  revisionVersion,
  snapshotSha256,
  operationCheckpoint,
}: {
  projectId: string;
  workspaceId: string;
  revisionId: string;
  revisionVersion: number;
  snapshotSha256: string;
  operationCheckpoint: number;
}) {
  const search = new URLSearchParams({
    revision: Uuid.parse(revisionId),
    version: String(z.number().int().positive().parse(revisionVersion)),
    sha256: Sha256.parse(snapshotSha256),
    operation: String(
      z.number().int().nonnegative().parse(operationCheckpoint),
    ),
  });
  return `${drawingWorkspacePath(projectId, workspaceId)}/measurement-evidence?${search}`;
}

export function drawingWorkspaceQuantityLineagePath(
  projectId: string,
  workspaceId: string,
) {
  return `${drawingWorkspacePath(projectId, workspaceId)}/quantity-lineage`;
}

export function drawingWorkspaceBoqReturnLocation(
  projectId: string,
  boqVersionId: string,
  boqLineId: string,
) {
  const search = new URLSearchParams({
    version: Uuid.parse(boqVersionId),
    line: Uuid.parse(boqLineId),
  });
  return `/projects/${Uuid.parse(projectId)}/boq?${search}`;
}

export function legacyDrawingWorkspacePath(projectId: string, fileId: string) {
  return `/projects/${Uuid.parse(projectId)}/drawings/${Uuid.parse(fileId)}/workspace`;
}
