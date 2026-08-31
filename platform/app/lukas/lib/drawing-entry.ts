import { drawingWorkspaceNewPath } from "./drawing-workspace-paths.ts";

export const projectFileKinds = [
  "ifc",
  "pdf",
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

export function fileMatchesProjectKind(
  kind: ProjectFileKind,
  filename: string,
) {
  const lower = filename.trim().toLowerCase();
  if (kind === "other") return true;
  if (kind === "ifc") return lower.endsWith(".ifc");
  if (kind === "pdf") return lower.endsWith(".pdf");
  if (kind === "estimate")
    return [".csv", ".xls", ".xlsx"].some((extension) =>
      lower.endsWith(extension),
    );
  return lower.endsWith(".csv");
}

export function drawingWorkspacePath(projectId: string, fileId: string) {
  return `/projects/${projectId}/drawings/${fileId}/workspace`;
}

export function drawingProjectWorkspacePath(projectId: string) {
  return `/projects/${projectId}/workspace`;
}

export function drawingUploadPath(projectId: string) {
  return `/projects/${projectId}/files?kind=pdf#upload`;
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

export function canRegisterOfficialArtifacts(
  role: string | null | undefined,
) {
  return (
    role === "owner" || role === "staff" || role === "estimator"
  );
}

export function projectUploadDestination({
  fileId,
  kind,
  projectId,
  returnPath,
}: {
  fileId: string;
  kind: ProjectFileKind;
  projectId: string;
  returnPath: string;
}) {
  if (kind === "pdf") return drawingWorkspaceNewPath(projectId, fileId);
  return kind === "ifc" ? drawingWorkspacePath(projectId, fileId) : returnPath;
}
