import type { Route } from "./+types/drawing-workspace";

import { ArrowLeft } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";

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
  createDrawingQuantityLink,
  DrawingQuantityLineageServerError,
  drawingQuantityLineageErrorResponse,
  listDrawingObjectQuantityLineage,
  resolveDrawingWorkspaceEntry,
} from "~/lukas/lib/drawing-quantity-lineage.server";
import {
  assertDrawingBoqEvidenceScope,
  assertDrawingQuantityWorkspaceScope,
  handleWorkspaceMutation,
  drawingTemplateCloneLocation,
  drawingTemplateWorkspaceLocation,
  loadDrawingWorkspace,
  loadDrawingWorkspaceMeasurementState,
  loadDrawingWorkspaceCapability,
  loadDrawingWorkspacePreviousPdf,
  loadDrawingWorkspaceSourceBundle,
  parseDrawingQuantityLinkForm,
  parseDrawingQuantityLineageSearch,
  parseDrawingWorkspacePreviousPdfForm,
  resolveDrawingDocumentEntry,
} from "~/lukas/lib/drawing-workspace.server";
import { parseDrawingWorkspaceViewState } from "~/lukas/lib/drawing-workspace-view";
import { startDrawingWorkspaceStage } from "~/lukas/lib/drawing-runtime";
import type {
  DrawingWorkspaceCapability,
  DrawingWorkspaceClient as DrawingWorkspaceDatabaseClient,
} from "~/lukas/lib/drawing-workspace.server";

export const meta: Route.MetaFunction = ({ data: page }) => [
  {
    title: page?.workspace?.file
      ? `${page.workspace.file.original_filename} | 도면 편집 작업실 | 1HK Platform`
      : "도면 편집 작업실 | 1HK Platform",
  },
];

function canEdit(capability: DrawingWorkspaceCapability) {
  return capability === "admin" || capability === "editor";
}

async function workspaceContext(request: Request, projectId: string) {
  const context = await drawingContext(request, projectId);
  const client = context.client as unknown as DrawingWorkspaceDatabaseClient;
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
    lineageSearch = parseDrawingQuantityLineageSearch(searchParams);
  } catch {
    throw new Response("도면 수량 근거 URL이 올바르지 않습니다.", {
      status: 400,
    });
  }
  if (lineageSearch.boqVersionId && lineageSearch.boqLineId) {
    try {
      if (!lineageSearch.evidenceFileId)
        throw new Error("missing evidence file");
      const authorizedLocation = await resolveDrawingWorkspaceEntry(client, {
        projectId: project.id,
        revisionId: lineageSearch.revisionId!,
        objectId: lineageSearch.objectId!,
        boqVersionId: lineageSearch.boqVersionId,
        boqLineId: lineageSearch.boqLineId,
        fileId: lineageSearch.evidenceFileId,
      });
      const authorized = new URL(authorizedLocation, request.url);
      const current = new URL(request.url);
      if (
        authorized.pathname !== current.pathname ||
        ["document", "evidence", "view", "ifc"].some(
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
  const workspace = await loadDrawingWorkspace(
    client,
    project.id,
    params.fileId!,
    new URL(request.url).searchParams.get("document") ?? undefined,
    lineageSearch.revisionId ?? undefined,
    lineageSearch.objectId ?? undefined,
    lineageSearch.evidenceFileId ?? undefined,
  );
  const selectedIfcFileId =
    viewState.ifcFileId ??
    (workspace.file.kind === "ifc" ? workspace.file.id : null);
  const sourceBundle = await loadDrawingWorkspaceSourceBundle(
    client,
    workspace,
    selectedIfcFileId,
    viewState.view !== "2d",
  );
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
      const scope = assertDrawingQuantityWorkspaceScope(workspace, {
        fileId: params.fileId!,
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
        if (entry.fileId !== workspace.file.id)
          throw new Error("workspace entry mismatch");
      }
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
    loadDrawingRoom(collaborationClient, project.id, workspace.file.id),
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
  const searchParams = new URL(request.url).searchParams;
  const workspace = await loadDrawingWorkspace(
    client,
    project.id,
    params.fileId!,
    searchParams.get("document") ?? undefined,
    searchParams.get("revision") ?? undefined,
  );
  const intent = form.get("intent");
  if (intent === "create_drawing_quantity_link") {
    const stableLinkId = form.get("link_id");
    try {
      const mutation = parseDrawingQuantityLinkForm(form);
      const scope = assertDrawingQuantityWorkspaceScope(workspace, {
        fileId: params.fileId!,
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
        if (entry.fileId !== workspace.file.id)
          throw new DrawingQuantityLineageServerError("P6O01");
      }
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
    if (capability === "viewer")
      throw new Response("댓글을 작성할 권한이 없습니다.", { status: 403 });
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
  }
  const result = await handleWorkspaceMutation({
    client,
    projectId: project.id,
    capability,
    workspace,
    form,
    actorId: user.id,
  });
  if (
    form.get("intent") === "create_from_template" &&
    result.status === 200 &&
    result.body.ok
  ) {
    return redirect(
      drawingTemplateCloneLocation(
        project.id,
        workspace.file.id,
        result.body.result,
      ),
      { headers },
    );
  }
  if (
    form.get("intent") === "restore_approved_snapshot" &&
    result.status === 200 &&
    result.body.ok
  ) {
    const restored = result.body.result as { documentId: string };
    return redirect(
      drawingTemplateWorkspaceLocation(
        project.id,
        workspace.file.id,
        restored.documentId,
      ),
      { headers },
    );
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
        collaborationRoom={loaderData.collaborationRoom}
        currentUserId={loaderData.currentUserId}
        measurementEvidence={loaderData.measurementEvidence}
        measurementEvidenceError={loaderData.measurementEvidenceError}
        projectId={project.id}
        quantityLineage={quantityLineage}
        roomUrl={`/projects/${project.id}/drawings/${workspace.file.id}`}
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
        to={`/projects/${project.id}/drawings/${workspace.file.id}`}
      >
        <ArrowLeft className="size-4" /> 협업 도면실
      </Link>

      <header className="mt-4 border-b pb-6">
        <p className="text-sm font-semibold text-primary">
          {project.name} · 도면 편집 작업실
        </p>
        <h1 className="mt-2 truncate text-3xl font-bold tracking-tight">
          {workspace.file.original_filename}
        </h1>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          원본 SHA-256: {workspace.file.sha256}
        </p>
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
                defaultValue={workspace.file.original_filename.replace(
                  /\.[^.]+$/,
                  "",
                )}
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
                {workspace.file.kind === "pdf" ? (
                  <button
                    className="min-h-11 rounded-lg bg-primary px-4 font-semibold text-primary-foreground"
                    name="document_mode"
                    type="submit"
                    value="pdf_background"
                  >
                    PDF 배경 사용
                  </button>
                ) : null}
                <DrawingTemplateDialog
                  actionError={actionData?.error ?? undefined}
                  candidates={workspace.templateCandidates}
                  sourceFile={workspace.file}
                />
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
