import type { DrawingWorkspaceCapability } from "./drawing-workspace.server.ts";
import { containPdfSource } from "./drawing-geometry.ts";
import {
  pdfNormalizedRegionToWorldBounds,
  type DrawingPdfPageTransform,
} from "./drawing-pdf-transform.ts";
import {
  DrawingObjectSourceSchema,
  type DrawingObjectSource,
} from "./drawing-workspace.types.ts";

type RevisionStatus =
  | "draft"
  | "review_requested"
  | "reviewed"
  | "approved"
  | "superseded";

export type DrawingWorkspaceViewMode = "2d" | "3d" | "split";

export function drawingWorkspaceEvidenceFocusKey(input: {
  boqVersionId: string | null;
  boqLineId: string | null;
  evidenceFileId: string | null;
  objectId: string | null;
  revisionId: string | null;
}) {
  const values = [
    input.revisionId,
    input.objectId,
    input.boqVersionId,
    input.boqLineId,
    input.evidenceFileId,
  ];
  return values.every((value): value is string => Boolean(value))
    ? values.join(":")
    : null;
}

export function drawingWorkspaceEvidenceFocusBounds(input: {
  evidence: DrawingObjectSource;
  objectBounds: { x: number; y: number; width: number; height: number };
  pdfPageTransform: DrawingPdfPageTransform | null;
}) {
  if (input.evidence.sourceKind !== "pdf_region") return input.objectBounds;
  if (
    !input.pdfPageTransform ||
    input.pdfPageTransform.pageNumber !== input.evidence.pdfPageNumber
  )
    return null;
  return pdfNormalizedRegionToWorldBounds(input.pdfPageTransform, {
    x: input.evidence.x,
    y: input.evidence.y,
    width: input.evidence.width,
    height: input.evidence.height,
  });
}

export function drawingWorkspaceObjectFocusViewport(input: {
  bounds: { x: number; y: number; width: number; height: number };
  canvasId: string;
  pageId: string;
  viewportSize: { width: number; height: number };
}) {
  const values = [
    input.bounds.x,
    input.bounds.y,
    input.bounds.width,
    input.bounds.height,
    input.viewportSize.width,
    input.viewportSize.height,
  ];
  if (
    values.some((value) => !Number.isFinite(value)) ||
    input.bounds.width < 0 ||
    input.bounds.height < 0 ||
    input.viewportSize.width <= 0 ||
    input.viewportSize.height <= 0
  )
    throw new Error("도면 객체 화면 맞춤 값이 올바르지 않습니다.");
  const padding = 48;
  const availableWidth = Math.max(1, input.viewportSize.width - padding * 2);
  const availableHeight = Math.max(1, input.viewportSize.height - padding * 2);
  const zoom = Math.min(
    4,
    Math.max(
      0.05,
      Math.min(
        availableWidth / Math.max(1, input.bounds.width),
        availableHeight / Math.max(1, input.bounds.height),
      ),
    ),
  );
  const centerX = input.bounds.x + input.bounds.width / 2;
  const centerY = input.bounds.y + input.bounds.height / 2;
  return {
    activeCanvasId: input.canvasId,
    activePageId: input.pageId,
    viewport: {
      x: input.viewportSize.width / 2 - centerX * zoom,
      y: input.viewportSize.height / 2 - centerY * zoom,
      zoom,
    },
  };
}

export function parseDrawingWorkspaceViewState(search: URLSearchParams): {
  view: DrawingWorkspaceViewMode;
  ifcFileId: string | null;
} {
  const views = search.getAll("view");
  const ifcFiles = search.getAll("ifc");
  const view = views.length === 0 ? "2d" : views[0];
  if (views.length > 1 || (view !== "2d" && view !== "3d" && view !== "split"))
    throw new Error("작업실 보기 값이 올바르지 않습니다.");
  if (
    ifcFiles.length > 1 ||
    (ifcFiles[0] !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        ifcFiles[0],
      ))
  )
    throw new Error("IFC 파일 선택 값이 올바르지 않습니다.");
  return { view, ifcFileId: ifcFiles[0] ?? null };
}

