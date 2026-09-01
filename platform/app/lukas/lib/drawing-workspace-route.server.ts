import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  loadDrawingRoom,
  type DrawingClient,
} from "~/lukas/lib/drawing-collaboration.server";
import {
  DrawingWorkspaceConflictError,
  DrawingWorkspaceRejectedError,
  DrawingWorkspaceRetryableError,
  DrawingWorkspaceRpcError,
  type DrawingWorkspaceCapability,
  type DrawingWorkspaceClient as DrawingWorkspaceDatabaseClient,
  loadDrawingWorkspace,
} from "~/lukas/lib/drawing-workspace.server";

const drawingEstimateUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canEdit(capability: DrawingWorkspaceCapability) {
  return capability === "admin" || capability === "editor";
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
  loadFileRoom: typeof loadDrawingRoom = loadDrawingRoom,
) {
  if (workspace.primarySource)
    return loadFileRoom(client, projectId, workspace.primarySource.id);
  const issues = workspace.document?.revision.issues ?? [];
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

export async function drawingEstimateBindingErrorResponse(error: unknown) {
  if (error instanceof Response)
    return {
      status: error.status,
      error: (await error.text()) || "견적 연결 요청이 올바르지 않습니다.",
    };
  if (
    error instanceof DrawingWorkspaceConflictError ||
    (error instanceof Error && error.name === "DrawingWorkspaceConflictError")
  )
    return {
      status: 409,
      error: "현재 도면 개정 또는 BOQ 버전에 이미 견적이 연결되어 있습니다.",
    };
  if (error instanceof DrawingWorkspaceRejectedError)
    return { status: 400, error: error.message };
  return {
    status: error instanceof DrawingWorkspaceRpcError ? 503 : 400,
    error: "견적 연결을 저장하지 못했습니다.",
  };
}
