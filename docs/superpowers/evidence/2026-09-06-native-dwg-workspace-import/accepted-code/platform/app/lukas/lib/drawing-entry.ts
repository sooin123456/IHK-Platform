import { z } from "zod";

import {
  drawingWorkspaceNewPath,
  drawingWorkspacePath,
} from "./drawing-workspace-paths.ts";

const Uuid = z.string().uuid();

export const projectFileKinds = [
  "ifc",
  "pdf",
  "dxf",
  "dwg",
  "qto_csv",
  "element_ledger",
  "formwork_ledger",
  "estimate",
  "mapping",
  "other",
] as const;

export type ProjectFileKind = (typeof projectFileKinds)[number];

export const projectFileKindPolicy: Record<
  ProjectFileKind,
  { label: string; help: string; accept: string | undefined }
> = {
  ifc: {
    label: "IFC 모델",
    help: "Revit에서 내보낸 .ifc 모델",
    accept: ".ifc,application/octet-stream",
  },
  pdf: {
    label: "PDF 도면",
    help: "페이지 단위로 확인하고 작업할 .pdf 도면",
    accept: ".pdf,application/pdf",
  },
  dxf: {
    label: "DXF 도면",
    help: "DXF 도면 가져오기에 사용할 .dxf 원본",
    accept:
      ".dxf,application/dxf,application/x-dxf,image/vnd.dxf,text/plain,application/octet-stream",
  },
  dwg: {
    label: "DWG 원본",
    help: ".dwg 원본을 네이티브 분석 후 편집 객체로 가져옵니다. 실험 기능이며 DWG 재저장·납품 호환성은 검증되지 않았습니다.",
    accept: ".dwg",
  },
  qto_csv: {
    label: "QTO CSV",
    help: "분류별 수량을 모은 QTO .csv",
    accept: ".csv,text/csv",
  },
  element_ledger: {
    label: "요소 원장",
    help: "객체별 수량표(element-ledger.csv)",
    accept: ".csv,text/csv",
  },
  formwork_ledger: {
    label: "거푸집 Face 원장",
    help: "거푸집 면적 검토표 .csv",
    accept: ".csv,text/csv",
  },
  estimate: {
    label: "내역서",
    help: "검토할 내역서 .csv 또는 Excel",
    accept:
      ".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  mapping: {
    label: "매핑표",
    help: "내역과 모델을 연결하는 매핑 .csv",
    accept: ".csv,text/csv",
  },
  other: {
    label: "기타",
    help: "그 밖의 계산 근거 파일",
    accept: undefined,
  },
};

const dxfContentTypes = new Set([
  "application/dxf",
  "application/x-dxf",
  "application/octet-stream",
  "image/vnd.dxf",
  "text/plain",
]);

export function projectFileKindMismatchMessage(
  kind: ProjectFileKind,
  filename: string,
) {
  return kind === "dxf" && filename.trim().toLowerCase().endsWith(".dwg")
    ? "DWG 원본은 DWG 원본 종류로 선택해 주세요."
    : null;
}

export function contentTypeMatchesProjectKind(
  kind: ProjectFileKind,
  contentType: string,
) {
  if (kind === "dwg") return contentType === "application/octet-stream";
  return (
    kind !== "dxf" || dxfContentTypes.has(contentType.trim().toLowerCase())
  );
}

export function fileMatchesProjectKind(
  kind: ProjectFileKind,
  filename: string,
) {
  const lower = filename.trim().toLowerCase();
  if (kind === "other") return true;
  if (kind === "ifc") return lower.endsWith(".ifc");
  if (kind === "pdf") return lower.endsWith(".pdf");
  if (kind === "dxf") return lower.endsWith(".dxf");
  if (kind === "dwg") return lower.endsWith(".dwg");
  if (kind === "estimate")
    return [".csv", ".xls", ".xlsx"].some((extension) =>
      lower.endsWith(extension),
    );
  return lower.endsWith(".csv");
}

