import type { Route } from "./+types/drawing-workspace";

import { ArrowLeft } from "lucide-react";
import { randomUUID } from "node:crypto";
import { Form, Link, data, redirect } from "react-router";
import { z } from "zod";

import { DrawingTemplateDialog } from "~/lukas/components/drawing-template-dialog";
import DrawingWorkspaceClient from "~/lukas/components/drawing-workspace";
import { ProjectWorkspaceNav } from "~/lukas/components/project-workspace-nav";
import {
  drawingContext,
  listDrawingAssignees,
  loadDrawingRoom,
  mutateDrawingIssue,
  parseDrawingMutationForm,
  type DrawingClient,
} from "~/lukas/lib/drawing-collaboration.server";
import { loadDrawingActivityPage } from "~/lukas/lib/drawing-history.server";
import {
  bindDrawingEstimate,
  loadDrawingEstimateOptions,
  loadDrawingEstimateSummary,
} from "~/lukas/lib/drawing-estimate.server";
import {
  createDrawingQuantityLink,
  DrawingQuantityLineageServerError,
  drawingQuantityLineageErrorResponse,
  drawingWorkspaceEntryLocation,
  listDrawingObjectQuantityLineage,
  resolveDrawingWorkspaceEntry,
} from "~/lukas/lib/drawing-quantity-lineage.server";
import {
  assertDrawingBoqEvidenceScope,
  assertDrawingQuantityWorkspaceScope,
  DrawingWorkspaceConflictError,
  DrawingWorkspaceRejectedError,
  DrawingWorkspaceRetryableError,
  DrawingWorkspaceRpcError,
  handleWorkspaceMutation,
  loadDrawingWorkspace,
  loadDrawingWorkspaceMeasurementState,
  loadDrawingWorkspaceCapability,
  loadDrawingWorkspacePreviousPdf,
  loadDrawingWorkspaceSourceBundle,
  parseDrawingQuantityLineageSearch,
  parseDrawingQuantityLinkForm,
  parseDrawingWorkspacePreviousPdfForm,
  resolveDrawingDocumentEntry,
} from "~/lukas/lib/drawing-workspace.server";
import { parseDrawingWorkspaceViewState } from "~/lukas/lib/drawing-workspace-view";
import { drawingWorkspacePath } from "~/lukas/lib/drawing-workspace-paths";
import { assertProjectOrganizationFeature } from "~/lukas/lib/organization-administration.server";
import { startDrawingWorkspaceStage } from "~/lukas/lib/drawing-runtime";
import type {
  DrawingWorkspaceCapability,
  DrawingWorkspaceClient as DrawingWorkspaceDatabaseClient,
} from "~/lukas/lib/drawing-workspace.server";

export const meta: Route.MetaFunction = ({ data: page }) => [
  {
    title: page?.workspace?.primarySource
      ? `${page.workspace.primarySource.original_filename} | 도면 편집 작업실 | 1HK Platform`
      : "도면 편집 작업실 | 1HK Platform",
  },
];

function canEdit(capability: DrawingWorkspaceCapability) {
  return capability === "admin" || capability === "editor";
}

const drawingEstimateUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function actionRequestId(form: FormData) {
  for (const name of [
    "request_id",
    "client_request_id",
    "link_id",
    "comment_id",
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
  const { data: object } = await client
    .from("lukas_drawing_objects")
    .select("id,revision_id,project_id")
    .eq("id", ids.objectId)
    .eq("revision_id", ids.revisionId)
    .eq("project_id", ids.projectId)
    .maybeSingle();
  const { data: revision } = object
    ? await client
        .from("lukas_drawing_revisions")
        .select("id,document_id,project_id")
        .eq("id", ids.revisionId)
        .eq("document_id", ids.documentId)
        .eq("project_id", ids.projectId)
        .maybeSingle()
    : { data: null };
  const { data: document } = revision
    ? await client
        .from("lukas_drawing_documents")
        .select("id,project_id")
        .eq("id", ids.documentId)
        .eq("project_id", ids.projectId)
        .maybeSingle()
    : { data: null };
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

async function workspaceContext(request: Request, projectId: string) {
  const context = await drawingContext(request, projectId);
  const client = context.client as unknown as DrawingWorkspaceDatabaseClient;
  await assertProjectOrganizationFeature(
    client as any,
    context.project.id,
    "drawing_workspace",
  );
  const capability = await loadDrawingWorkspaceCapability(
    client,
    context.project.id,
    context.user.id,
    context.project.owner_id,
    context.role,
  );
  if (!capability)
    throw new Response("도면 작업 권한이 없습니다.", { status: 403 });
  return { ...context, client, capability };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const finishLoaderStage = startDrawingWorkspaceStage("loader");
  const { client, headers, project, user, capability } = await workspaceContext(
    request,
    params.projectId!,
  );
  const searchParams = new URL(request.url).searchParams;
  let lineageSearch;
  try {
    if (searchParams.has("evidence"))
      parseDrawingQuantityLineageSearch(searchParams);
    lineageSearch = parseDrawingWorkspaceLineageSearch(searchParams);
  } catch {
    throw new Response("도면 수량 근거 URL이 올바르지 않습니다.", {
      status: 400,
    });
  }
  if (lineageSearch.objectId || lineageSearch.boqVersionId)
    await assertProjectOrganizationFeature(
      client as any,
      project.id,
      "quantity_lineage",
    );
  if (lineageSearch.boqVersionId && lineageSearch.boqLineId) {
    try {
      const authorizedEntry = await resolveDrawingWorkspaceEntry(client, {
        projectId: project.id,
        revisionId: lineageSearch.revisionId!,
        objectId: lineageSearch.objectId!,
        boqVersionId: lineageSearch.boqVersionId,
        boqLineId: lineageSearch.boqLineId,
        fileId: lineageSearch.evidenceFileId ?? undefined,
      });
      const authorizedLocation = drawingWorkspaceEntryLocation(
        project.id,
        authorizedEntry,
      );
      const authorized = new URL(authorizedLocation, request.url);
      const current = new URL(request.url);
      if (
        authorized.pathname !== current.pathname ||
        ["revision", "object", "boq", "line", "evidence", "view", "ifc"].some(
          (name) =>
            authorized.searchParams.get(name) !== searchParams.get(name),
        )
      )
        throw new Error("evidence route mismatch");
    } catch {
      throw new Response("연결된 도면 근거를 열 수 없습니다.", {
        status: 404,
      });
    }
  }
  let viewState;
  try {
    viewState = parseDrawingWorkspaceViewState(
      new URL(request.url).searchParams,
    );
  } catch {
    throw new Response("도면 작업실 URL 상태가 올바르지 않습니다.", {
      status: 400,
    });
  }
  if (viewState.view !== "2d")
    await assertProjectOrganizationFeature(
      client as any,
      project.id,
      "ifc_workspace",
    );
  const workspace = await loadDrawingWorkspace(client, {
    projectId: project.id,
    workspaceId: params.workspaceId!,
    revisionId: lineageSearch.revisionId ?? undefined,
    focusObjectId: lineageSearch.objectId ?? undefined,
    focusEvidenceFileId: lineageSearch.evidenceFileId ?? undefined,
  });
  let estimateSummary = null;
  let estimateOptions: Awaited<ReturnType<typeof loadDrawingEstimateOptions>> =
    [];
  if (workspace.document)
    try {
      [estimateSummary, estimateOptions] = await Promise.all([
        loadDrawingEstimateSummary(client, {
          actorId: user.id,
          projectId: project.id,
          workspace,
        }),
        loadDrawingEstimateOptions(client, project.id),
      ]);
    } catch (error) {
      throw new Response(
        error instanceof DrawingWorkspaceRejectedError
          ? error.message
          : "견적 결과를 불러오지 못했습니다.",
        {
          status:
            error instanceof DrawingWorkspaceRejectedError
              ? 400
              : error instanceof DrawingWorkspaceRpcError
                ? 503
                : 500,
        },
      );
    }
  const selectedIfcFileId =
    viewState.ifcFileId ??
    (workspace.primarySource?.kind === "ifc"
      ? workspace.primarySource.id
      : null);
  let sourceBundle;
  try {
    sourceBundle = {
      ...(await loadDrawingWorkspaceSourceBundle(
        client,
        workspace,
        selectedIfcFileId,
        viewState.view !== "2d",
      )),
      error: null,
    };
  } catch (error) {
    if (error instanceof Response && error.status < 500) throw error;
    console.error("Drawing workspace source failed", {
      workspaceId: workspace.document?.id ?? params.workspaceId,
      error,
    });
    sourceBundle = {
      primary: null,
      pdf: null,
      ifc: null,
      previousPdf: null,
      revisionEdge: null,
      catalog: [],
      error: "도면 원본을 표시하지 못했습니다. 다시 시도해 주세요.",
    };
  }
  const measurementState = workspace.document
    ? await loadDrawingWorkspaceMeasurementState(client, {
        documentId: workspace.document.id,
        revisionId: workspace.document.revision.id,
        revisionVersion: workspace.document.revision.version,
      })
    : null;
  const collaborationBootstrap =
    measurementState?.collaborationBootstrap ?? null;
  const lineageObjectId = lineageSearch.objectId;
  const requestedRevisionId = lineageSearch.revisionId;
  const lineageCursor = lineageSearch.cursor;
  if (
    requestedRevisionId &&
    workspace.document?.revision.id !== requestedRevisionId
  )
    throw new Response("연결된 도면 근거를 열 수 없습니다.", { status: 404 });
  let quantityLineage = null;
  if (lineageObjectId && !workspace.document)
    throw new Response("연결된 도면 근거를 열 수 없습니다.", {
      status: 404,
    });
  if (workspace.document && lineageObjectId) {
    try {
      if (workspace.primarySource) {
        const scope = assertDrawingQuantityWorkspaceScope(workspace, {
          fileId: workspace.primarySource.id,
          revisionId: workspace.document.revision.id,
          objectId: lineageObjectId,
        });
        if (scope.requiresEntryResolution) {
          const entry = await resolveDrawingDocumentEntry(
            client,
            project.id,
            workspace.document.id,
            lineageObjectId,
          );
          if (entry.fileId !== workspace.primarySource.id)
            throw new Error("workspace entry mismatch");
        }
      } else if (
        !workspace.document.revision.objects.some(
          (object) => object.id === lineageObjectId,
        )
      )
        throw new Error("workspace object mismatch");
    } catch {
      throw new Response("연결된 도면 근거를 열 수 없습니다.", {
        status: 404,
      });
    }
    try {
      quantityLineage = await listDrawingObjectQuantityLineage(client, {
        projectId: project.id,
        revisionId: workspace.document.revision.id,
        objectId: lineageObjectId,
        cursor: lineageCursor,
        limit: 200,
        boqEvidence:
          lineageSearch.boqVersionId && lineageSearch.boqLineId
            ? {
                boqVersionId: lineageSearch.boqVersionId,
                boqLineId: lineageSearch.boqLineId,
              }
            : undefined,
      });
      if (lineageSearch.boqVersionId && lineageSearch.boqLineId)
        assertDrawingBoqEvidenceScope(quantityLineage, {
          boqVersionId: lineageSearch.boqVersionId,
          boqLineId: lineageSearch.boqLineId,
        });
    } catch (error) {
      if (lineageSearch.boqVersionId && lineageSearch.boqLineId)
        throw new Response("연결된 도면 근거를 열 수 없습니다.", {
          status: 404,
        });
      const bounded = drawingQuantityLineageErrorResponse(error);
      throw new Response(bounded.body.error, {
        status: bounded.body.errorCode === "P6O01" ? 400 : bounded.status,
      });
    }
  }
  const activityPage = workspace.document
    ? await loadDrawingActivityPage(
        client as unknown as Parameters<typeof loadDrawingActivityPage>[0],
        project.id,
        workspace.document.revision.id,
        { cursor: searchParams.get("historyCursor") },
      )
    : null;
  const collaborationClient = client as unknown as DrawingClient;
  const [collaborationRoom, assignees] = await Promise.all([
    loadDrawingWorkspaceIssueRoom(collaborationClient, project.id, workspace),
    listDrawingAssignees(collaborationClient, project.id, project.owner_id),
  ]);
  const loaderMs = finishLoaderStage();
  headers.append(
    "Server-Timing",
    `drawing-workspace-loader;dur=${loaderMs.toFixed(3)}`,
  );
  return data(
    {
      project,
      currentUserId: user.id,
      capability: measurementState?.authorizedCapability ?? capability,
      collaborationBootstrap,
      measurementEvidence: measurementState?.measurementEvidence ?? null,
      measurementEvidenceError:
        measurementState?.measurementEvidenceError ?? null,
      estimateSummary,
      estimateOptions,
      quantityLineage,
      activityPage,
      collaborationRoom,
      assignees,
      workspace,
      sourceBundle,
      selectedIfcFileId,
      viewState,
    },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  const { client, headers, project, capability, user } = await workspaceContext(
    request,
    params.projectId!,
  );
  const form = await request.formData();
  const requestId = actionRequestId(form);
  const searchParams = new URL(request.url).searchParams;
  const intent = form.get("intent");
  if (intent === "bind_drawing_estimate") {
    let mutation;
    try {
      const bindingRoute = parseDrawingEstimateBindingRoute(
        params.workspaceId,
        searchParams.get("revision"),
      );
      const workspace = await loadDrawingWorkspace(client, {
        projectId: project.id,
        ...bindingRoute,
      });
      mutation = parseDrawingEstimateBindingForm(form, {
        capability,
        projectId: project.id,
        revisionId: workspace.document?.revision.id ?? "",
        revisionStatus: workspace.document?.revision.status ?? "",
      });
      const result = await bindDrawingEstimate(client, user.id, mutation);
      return data(
        {
          ok: true,
          kind: "drawing_estimate_binding" as const,
          error: null,
          result,
        },
        { headers },
      );
    } catch (error) {
      const bounded = await drawingWorkspaceActionErrorResponse(error, {
        requestId,
      });
      return data(bounded.body, { status: bounded.status, headers });
    }
  }
  const workspace = await loadDrawingWorkspace(client, {
    projectId: project.id,
    workspaceId: params.workspaceId!,
    revisionId: searchParams.get("revision") ?? undefined,
  });
  if (intent === "create_drawing_quantity_link") {
    await assertProjectOrganizationFeature(
      client as any,
      project.id,
      "quantity_lineage",
    );
    const stableLinkId = form.get("link_id");
    try {
      const mutation = parseDrawingQuantityLinkForm(form);
      if (workspace.primarySource) {
        const scope = assertDrawingQuantityWorkspaceScope(workspace, {
          fileId: workspace.primarySource.id,
          revisionId: mutation.drawingRevisionId,
          objectId: mutation.drawingObjectId,
        });
        if (scope.requiresEntryResolution) {
          const entry = await resolveDrawingDocumentEntry(
            client,
            project.id,
            workspace.document!.id,
            mutation.drawingObjectId,
          );
          if (entry.fileId !== workspace.primarySource.id)
            throw new DrawingQuantityLineageServerError("P6O01");
        }
      } else if (
        workspace.document?.revision.id !== mutation.drawingRevisionId ||
        !workspace.document.revision.objects.some(
          (object) => object.id === mutation.drawingObjectId,
        )
      )
        throw new DrawingQuantityLineageServerError("P6O01");
      const created = await createDrawingQuantityLink(client, user.id, {
        projectId: project.id,
        drawingRevisionId: mutation.drawingRevisionId,
        drawingObjectId: mutation.drawingObjectId,
        measurementKind: mutation.measurementKind,
        linkId: mutation.linkId,
      });
      const persisted = await listDrawingObjectQuantityLineage(client, {
        projectId: project.id,
        revisionId: mutation.drawingRevisionId,
        objectId: mutation.drawingObjectId,
        cursor: null,
        limit: 200,
      });
      if (!persisted.rows.some((row) => row.quantity.id === created.id))
        throw new DrawingQuantityLineageServerError("P6O01");
      return data(
        {
          ok: true,
          kind: "drawing_quantity_link" as const,
          error: null,
          stableLinkId: mutation.linkId,
          result: created,
          quantityLineage: persisted,
        },
        { headers },
      );
    } catch (error) {
      const bounded = drawingQuantityLineageErrorResponse(error);
      return data(
        {
          ...bounded.body,
          stableLinkId: typeof stableLinkId === "string" ? stableLinkId : null,
        },
        { status: bounded.status, headers },
      );
    }
  }
  if (intent === "cancel_pdf_compare")
    return data(
      { ok: true, kind: "pdf_compare_cancelled" as const, error: null },
      { headers },
    );
  if (intent === "load_pdf_compare") {
    try {
      const previousPdf = await loadDrawingWorkspacePreviousPdf(
        client,
        workspace,
        parseDrawingWorkspacePreviousPdfForm(form),
      );
      return data(
        {
          ok: true,
          kind: "pdf_compare" as const,
          error: null,
          previousPdf,
        },
        { headers },
      );
    } catch (error) {
      const responseMessage =
        error instanceof Response ? await error.text() : null;
      return data(
        {
          ok: false,
          kind: "pdf_compare" as const,
          error:
            responseMessage ||
            (error instanceof Error
              ? error.message
              : "PDF 개정 비교 요청에 실패했습니다."),
          previousPdf: null,
        },
        { status: error instanceof Response ? error.status : 400, headers },
      );
    }
  }
  if (intent === "comment" || intent === "add_canvas_region_anchor") {
    try {
      if (capability === "viewer")
        throw new Response("댓글을 작성할 권한이 없습니다.", {
          status: 403,
        });
      const mutation = parseDrawingMutationForm(form);
      if (
        mutation.intent === "add_canvas_region_anchor" &&
        workspace.document?.revision.id !== mutation.revisionId
      )
        throw new Response("현재 도면 영역만 연결할 수 있습니다.", {
          status: 409,
        });
      const mutationResult = await mutateDrawingIssue(
        client as unknown as DrawingClient,
        user.id,
        project.id,
        mutation,
      );
      return data(
        {
          ok: true,
          kind: "success" as const,
          error: null,
          result: mutationResult,
        },
        { headers },
      );
    } catch (error) {
      const bounded = await drawingWorkspaceActionErrorResponse(error, {
        requestId,
      });
      return data(bounded.body, { status: bounded.status, headers });
    }
  }
  let result;
  try {
    if (intent === "link_issue") {
      if (!canEdit(capability))
        throw new Response("도면 객체에 이슈를 연결할 권한이 없습니다.", {
          status: 403,
        });
      if (!workspace.document || workspace.document.revision.status !== "draft")
        throw new DrawingWorkspaceConflictError(
          "초안 개정에서만 이슈를 연결할 수 있습니다.",
        );
      await assertDrawingObjectIssueScope(client, {
        projectId: project.id,
        documentId: workspace.document.id,
        revisionId: workspace.document.revision.id,
        objectId: z.string().uuid().parse(form.get("object_id")),
      });
    }
    result = await handleWorkspaceMutation({
      client,
      projectId: project.id,
      capability,
      workspace,
      form,
      actorId: user.id,
    });
  } catch (error) {
    const bounded = await drawingWorkspaceActionErrorResponse(error, {
      requestId,
    });
    return data(bounded.body, { status: bounded.status, headers });
  }
  if (!result.body.ok) {
    const error =
      result.body.kind === "conflict"
        ? new DrawingWorkspaceConflictError(result.body.error)
        : result.body.kind === "rejected"
          ? new DrawingWorkspaceRejectedError(result.body.error)
          : result.body.kind === "retryable" || result.body.kind === "rpc"
            ? new DrawingWorkspaceRetryableError(result.body.error)
            : new z.ZodError([]);
    const bounded = await drawingWorkspaceActionErrorResponse(error, {
      requestId,
    });
    return data(bounded.body, { status: bounded.status, headers });
  }
  if (
    form.get("intent") === "create_from_template" &&
    result.status === 200 &&
    result.body.ok
  ) {
    const cloned = result.body.result as { documentId: string };
    return redirect(drawingWorkspacePath(project.id, cloned.documentId), {
      headers,
    });
  }
  if (
    form.get("intent") === "restore_approved_snapshot" &&
    result.status === 200 &&
    result.body.ok
  ) {
    const restored = result.body.result as { documentId: string };
    return redirect(drawingWorkspacePath(project.id, restored.documentId), {
      headers,
    });
  }
  return data(result.body, { status: result.status, headers });
}

export default function DrawingWorkspaceScreen({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { project, capability, workspace } = loaderData;
  const editable = canEdit(capability);
  const quantityLineage =
    actionData && "quantityLineage" in actionData
      ? actionData.quantityLineage
      : loaderData.quantityLineage;
  if (workspace.document) {
    return (
      <DrawingWorkspaceClient
        actionError={actionData?.error}
        capability={capability}
        collaborationBootstrap={loaderData.collaborationBootstrap ?? undefined}
        activityPage={loaderData.activityPage ?? undefined}
        assignees={loaderData.assignees}
        collaborationRoom={loaderData.collaborationRoom ?? undefined}
        currentUserId={loaderData.currentUserId}
        measurementEvidence={loaderData.measurementEvidence}
        measurementEvidenceError={loaderData.measurementEvidenceError}
        estimateOptions={loaderData.estimateOptions}
        estimateSummary={loaderData.estimateSummary ?? undefined}
        projectId={project.id}
        quantityLineage={quantityLineage}
        roomUrl={
          workspace.primarySource
            ? `/projects/${project.id}/drawings/${workspace.primarySource.id}`
            : `/projects/${project.id}/drawings`
        }
        sourceBundle={loaderData.sourceBundle}
        selectedIfcFileId={loaderData.selectedIfcFileId}
        viewMode={loaderData.viewState.view}
        workspace={{ ...workspace, document: workspace.document }}
      />
    );
  }
  return (
    <main className="mx-auto w-full max-w-7xl px-5 pb-28 pt-8 sm:px-8 sm:pb-12">
      <Link
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground underline underline-offset-4"
        to={
          workspace.primarySource
            ? `/projects/${project.id}/drawings/${workspace.primarySource.id}`
            : `/projects/${project.id}`
        }
      >
        <ArrowLeft className="size-4" />{" "}
        {workspace.primarySource ? "협업 도면실" : "프로젝트 개요"}
      </Link>

      <header className="mt-4 border-b pb-6">
        <p className="text-sm font-semibold text-primary">
          {project.name} · 도면 편집 작업실
        </p>
        <h1 className="mt-2 truncate text-3xl font-bold tracking-tight">
          {workspace.primarySource?.original_filename ?? "빈 작업실"}
        </h1>
        {workspace.primarySource ? (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            원본 SHA-256: {workspace.primarySource.sha256}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            원본 파일 없이 빈 도면에서 시작합니다.
          </p>
        )}
      </header>
      <ProjectWorkspaceNav current="drawings" projectId={project.id} />

      {actionData?.error ? (
        <p
          className="mt-5 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {actionData.error}
        </p>
      ) : null}

      <section className="mt-8 max-w-2xl rounded-2xl border p-6">
        <h2 className="text-xl font-bold">편집 도면 만들기</h2>
        {editable ? (
          <>
            <Form className="mt-5 space-y-4" method="post">
              <input name="intent" type="hidden" value="create_document" />
              <label
                className="block text-sm font-semibold"
                htmlFor="drawing-title"
              >
                도면 제목
              </label>
              <input
                className="min-h-11 w-full rounded-lg border bg-background px-3"
                defaultValue={
                  workspace.primarySource?.original_filename.replace(
                    /\.[^.]+$/,
                    "",
                  ) ?? project.name
                }
                id="drawing-title"
                maxLength={240}
                name="title"
                required
              />
              <div className="flex flex-wrap gap-3">
                <button
                  className="min-h-11 rounded-lg border px-4 font-semibold"
                  name="document_mode"
                  type="submit"
                  value="blank"
                >
                  빈 도면
                </button>
                {workspace.primarySource?.kind === "pdf" ? (
                  <button
                    className="min-h-11 rounded-lg bg-primary px-4 font-semibold text-primary-foreground"
                    name="document_mode"
                    type="submit"
                    value="pdf_background"
                  >
                    PDF 배경 사용
                  </button>
                ) : null}
                {workspace.primarySource ? (
                  <DrawingTemplateDialog
                    actionError={actionData?.error ?? undefined}
                    candidates={workspace.templateCandidates}
                    sourceFile={workspace.primarySource}
                  />
                ) : null}
              </div>
            </Form>
          </>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            이 파일을 볼 수 있지만 편집 도면을 만들 권한은 없습니다.
          </p>
        )}
      </section>
    </main>
  );
}
