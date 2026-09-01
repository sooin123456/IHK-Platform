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
    : drawingWorkspaceOperationPath(projectId, workspaceId);
}

export function drawingWorkspaceExportPath(
  projectId: string,
  workspaceId: string,
) {
  return `${drawingWorkspacePath(projectId, workspaceId)}/export`;
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

export function legacyProjectWorkspacePath(projectId: string) {
  return `/projects/${Uuid.parse(projectId)}/workspace`;
}
