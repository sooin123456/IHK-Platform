import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  loadDrawingRoom,
  type DrawingClient,
} from "~/lukas/lib/drawing-collaboration.server";
import type {
  DrawingRevisionReviewItem,
  RelinkDrawingAnchorInput,
} from "~/lukas/lib/drawing-revision.server";
import { loadDrawingRevisionReviewCandidate } from "~/lukas/lib/drawing-revision.server";
import {
  DrawingWorkspaceConflictError,
  DrawingWorkspaceRejectedError,
  DrawingWorkspaceRetryableError,
  DrawingWorkspaceRpcError,
  DrawingWorkspaceSourceUnavailableError,
  type DrawingWorkspaceCapability,
  type DrawingWorkspace,
  type DrawingWorkspaceClient as DrawingWorkspaceDatabaseClient,
  type DrawingWorkspaceSourceBundle,
  loadDrawingWorkspace,
} from "~/lukas/lib/drawing-workspace.server";
import { drawingWorkspaceCanComment } from "~/lukas/lib/drawing-workspace-view";

const drawingEstimateUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DrawingWorkspaceSourceAttachFormSchema = z
  .object({
    intent: z.literal("attach_source"),
    revision_id: z.string().uuid(),
    canvas_id: z.string().uuid(),
    source_file_id: z.string().uuid(),
    request_id: z.string().uuid(),
  })
  .strict();

function canEdit(capability: DrawingWorkspaceCapability) {
  return capability === "admin" || capability === "editor";
}

export function assertDrawingWorkspaceRevisionRelinkScope({
  capability,
  mutation,
  revisionReview,
  workspace,
}: {
  capability: DrawingWorkspaceCapability;
  mutation: RelinkDrawingAnchorInput;
  revisionReview: DrawingRevisionReviewItem[];
  workspace: Pick<DrawingWorkspace, "primarySource">;
}) {
  assertDrawingWorkspaceRevisionRelinkRequestScope({
    capability,
    mutation,
    workspace,
  });
  const candidate = revisionReview.find(
    (item) => item.previousAnchorId === mutation.previousAnchorId,
  );
  if (!candidate || candidate.sourceKind !== mutation.anchor.kind)
    throw new Response("현재 작업실의 개정 검토 후보만 연결할 수 있습니다.", {
      status: 409,
    });
  return candidate;
}

export function assertDrawingWorkspaceRevisionRelinkRequestScope({
  capability,
  mutation,
  workspace,
}: {
  capability: DrawingWorkspaceCapability;
  mutation: RelinkDrawingAnchorInput;
  workspace: Pick<DrawingWorkspace, "primarySource">;
}) {
  if (!drawingWorkspaceCanComment(capability))
    throw new Response("도면 근거를 다시 연결할 권한이 없습니다.", {
      status: 403,
    });
  const source = workspace.primarySource;
  const expectedKind =
    source?.kind === "pdf"
      ? "pdf_region"
      : source?.kind === "ifc"
        ? "ifc_element"
        : null;
  if (
    !source ||
    source.id !== mutation.currentFileId ||
    mutation.anchor.fileId !== source.id ||
    mutation.anchor.kind !== expectedKind
  )
    throw new Response("현재 작업실의 개정 검토 후보만 연결할 수 있습니다.", {
      status: 409,
    });
  return source;
}

export async function assertDrawingWorkspaceRevisionRelinkAuthority({
  baseClient,
  capability,
  mutation,
  projectId,
  workspace,
}: {
  baseClient: DrawingClient;
  capability: DrawingWorkspaceCapability;
  mutation: RelinkDrawingAnchorInput;
  projectId: string;
  workspace: Pick<DrawingWorkspace, "primarySource">;
}) {
  assertDrawingWorkspaceRevisionRelinkRequestScope({
    capability,
    mutation,
    workspace,
  });
  const candidate = await loadDrawingRevisionReviewCandidate(
    baseClient,
    projectId,
    mutation.currentFileId,
    mutation.previousAnchorId,
  );
  if (!candidate || candidate.sourceKind !== mutation.anchor.kind)
    throw new Response("현재 작업실의 개정 검토 후보만 연결할 수 있습니다.", {
      status: 409,
    });
  return candidate;
}