export function drawingRoomPath(projectId: string, fileId: string) {
  return `/projects/${projectId}/drawings/${fileId}`;
}

export function drawingUploadPath(projectId: string) {
  return `/projects/${projectId}/files?kind=pdf#upload`;
}

export function parseDrawingWorkspaceUploadReturnTarget(
  projectId: string,
  value: string | null | undefined,
) {
  if (!value) return null;
  const match = value.match(
    /^\/projects\/([0-9a-f-]{36})\/workspaces\/([0-9a-f-]{36})$/,
  );
  try {
    const canonicalProjectId = Uuid.parse(projectId);
    if (!match || Uuid.parse(match[1]) !== canonicalProjectId) throw null;
    const workspaceId = Uuid.parse(match[2]);
    return {
      path: drawingWorkspacePath(canonicalProjectId, workspaceId),
      workspaceId,
    };
  } catch {
    throw new Error("작업실 복귀 주소가 올바르지 않습니다.");
  }
}

export function parseDrawingWorkspaceUploadReturnPath(
  projectId: string,
  value: string | null | undefined,
) {
  return (
    parseDrawingWorkspaceUploadReturnTarget(projectId, value)?.path ?? null
  );
}

export function drawingWorkspaceDxfUploadPath(
  projectId: string,
  workspaceId: string,
) {
  const canonicalProjectId = Uuid.parse(projectId);
  const search = new URLSearchParams({
    kind: "dxf",
    returnTo: drawingWorkspacePath(canonicalProjectId, workspaceId),
  });
  return `/projects/${canonicalProjectId}/files?${search}#upload`;
}

export function drawingWorkspaceDwgUploadPath(
  projectId: string,
  workspaceId: string,
) {
  const canonicalProjectId = Uuid.parse(projectId);
  const search = new URLSearchParams({
    kind: "dwg",
    returnTo: drawingWorkspacePath(canonicalProjectId, workspaceId),
  });
  return `/projects/${canonicalProjectId}/files?${search}#upload`;
}

export function drawingWorkspacePdfUploadPath(
  projectId: string,
  workspaceId: string,
) {
  const canonicalProjectId = Uuid.parse(projectId);
  const search = new URLSearchParams({
    kind: "pdf",
    returnTo: drawingWorkspacePath(canonicalProjectId, workspaceId),
  });
  return `/projects/${canonicalProjectId}/files?${search}#upload`;
}

export const officialArtifactAuthorRoles = [
  "owner",
  "staff",
  "estimator",
] as const;

export function projectActorRole({
  membershipRole,
  ownerId,
  staff,
  userId,
}: {
  membershipRole: string | null | undefined;
  ownerId: string;
  staff: boolean;
  userId: string;
}) {
  if (staff) return "staff";
  if (ownerId === userId) return "owner";
  return membershipRole ?? null;
}

export function canRegisterOfficialArtifacts(role: string | null | undefined) {
  return role === "owner" || role === "staff" || role === "estimator";
}

export function projectUploadDestination({
  fileId,
  kind,
  projectId,
  returnPath,
  returnTo,
}: {
  fileId: string;
  kind: ProjectFileKind;
  projectId: string;
  returnPath: string;
  returnTo?: string | null;
}) {
  if ((kind === "dxf" || kind === "dwg" || kind === "pdf") && returnTo) {
    const target = parseDrawingWorkspaceUploadReturnPath(projectId, returnTo);
    if (!target) throw new Error("작업실 복귀 주소가 올바르지 않습니다.");
    if (kind === "pdf") return target;
    const search = new URLSearchParams({
      [kind === "dwg" ? "dwgSourceFileId" : "dxfSourceFileId"]:
        Uuid.parse(fileId),
    });
    return `${target}?${search}`;
  }
  if (kind === "pdf" || kind === "ifc" || kind === "dxf" || kind === "dwg")
    return drawingWorkspaceNewPath(projectId, fileId);
  return returnPath;
}
