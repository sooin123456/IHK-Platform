import type { DrawingWorkspaceCapability } from "./drawing-workspace.server.ts";

type RevisionStatus = "draft" | "review_requested" | "approved" | "superseded";

export type DrawingReviewEvidence = {
  subjectVersion: number;
  snapshotSha256: string;
};

export function drawingWorkspaceReviewControls(input: {
  capability: DrawingWorkspaceCapability;
  createdBy: string;
  currentUserId: string;
  reviewEvidence: DrawingReviewEvidence | null;
  revisionId: string;
  revisionVersion: number;
  status: RevisionStatus;
}) {
  const requestReview =
    (input.capability === "admin" || input.capability === "editor") &&
    input.status === "draft";
  const evidence = input.reviewEvidence;
  const decisionEvidence =
    (input.capability === "admin" || input.capability === "reviewer") &&
    input.status === "review_requested" &&
    input.createdBy !== input.currentUserId &&
    evidence?.subjectVersion === input.revisionVersion &&
    /^[0-9a-f]{64}$/.test(evidence.snapshotSha256)
      ? evidence
      : null;
  return { requestReview, decisionEvidence };
}

export function drawingRevisionDecisionFields(input: {
  decision: "approved" | "rejected";
  evidence: DrawingReviewEvidence;
  note: string;
  revisionId: string;
}) {
  if (
    !Number.isInteger(input.evidence.subjectVersion) ||
    input.evidence.subjectVersion <= 0 ||
    !/^[0-9a-f]{64}$/.test(input.evidence.snapshotSha256)
  ) {
    throw new Error("도면 검토 근거가 올바르지 않습니다.");
  }
  return {
    intent: "record_revision_decision",
    revision_id: input.revisionId,
    subject_version: String(input.evidence.subjectVersion),
    snapshot_sha256: input.evidence.snapshotSha256,
    decision: input.decision,
    note: input.note,
  };
}

type WorkspaceSurfaceInput = {
  file: {
    id: string;
    kind: "pdf" | "ifc";
    originalFilename: string;
    byteSize: number;
  };
  page: {
    width: number;
    height: number;
    backgroundPdfPage: number | null;
  } | null;
  sourceUrl: string | null;
};

export function drawingWorkspaceSurface(input: WorkspaceSurfaceInput) {
  const blank = {
    kind: "blank" as const,
    width: input.page?.width ?? 841,
    height: input.page?.height ?? 594,
  };
  if (input.file.kind === "ifc") {
    return {
      background: blank,
      ifcViewer: input.sourceUrl
        ? {
            byteSize: input.file.byteSize,
            fileName: input.file.originalFilename,
            signedUrl: input.sourceUrl,
            sourceKey: input.file.id,
          }
        : null,
      sourceError: input.sourceUrl
        ? null
        : "IFC 원본 화면을 불러올 수 없습니다.",
    };
  }
  if (input.page && input.page.backgroundPdfPage !== null) {
    return {
      background: input.sourceUrl
        ? {
            kind: "pdf" as const,
            width: input.page.width,
            height: input.page.height,
            pageNumber: input.page.backgroundPdfPage,
            signedUrl: input.sourceUrl,
          }
        : blank,
      ifcViewer: null,
      sourceError: input.sourceUrl
        ? null
        : "PDF 원본 배경을 불러올 수 없습니다.",
    };
  }
  return { background: blank, ifcViewer: null, sourceError: null };
}