export function parseDrawingWorkspaceLineageSearch(
  searchParams: URLSearchParams,
) {
  try {
    const one = (name: string) => {
      const values = searchParams.getAll(name);
      if (values.length > 1) throw new Error("duplicate URL value");
      return values[0] ?? null;
    };
    const revision = one("revision");
    const object = one("object");
    const boq = one("boq");
    const line = one("line");
    const evidence = one("evidence");
    const cursor = one("quantityCursor");
    if (cursor && !object) throw new Error("orphan cursor");
    if ((boq || line || evidence) && !(revision && object && boq && line))
      throw new Error("incomplete BOQ evidence");
    return {
      revisionId: revision ? z.string().uuid().parse(revision) : null,
      objectId: object ? z.string().uuid().parse(object) : null,
      boqVersionId: boq ? z.string().uuid().parse(boq) : null,
      boqLineId: line ? z.string().uuid().parse(line) : null,
      evidenceFileId: evidence ? z.string().uuid().parse(evidence) : null,
      cursor,
    };
  } catch {
    throw new Error("도면 수량 근거 URL이 올바르지 않습니다.");
  }
}

export function actionRequestId(form: FormData) {
  for (const name of [
    "request_id",
    "client_request_id",
    "link_id",
    "comment_id",
    "freeze_request_id",
    "new_anchor_id",
  ]) {
    const value = form.get(name);
    if (typeof value === "string" && drawingEstimateUuid.test(value))
      return value;
  }
  const operation = form.get("operation_json");
  if (typeof operation === "string")
    try {
      const clientOperationId = JSON.parse(operation).clientOperationId;
      if (
        typeof clientOperationId === "string" &&
        drawingEstimateUuid.test(clientOperationId)
      )
        return clientOperationId;
    } catch {
      // Validation will return the field-level error below.
    }
  return randomUUID();
}

export function parseDrawingWorkspaceSourceAttachForm(form: FormData) {
  for (const name of [
    "intent",
    "revision_id",
    "canvas_id",
    "source_file_id",
    "request_id",
  ])
    if (form.getAll(name).length !== 1)
      throw new z.ZodError([
        { code: "custom", path: [name], message: "Expected one value" },
      ]);
  const parsed = DrawingWorkspaceSourceAttachFormSchema.parse(
    Object.fromEntries(form.entries()),
  );
  return {
    revisionId: parsed.revision_id,
    canvasId: parsed.canvas_id,
    sourceFileId: parsed.source_file_id,
    requestId: parsed.request_id,
  };
}

export function drawingWorkspaceSourceAttachCanvasId(
  workspace: DrawingWorkspace,
): string | null {
  const firstPage = workspace.document.revision.pages[0];
  if (!firstPage || !("canvases" in firstPage)) return null;
  const paper = [...firstPage.canvases]
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
    )
    .find((canvas) => canvas.spaceKind === "paper");
  return paper?.background === null ? paper.id : null;
}

export function recoverDrawingWorkspaceSourceFailure(
  error: unknown,
  selectedIfcFileId: string | null,
  loadSelectedIfc = true,
): {
  sourceBundle: DrawingWorkspaceSourceBundle & { error: string };
  selectedIfcFileId: string | null;
} | null {
  if (
    !(error instanceof DrawingWorkspaceSourceUnavailableError) &&
    !(
      error instanceof Error &&
      error.name === "DrawingWorkspaceSourceUnavailableError"
    )
  )
    return null;
  const recoveryBundle = (
    error as Error & {
      recoveryBundle?: DrawingWorkspaceSourceBundle | null;
    }
  ).recoveryBundle ?? {
    primary: null,
    pdf: null,
    ifc: null,
    previousPdf: null,
    revisionEdge: null,
    catalog: [],
  };
  const unavailableIfc =
    loadSelectedIfc &&
    selectedIfcFileId !== null &&
    recoveryBundle.ifc?.id !== selectedIfcFileId;
  return {
    sourceBundle: {
      ...recoveryBundle,
      error: unavailableIfc
        ? "선택한 IFC 원본을 표시하지 못했습니다. 다시 시도해 주세요."
        : "PDF 원본 배경을 표시하지 못했습니다. 다시 시도해 주세요.",
    },
    selectedIfcFileId: unavailableIfc ? null : selectedIfcFileId,
  };
}

