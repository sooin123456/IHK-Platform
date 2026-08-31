import { z } from "zod";

const Uuid = z.string().uuid();

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

export function drawingWorkspaceOperationPath(
  projectId: string,
  workspaceId: string,
) {
  return `${drawingWorkspacePath(projectId, workspaceId)}/operation`;
}

export function drawingWorkspaceExportPath(
  projectId: string,
  workspaceId: string,
) {
  return `${drawingWorkspacePath(projectId, workspaceId)}/export`;
}

export function legacyDrawingWorkspacePath(projectId: string, fileId: string) {
  return `/projects/${Uuid.parse(projectId)}/drawings/${Uuid.parse(fileId)}/workspace`;
}

export function legacyProjectWorkspacePath(projectId: string) {
  return `/projects/${Uuid.parse(projectId)}/workspace`;
}