export function drawingIfcFocusTarget(input: {
  selectedIds: readonly string[];
  sources: Readonly<Record<string, DrawingObjectSource>>;
  sourceFileId: string;
  sourceSha256: string;
}) {
  if (input.selectedIds.length !== 1) return null;
  const source = Object.values(input.sources).find((candidate) => {
    const parsed = DrawingObjectSourceSchema.parse(candidate);
    return (
      parsed.sourceKind === "ifc_element" &&
      parsed.objectId === input.selectedIds[0] &&
      parsed.sourceFileId === input.sourceFileId &&
      parsed.sourceSha256 === input.sourceSha256
    );
  });
  if (!source || source.sourceKind !== "ifc_element") return null;
  return {
    ifcGlobalId: source.ifcGlobalId,
    elementId: source.elementId,
    camera: source.camera,
  };
}

export function drawingIfcRemoteHighlightGlobalIds(input: {
  peers: readonly { selectedIds: readonly string[] }[];
  sources: Readonly<Record<string, DrawingObjectSource>>;
  sourceFileId: string;
  sourceSha256: string;
}) {
  const selected = new Set(input.peers.flatMap((peer) => peer.selectedIds));
  return [
    ...new Set(
      Object.values(input.sources).flatMap((candidate) => {
        const source = DrawingObjectSourceSchema.parse(candidate);
        return source.sourceKind === "ifc_element" &&
          selected.has(source.objectId) &&
          source.sourceFileId === input.sourceFileId &&
          source.sourceSha256 === input.sourceSha256
          ? [source.ifcGlobalId]
          : [];
      }),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

export type DrawingReviewEvidence = {
  subjectVersion: number;
  snapshotSha256: string;
};

export type DrawingClientModuleState<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "error"; message: string };

export function loadDrawingClientModule<T>(input: {
  load: () => Promise<T>;
  errorMessage: string;
  onState: (state: DrawingClientModuleState<T>) => void;
}) {
  let disposed = false;
  input.onState({ status: "loading" });
  let loading: Promise<T>;
  try {
    loading = input.load();
  } catch {
    if (!disposed)
      input.onState({ status: "error", message: input.errorMessage });
    return () => {
      disposed = true;
    };
  }
  void loading.then(
    (value) => {
      if (!disposed) input.onState({ status: "ready", value });
    },
    () => {
      if (!disposed)
        input.onState({ status: "error", message: input.errorMessage });
    },
  );
  return () => {
    disposed = true;
  };
}

export function drawingPdfImagePlacement(
  source: { width: number; height: number },
  page: { width: number; height: number },
) {
  return containPdfSource(source, {
    x: 0,
    y: 0,
    width: page.width,
    height: page.height,
  });
}

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
    ((input.capability === "reviewer" && input.status === "review_requested") ||
      (input.capability === "approver" && input.status === "reviewed")) &&
    input.createdBy !== input.currentUserId &&
    evidence?.subjectVersion === input.revisionVersion &&
    /^[0-9a-f]{64}$/.test(evidence.snapshotSha256)
      ? evidence
      : null;
  return { requestReview, decisionEvidence };
}

export function drawingIssueLinkReady(input: {
  capability: DrawingWorkspaceCapability;
  objectIds: string[];
  saveStatus: "저장됨" | "저장 중" | "오프라인 저장" | "충돌 검토 필요";
  selectedIds: string[];
  status: RevisionStatus;
}) {
  return (
    (input.capability === "admin" || input.capability === "editor") &&
    input.status === "draft" &&
    input.saveStatus === "저장됨" &&
    input.selectedIds.length === 1 &&
    input.objectIds.includes(input.selectedIds[0])
  );
}

export function drawingRevisionDecisionFields(input: {
  decision: "reviewed" | "approved" | "rejected";
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
    kind: "pdf" | "ifc";
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
  if (input.file.kind === "ifc")
    return {
      layout: "canvas" as const,
      background: blank,
      ifcViewer: null,
      sourceError: null,
    };
  if (input.page && input.page.backgroundPdfPage !== null) {
    return {
      layout: "canvas" as const,
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
  return {
    layout: "canvas" as const,
    background: blank,
    ifcViewer: null,
    sourceError: null,
  };
}