export function assertDrawingWorkspaceSourceAttachScope({
  capability,
  mutation,
  workspace,
}: {
  capability: DrawingWorkspaceCapability;
  mutation: ReturnType<typeof parseDrawingWorkspaceSourceAttachForm>;
  workspace: DrawingWorkspace;
}) {
  if (!canEdit(capability))
    throw new Response("도면 원본을 연결할 권한이 없습니다.", {
      status: 403,
    });
  if (
    workspace.primarySource !== null ||
    workspace.document.source_file_id !== null ||
    workspace.document.source_sha256 !== null
  )
    throw new Response("이미 원본이 연결된 작업실입니다.", { status: 409 });
  if (
    workspace.document.revision.status !== "draft" ||
    workspace.document.revision.id !== mutation.revisionId
  )
    throw new Response("현재 초안에만 원본을 연결할 수 있습니다.", {
      status: 409,
    });
  const canvasId = drawingWorkspaceSourceAttachCanvasId(workspace);
  if (!canvasId || canvasId !== mutation.canvasId)
    throw new Response("PDF를 연결할 기본 종이 캔버스가 없습니다.", {
      status: 409,
    });
  return mutation;
}

function isDrawingWorkspaceRetryableRead(error: unknown) {
  return (
    error instanceof DrawingWorkspaceRetryableError ||
    (error instanceof Error &&
      error.name === "DrawingWorkspaceRetryableError" &&
      (error as { kind?: unknown }).kind === "retryable")
  );
}

function isDrawingWorkspaceConflict(error: unknown) {
  return (
    error instanceof DrawingWorkspaceConflictError ||
    (error instanceof Error &&
      error.name === "DrawingWorkspaceConflictError" &&
      (error as { kind?: unknown }).kind === "conflict")
  );
}

export async function retryDrawingWorkspaceLoaderSnapshot<T>(
  load: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      if (isDrawingWorkspaceConflict(error))
        throw new Response("연결된 도면 근거를 열 수 없습니다.", {
          status: 404,
        });
      if (!isDrawingWorkspaceRetryableRead(error)) throw error;
      if (attempt === 1)
        throw new Response(
          "작업실이 변경 중입니다. 잠시 후 다시 열어 주세요.",
          {
            status: 503,
            headers: { "Retry-After": "1" },
          },
        );
    }
  }
  throw new Error("Drawing workspace loader retry is unreachable.");
}

function rejectedRecovery(message: string) {
  if (/승인|approved/i.test(message))
    return "승인된 개정은 변경할 수 없습니다. 새 개정을 만들어 주세요.";
  return /권한/.test(message)
    ? "이 작업을 수행할 권한이 없습니다."
    : "현재 개정 상태에서는 이 작업을 수행할 수 없습니다.";
}

export async function drawingWorkspaceActionErrorResponse(
  error: unknown,
  options: { requestId: string },
) {
  const requestId = options.requestId;
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const field = String(issue.path[0] ?? "form");
      fieldErrors[field] = ["입력값이 올바르지 않습니다."];
    }
    return {
      status: 400,
      body: {
        ok: false as const,
        kind: "validation" as const,
        error: "입력값을 확인해 주세요.",
        fieldErrors,
        requestId,
      },
    };
  }
  if (error instanceof Response) {
    const message = await error.text();
    if (error.status === 400)
      return {
        status: 400,
        body: {
          ok: false as const,
          kind: "validation" as const,
          error: message || "입력값을 확인해 주세요.",
          requestId,
        },
      };
    if (error.status === 403)
      return {
        status: 403,
        body: {
          ok: false as const,
          kind: "rejected" as const,
          error: message || "이 작업을 수행할 권한이 없습니다.",
          requestId,
        },
      };
    if (error.status === 404)
      return {
        status: 409,
        body: {
          ok: false as const,
          kind: "rejected" as const,
          error: "현재 개정 상태에서는 이 작업을 수행할 수 없습니다.",
          requestId,
        },
      };
    if (error.status === 409)
      return {
        status: 409,
        body: {
          ok: false as const,
          kind: "conflict" as const,
          error: /승인|approved/i.test(message)
            ? rejectedRecovery(message)
            : "최신 작업실을 다시 불러와 변경 내용을 비교해 주세요.",
          requestId,
        },
      };
  }
  if (
    error instanceof DrawingWorkspaceConflictError ||
    (error instanceof Error && error.name === "DrawingWorkspaceConflictError")
  )
    return {
      status: 409,
      body: {
        ok: false as const,
        kind: "conflict" as const,
        error: "최신 작업실을 다시 불러와 변경 내용을 비교해 주세요.",
        requestId,
      },
    };
  if (
    error instanceof DrawingWorkspaceRetryableError ||
    error instanceof DrawingWorkspaceRpcError ||
    (error instanceof Error &&
      (error.name === "DrawingWorkspaceRetryableError" ||
        error.name === "DrawingWorkspaceRpcError"))
  )
    return {
      status: 503,
      body: {
        ok: false as const,
        kind: "retryable" as const,
        error: "같은 요청 ID로 다시 시도해 주세요.",
        requestId,
      },
    };
  if (
    error instanceof DrawingWorkspaceRejectedError ||
    (error instanceof Error && error.name === "DrawingWorkspaceRejectedError")
  ) {
    const status = /권한/.test(error.message) ? 403 : 409;
    return {
      status,
      body: {
        ok: false as const,
        kind: "rejected" as const,
        error: rejectedRecovery(error.message),
        requestId,
      },
    };
  }
  console.error("Drawing workspace action failed", { requestId, error });
  return {
    status: 500,
    body: {
      ok: false as const,
      kind: "unknown" as const,
      error: `요청을 처리하지 못했습니다. 요청 ID: ${requestId}`,
      requestId,
    },
  };
}

export async function loadDrawingWorkspaceActionScope<T>(
  load: () => Promise<T>,
  requestId: string,
) {
  try {
    return { ok: true as const, workspace: await load() };
  } catch (error) {
    return {
      ok: false as const,
      failure: await drawingWorkspaceActionErrorResponse(error, { requestId }),
    };
  }
}

function objectIssueScopeQueryError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : null;
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : "도면 객체 범위를 확인하지 못했습니다.";
  if (
    code === "40001" ||
    code === "40P01" ||
    code === "PGRST000" ||
    code === "PGRST001" ||
    code === "PGRST002"
  )
    return new DrawingWorkspaceRetryableError(message);
  return new Error(message);
}

export async function assertDrawingObjectIssueScope(
  client: DrawingWorkspaceDatabaseClient,
  input: {
    projectId: string;
    documentId: string;
    revisionId: string;
    objectId: string;
  },
) {
  const ids = z
    .object({
      projectId: z.string().uuid(),
      documentId: z.string().uuid(),
      revisionId: z.string().uuid(),
      objectId: z.string().uuid(),
    })
    .parse(input);
  const { data: object, error: objectError } = await client
    .from("lukas_drawing_objects")
    .select("id,revision_id,project_id")
    .eq("id", ids.objectId)
    .eq("revision_id", ids.revisionId)
    .eq("project_id", ids.projectId)
    .maybeSingle();
  if (objectError) throw objectIssueScopeQueryError(objectError);
  const { data: revision, error: revisionError } = object
    ? await client
        .from("lukas_drawing_revisions")
        .select("id,document_id,project_id")
        .eq("id", ids.revisionId)
        .eq("document_id", ids.documentId)
        .eq("project_id", ids.projectId)
        .maybeSingle()
    : { data: null, error: null };
  if (revisionError) throw objectIssueScopeQueryError(revisionError);
  const { data: document, error: documentError } = revision
    ? await client
        .from("lukas_drawing_documents")
        .select("id,project_id")
        .eq("id", ids.documentId)
        .eq("project_id", ids.projectId)
        .maybeSingle()
    : { data: null, error: null };
  if (documentError) throw objectIssueScopeQueryError(documentError);
  if (!object || !revision || !document)
    throw new Response("연결할 도면 객체를 찾을 수 없습니다.", {
      status: 404,
    });
}

export async function loadDrawingWorkspaceIssueRoom(
  client: DrawingClient,
  projectId: string,
  workspace: Awaited<ReturnType<typeof loadDrawingWorkspace>>,
  options: { focusIssueIds?: readonly string[] } = {},
  loadFileRoom: typeof loadDrawingRoom = loadDrawingRoom,
) {
  if (workspace.primarySource)
    return loadFileRoom(client, projectId, workspace.primarySource.id, options);
  const issues = workspace.document.revision.issues;
  const issueIds = issues.map((issue) => issue.id);
  if (issueIds.length === 0)
    return {
      issues: [],
      anchors: [],
      comments: [],
      mentions: [],
      canvasRegionAnchors: [],
    };
  const [commentsResult, regionsResult] = await Promise.all([
    client
      .from("lukas_drawing_issue_comments")
      .select("*")
      .eq("project_id", projectId)
      .in("issue_id", issueIds)
      .order("created_at"),
    client
      .from("lukas_drawing_canvas_region_anchors")
      .select("*")
      .eq("project_id", projectId)
      .in("issue_id", issueIds)
      .order("created_at"),
  ]);
  const comments = commentsResult.data ?? [];
  const commentIds = comments.map((comment) => comment.id);
  const mentionsResult = commentIds.length
    ? await client
        .from("lukas_drawing_comment_mentions")
        .select("*")
        .eq("project_id", projectId)
        .in("comment_id", commentIds)
        .order("created_at")
    : { data: [], error: null };
  const error =
    commentsResult.error ?? regionsResult.error ?? mentionsResult.error;
  if (error) throw new Error("도면 이슈 내용을 불러오지 못했습니다.");
  return {
    issues,
    anchors: [],
    comments,
    mentions: mentionsResult.data ?? [],
    canvasRegionAnchors: regionsResult.data ?? [],
  };
}

export function parseDrawingEstimateBindingRoute(
  workspaceId: string | undefined,
  revisionId: string | null,
) {
  if (
    !workspaceId ||
    !drawingEstimateUuid.test(workspaceId) ||
    (revisionId !== null && !drawingEstimateUuid.test(revisionId))
  )
    throw new Response("견적 연결 경로 식별자가 올바르지 않습니다.", {
      status: 400,
    });
  return { workspaceId, revisionId: revisionId ?? undefined };
}

export function parseDrawingEstimateBindingForm(
  form: FormData,
  scope: {
    capability: DrawingWorkspaceCapability;
    projectId: string;
    revisionId: string;
    revisionStatus: string;
  },
) {
  if (form.get("intent") !== "bind_drawing_estimate")
    throw new Response("지원하지 않는 견적 연결 작업입니다.", { status: 400 });
  if (!canEdit(scope.capability))
    throw new Response("견적 연결에는 도면 편집 권한이 필요합니다.", {
      status: 403,
    });
  const drawingRevisionId = String(form.get("drawing_revision_id") ?? "");
  const boqVersionId = String(form.get("boq_version_id") ?? "");
  if (
    !drawingEstimateUuid.test(scope.projectId) ||
    !drawingEstimateUuid.test(drawingRevisionId) ||
    !drawingEstimateUuid.test(boqVersionId)
  )
    throw new Response("견적 연결 식별자가 올바르지 않습니다.", {
      status: 400,
    });
  if (
    scope.revisionStatus !== "draft" ||
    drawingRevisionId !== scope.revisionId
  )
    throw new Response("현재 draft 도면 개정만 견적에 연결할 수 있습니다.", {
      status: 409,
    });
  return {
    projectId: scope.projectId,
    drawingRevisionId,
    boqVersionId,
  };
}
