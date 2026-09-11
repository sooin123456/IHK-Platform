import type { Route } from "./+types/drawing-workspace";

import {
  data,
  redirect,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { z } from "zod";

import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import DrawingWorkspaceClient from "~/lukas/components/drawing-workspace";
import { handleDrawingShareIntent } from "~/lukas/lib/drawing-share-action.server";
import {
  assertDrawingRevisionShareScope,
  listDrawingRevisionShares,
} from "~/lukas/lib/drawing-share.server";
import {
  drawingContext,
  listDrawingAssignees,
  mutateDrawingIssue,
  parseDrawingMutationForm,
  type DrawingClient,
} from "~/lukas/lib/drawing-collaboration.server";
import {
  DrawingRevisionRelinkError,
  loadDrawingRevisionReviewPage,
  loadDrawingRevisionRelinkReplay,
  parseDrawingRevisionReviewCursor,
  parseRelinkDrawingAnchorForm,
  relinkDrawingIssueAnchor,
} from "~/lukas/lib/drawing-revision.server";
import { loadDrawingActivityPage } from "~/lukas/lib/drawing-history.server";
import { renameDrawingDocumentFromWorkspaceAction } from "~/lukas/lib/drawing-document-title.server";
import {
  DrawingNativeDwgImportActionError,
  handleDrawingNativeDwgImportAction,
} from "~/lukas/lib/drawing-native-dwg-import-action.server";
import { importNativeDrawingSymbolFromWorkspace } from "~/lukas/lib/drawing-native-catalog.server";
import {
  bindDrawingEstimate,
  loadDrawingEstimateOptions,
  loadDrawingEstimateSummary,
} from "~/lukas/lib/drawing-estimate.server";
import {
  assertDrawingDxfImportScope,
  attestPreparedDrawingDxfImport,
  DrawingDxfSourceError,
  parseDrawingDxfImportForm,
  prepareDrawingDxfProjectImport,
} from "~/lukas/lib/drawing-dxf-source.server";
import {
  createDrawingQuantityLink,
  DrawingQuantityLineageServerError,
  drawingQuantityLineageErrorResponse,
  drawingWorkspaceEntryLocation,
  listDrawingObjectQuantityLineage,
  resolveDrawingWorkspaceEntry,
} from "~/lukas/lib/drawing-quantity-lineage.server";
import {
  attachDrawingWorkspaceSource,
  assertDrawingBoqEvidenceScope,
  assertDrawingQuantityWorkspaceScope,
  DrawingWorkspaceConflictError,
  DrawingWorkspaceRejectedError,
  DrawingWorkspaceRetryableError,
  DrawingWorkspaceRpcError,
  handleWorkspaceMutation,
  hydrateDrawingWorkspaceShell,
  drawingWorkspaceUsesCanonicalGraph,
  loadDrawingWorkspace,
  loadDrawingWorkspaceCollaborationBootstrap,
  loadDrawingWorkspaceCapability,
  loadDrawingWorkspaceAttachCandidates,
  loadDrawingWorkspaceShell,
  loadDrawingWorkspacePreviousPdf,
  loadDrawingWorkspaceSourceBundle,
  parseDrawingQuantityLineageSearch,
  parseDrawingQuantityLinkForm,
  parseDrawingWorkspacePreviousPdfForm,
  resolveDrawingDocumentEntry,
} from "~/lukas/lib/drawing-workspace.server";
import {
  drawingWorkspaceCanComment,
  parseDrawingWorkspaceViewState,
} from "~/lukas/lib/drawing-workspace-view";
import {
  drawingWorkspaceBoqReturnLocation,
  drawingWorkspaceMeasurementEvidencePath,
  drawingWorkspacePath,
  drawingWorkspaceQuantityLineagePath,
} from "~/lukas/lib/drawing-workspace-paths";
import {
  actionRequestId,
  assertDrawingWorkspaceRevisionRelinkAuthority,
  assertDrawingWorkspaceRevisionRelinkRequestScope,
  assertDrawingWorkspaceSourceAttachScope,
  assertDrawingObjectIssueScope,
  drawingWorkspaceActionErrorResponse,
  loadDrawingWorkspaceActionScope,
  loadDrawingWorkspaceIssueRoom,
  parseDrawingEstimateBindingForm,
  parseDrawingEstimateBindingRoute,
  parseDrawingWorkspaceSourceAttachForm,
  parseDrawingWorkspaceLineageSearch,
  recoverDrawingWorkspaceSourceFailure,
  retryDrawingWorkspaceLoaderSnapshot,
  drawingWorkspaceSourceAttachCanvasId,
} from "~/lukas/lib/drawing-workspace-route.server";
import {
  assertProjectOrganizationFeature,
  projectOrganizationFeatureEnabled,
} from "~/lukas/lib/organization-administration.server";
import { startDrawingWorkspaceStage } from "~/lukas/lib/drawing-runtime";
import {
  compactDrawingCollaborationBootstrapForLoader,
  compactDrawingWorkspaceForLoader,
} from "~/lukas/lib/drawing-workspace-loader-payload";
import type {
  DrawingWorkspaceCapability,
  DrawingWorkspaceClient as DrawingWorkspaceDatabaseClient,
} from "~/lukas/lib/drawing-workspace.server";

const drawingShareIntents = new Set([
  "create_drawing_share",
  "revoke_drawing_share",
]);
const nativeDwgImportIntents = new Set([
  "request_native_dwg_import",
  "native_dwg_import_status",
  "prepare_native_dwg_import",
]);

export const meta: Route.MetaFunction = ({ data: page }) => [
  {
    title: page?.workspace?.primarySource
      ? `${page.workspace.primarySource.original_filename} | 도면 편집 작업실 | 1HK Platform`
      : "도면 편집 작업실 | 1HK Platform",
  },
];

export function shouldRevalidate({
  actionStatus,
  currentUrl,
  defaultShouldRevalidate,
  formData,
  nextUrl,
}: ShouldRevalidateFunctionArgs) {
  if (
    formData?.get("intent") === "prepare_dxf_import" ||
    nativeDwgImportIntents.has(String(formData?.get("intent") ?? ""))
  )
    return false;
  if (
    formData?.get("intent") === "rename_drawing_document" &&
    actionStatus === 409
  )
    return true;
  if (!formData && ordinaryDrawingSelectionNavigation(currentUrl, nextUrl))
    return false;
  return defaultShouldRevalidate;
}

const deferredLineageFields = [
  "boq",
  "line",
  "evidence",
  "quantityCursor",
] as const;

function stableSearchWithoutSelection(url: URL) {
  return [...url.searchParams]
    .filter(([name]) => name !== "object" && name !== "revision")
    .sort(([leftName, leftValue], [rightName, rightValue]) =>
      leftName === rightName
        ? leftValue.localeCompare(rightValue)
        : leftName.localeCompare(rightName),
    );
}

export function ordinaryDrawingSelectionNavigation(
  currentUrl: URL,
  nextUrl: URL,
) {
  if (currentUrl.pathname !== nextUrl.pathname) return false;
  if (
    deferredLineageFields.some(
      (name) =>
        currentUrl.searchParams.has(name) || nextUrl.searchParams.has(name),
    )
  )
    return false;
  if (
    JSON.stringify(stableSearchWithoutSelection(currentUrl)) !==
    JSON.stringify(stableSearchWithoutSelection(nextUrl))
  )
    return false;
  for (const name of ["object", "revision"])
    if (
      currentUrl.searchParams.getAll(name).length > 1 ||
      nextUrl.searchParams.getAll(name).length > 1
    )
      return false;
  const currentObject = currentUrl.searchParams.get("object");
  const nextObject = nextUrl.searchParams.get("object");
  const currentRevision = currentUrl.searchParams.get("revision");
  const nextRevision = nextUrl.searchParams.get("revision");
  if (currentObject === nextObject) return false;
  if (currentRevision && nextRevision) return currentRevision === nextRevision;
  if (!currentRevision && nextRevision)
    return !currentObject && Boolean(nextObject);
  if (currentRevision && !nextRevision)
    return Boolean(currentObject) && !nextObject;
  return false;
}

function canEdit(capability: DrawingWorkspaceCapability) {
  return capability === "admin" || capability === "editor";
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
    throw mergeResponseHeaders(
      new Response("도면 작업 권한이 없습니다.", { status: 403 }),
      context.headers,
    );
  return { ...context, client, capability };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const finishLoaderStage = startDrawingWorkspaceStage("loader");
  const { client, headers, project, user, capability } = await workspaceContext(
    request,
    params.projectId!,
  );
  try {
    const searchParams = new URL(request.url).searchParams;
    let revisionReviewCursor: string | null;
    try {
      revisionReviewCursor = parseDrawingRevisionReviewCursor(
        searchParams.get("revisionReviewCursor"),
      );
    } catch {
      throw new Response("개정 검토 페이지 커서가 올바르지 않습니다.", {
        status: 400,
      });
    }
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
    const realtimeCollaborationEnabled =
      await projectOrganizationFeatureEnabled(
        client as any,
        project.id,
        "realtime_collaboration",
      );
    const routeSnapshot = await retryDrawingWorkspaceLoaderSnapshot(
      async () => {
        const workspaceShell = await loadDrawingWorkspaceShell(client, {
          projectId: project.id,
          workspaceId: params.workspaceId!,
          revisionId: lineageSearch.revisionId ?? undefined,
          focusObjectId: lineageSearch.objectId ?? undefined,
          focusEvidenceFileId: lineageSearch.evidenceFileId ?? undefined,
        });
        const collaborationClient = client as unknown as DrawingClient;
        const usesCanonicalGraph =
          drawingWorkspaceUsesCanonicalGraph(workspaceShell);
        const revisionReviewPage = workspaceShell.primarySource
          ? await loadDrawingRevisionReviewPage(
              collaborationClient,
              project.id,
              workspaceShell.primarySource.id,
              revisionReviewCursor,
            )
          : { items: [], nextCursor: null, previousCursor: null };
        const revisionReview = revisionReviewPage.items;
        const collaborationBootstrapPromise = usesCanonicalGraph
          ? loadDrawingWorkspaceCollaborationBootstrap(
              client,
              workspaceShell.document.revision.id,
            )
          : Promise.resolve(null);
        const [
          collaborationBootstrap,
          activityPage,
          collaborationRoom,
          assignees,
        ] = await Promise.all([
          collaborationBootstrapPromise,
          loadDrawingActivityPage(
            client as unknown as Parameters<typeof loadDrawingActivityPage>[0],
            project.id,
            workspaceShell.document.revision.id,
            { cursor: searchParams.get("historyCursor") },
          ),
          loadDrawingWorkspaceIssueRoom(
            collaborationClient,
            project.id,
            workspaceShell,
            {
              focusIssueIds: revisionReview.map((item) => item.issueId),
            },
          ),
          listDrawingAssignees(
            collaborationClient,
            project.id,
            project.owner_id,
          ),
        ]);
        const workspace = collaborationBootstrap
          ? hydrateDrawingWorkspaceShell(
              workspaceShell,
              collaborationBootstrap,
              {
                focusObjectId: lineageSearch.objectId ?? undefined,
                focusEvidenceFileId: lineageSearch.evidenceFileId ?? undefined,
              },
            )
          : workspaceShell;
        return {
          workspaceShell,
          workspace,
          collaborationBootstrap,
          activityPage,
          collaborationRoom,
          revisionReview,
          revisionReviewNextCursor: revisionReviewPage.nextCursor,
          revisionReviewPreviousCursor: revisionReviewPage.previousCursor,
          assignees,
        };
      },
    );
    const {
      workspaceShell,
      workspace,
      collaborationBootstrap,
      activityPage,
      collaborationRoom,
      revisionReview,
      revisionReviewNextCursor,
      revisionReviewPreviousCursor,
      assignees,
    } = routeSnapshot;
    const selectedIfcFileId =
      viewState.ifcFileId ??
      (workspaceShell.primarySource?.kind === "ifc"
        ? workspaceShell.primarySource.id
        : null);
    const sourceAttachCanvasId =
      drawingWorkspaceSourceAttachCanvasId(workspace);
    const [estimate, sourceResult, sourceAttach] = await Promise.all([
      (async () => {
        try {
          const [summary, options] = await Promise.all([
            loadDrawingEstimateSummary(client, {
              actorId: user.id,
              projectId: project.id,
              workspace,
            }),
            canEdit(capability)
              ? loadDrawingEstimateOptions(client, project.id)
              : Promise.resolve([]),
          ]);
          return { summary, options };
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
      })(),
      (async () => {
        try {
          return {
            sourceBundle: {
              ...(await loadDrawingWorkspaceSourceBundle(
                client,
                workspace,
                selectedIfcFileId,
                viewState.view !== "2d",
              )),
              error: null,
            },
            selectedIfcFileId,
          };
        } catch (error) {
          const recovery = recoverDrawingWorkspaceSourceFailure(
            error,
            selectedIfcFileId,
            viewState.view !== "2d",
          );
          if (!recovery) throw error;
          console.error("Drawing workspace source failed", {
            workspaceId: workspace.document.id,
            error,
          });
          return recovery;
        }
      })(),
      (async () => {
        if (
          !canEdit(capability) ||
          workspace.primarySource ||
          workspace.document.revision.status !== "draft"
        )
          return { canvasId: null, candidates: [], error: null };
        if (!sourceAttachCanvasId)
          return {
            canvasId: null,
            candidates: [],
            error: "PDF를 연결할 기본 종이 캔버스가 없습니다.",
          };
        try {
          return {
            canvasId: sourceAttachCanvasId,
            candidates: await loadDrawingWorkspaceAttachCandidates(
              client,
              project.id,
            ),
            error: null,
          };
        } catch (error) {
          console.error("Drawing workspace attach catalog failed", {
            workspaceId: workspace.document.id,
            error,
          });
          return {
            canvasId: sourceAttachCanvasId,
            candidates: [],
            error: "연결할 PDF 목록을 불러오지 못했습니다. 다시 시도해 주세요.",
          };
        }
      })(),
    ]);
    const sourceBundle = sourceResult.sourceBundle;
    const estimateSummary = estimate.summary;
    const estimateOptions = estimate.options;
    const lineageObjectId = lineageSearch.objectId;
    const requestedRevisionId = lineageSearch.revisionId;
    const lineageCursor = lineageSearch.cursor;
    if (
      requestedRevisionId &&
      workspace.document.revision.id !== requestedRevisionId
    )
      throw new Response("연결된 도면 근거를 열 수 없습니다.", { status: 404 });
    let quantityLineage = null;
    if (lineageObjectId) {
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
    const effectiveCapability =
      collaborationBootstrap?.capability ?? capability;
    const drawingShares =
      effectiveCapability === "admin" &&
      collaborationBootstrap &&
      workspace.document.revision.status !== "draft"
        ? await listDrawingRevisionShares(
            client,
            assertDrawingRevisionShareScope({
              capability: effectiveCapability,
              projectId: project.id,
              documentId: workspace.document.id,
              revision: workspace.document.revision,
              bootstrap: collaborationBootstrap,
            }),
          )
        : [];
    const loaderMs = finishLoaderStage();
    headers.append(
      "Server-Timing",
      `drawing-workspace-loader;dur=${loaderMs.toFixed(3)}`,
    );
    const clientCollaborationBootstrap = collaborationBootstrap
      ? compactDrawingCollaborationBootstrapForLoader(collaborationBootstrap)
      : null;
    const clientWorkspace = collaborationBootstrap
      ? compactDrawingWorkspaceForLoader(workspace, collaborationBootstrap)
      : workspace;
    return data(
      {
        project,
        currentUserId: user.id,
        realtimeCollaborationEnabled,
        capability: collaborationBootstrap?.capability ?? capability,
        collaborationBootstrap: clientCollaborationBootstrap,
        measurementEvidenceUrl: collaborationBootstrap
          ? drawingWorkspaceMeasurementEvidencePath({
              projectId: project.id,
              workspaceId: workspace.document.id,
              revisionId: collaborationBootstrap.canonicalJson.revision.id,
              revisionVersion:
                collaborationBootstrap.canonicalJson.revision.version,
              snapshotSha256: collaborationBootstrap.sha256,
              operationCheckpoint: collaborationBootstrap.operationSequence,
            })
          : null,
        estimateSummary,
        estimateOptions,
        boqReturnHref:
          lineageSearch.boqVersionId && lineageSearch.boqLineId
            ? drawingWorkspaceBoqReturnLocation(
                project.id,
                lineageSearch.boqVersionId,
                lineageSearch.boqLineId,
              )
            : null,
        quantityLineage,
        quantityLineageObjectId: lineageObjectId,
        quantityLineageUrl: drawingWorkspaceQuantityLineagePath(
          project.id,
          workspace.document.id,
        ),
        activityPage,
        collaborationRoom,
        revisionReview,
        revisionReviewNextHref: revisionReviewNextCursor
          ? (() => {
              const next = new URL(request.url);
              next.searchParams.set(
                "revisionReviewCursor",
                revisionReviewNextCursor,
              );
              return `${next.pathname}${next.search}`;
            })()
          : null,
        revisionReviewPreviousHref: revisionReviewCursor
          ? (() => {
              const previous = new URL(request.url);
              if (revisionReviewPreviousCursor)
                previous.searchParams.set(
                  "revisionReviewCursor",
                  revisionReviewPreviousCursor,
                );
              else previous.searchParams.delete("revisionReviewCursor");
              return `${previous.pathname}${previous.search}`;
            })()
          : null,
        assignees,
        workspace: clientWorkspace,
        sourceBundle,
        sourceAttach,
        drawingShares,
        selectedIfcFileId: sourceResult.selectedIfcFileId,
        viewState,
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof Response) throw mergeResponseHeaders(error, headers);
    throw error;
  }
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
        revisionId: workspace.document.revision.id,
        revisionStatus: workspace.document.revision.status,
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
  const loaded = await loadDrawingWorkspaceActionScope(
    () =>
      loadDrawingWorkspace(client, {
        projectId: project.id,
        workspaceId: params.workspaceId!,
        revisionId: searchParams.get("revision") ?? undefined,
      }),
    requestId,
  );
  if (!loaded.ok)
    return data(loaded.failure.body, {
      status: loaded.failure.status,
      headers,
    });
  const workspace = loaded.workspace;
  if (typeof intent === "string" && nativeDwgImportIntents.has(intent)) {
    try {
      return data(
        await handleDrawingNativeDwgImportAction({
          actorId: user.id,
          capability,
          client,
          form,
          projectId: project.id,
          workspace,
        }),
        { headers },
      );
    } catch (error) {
      const routeError =
        error instanceof DrawingNativeDwgImportActionError
          ? error.status === 503
            ? new DrawingWorkspaceRetryableError(error.message)
            : new Response(error.message, { status: error.status })
          : error;
      const bounded = await drawingWorkspaceActionErrorResponse(routeError, {
        requestId,
      });
      return data(bounded.body, { status: bounded.status, headers });
    }
  }
  if (intent === "import_native_symbol") {
    try {
      const result = await importNativeDrawingSymbolFromWorkspace(client, {
        projectId: project.id, capability, revision: workspace.document?.revision ?? null, form,
      });
      return data({ ok: true, kind: "native_symbol_import" as const, error: null, result }, { headers });
    } catch (error) {
      const bounded = await drawingWorkspaceActionErrorResponse(error, { requestId });
      return data(bounded.body, { status: bounded.status, headers });
    }
  }
  if (intent === "rename_drawing_document") {
    try {
      const result = await renameDrawingDocumentFromWorkspaceAction({
        client,
        capability,
        form,
        projectId: project.id,
        workspace,
      });
      return data(
        {
          ok: true,
          kind: "drawing_document_renamed" as const,
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
  if (intent === "relink_anchor") {
    try {
      const mutation = parseRelinkDrawingAnchorForm(form);
      assertDrawingWorkspaceRevisionRelinkRequestScope({
        capability,
        mutation,
        workspace,
      });
      const replay = await loadDrawingRevisionRelinkReplay(
        client as unknown as DrawingClient,
        mutation,
      );
      if (replay)
        return data(
          {
            ok: true,
            kind: "revision_anchor_relinked" as const,
            error: null,
            result: replay,
          },
          { headers },
        );
      await assertDrawingWorkspaceRevisionRelinkAuthority({
        baseClient: client as unknown as DrawingClient,
        capability,
        mutation,
        projectId: project.id,
        workspace,
      });
      const result = await relinkDrawingIssueAnchor(
        client as unknown as DrawingClient,
        mutation,
      );
      return data(
        {
          ok: true,
          kind: "revision_anchor_relinked" as const,
          error: null,
          result,
        },
        { headers },
      );
    } catch (error) {
      const routeError =
        error instanceof DrawingRevisionRelinkError
          ? error.kind === "forbidden"
            ? new Response(error.message, { status: 403 })
            : error.kind === "rejected"
              ? new DrawingWorkspaceRejectedError(error.message)
              : error.kind === "conflict"
                ? new DrawingWorkspaceConflictError(error.message)
                : new DrawingWorkspaceRetryableError(error.message)
          : error;
      const bounded = await drawingWorkspaceActionErrorResponse(routeError, {
        requestId,
      });
      return data(bounded.body, { status: bounded.status, headers });
    }
  }
  if (typeof intent === "string" && drawingShareIntents.has(intent)) {
    try {
      const { default: adminClient } = await import(
        "~/core/lib/supa-admin-client.server"
      );
      const bootstrap = await loadDrawingWorkspaceCollaborationBootstrap(
        client,
        workspace.document.revision.id,
      );
      const result = await handleDrawingShareIntent({
        actorId: user.id,
        authorityClient:
          adminClient as unknown as DrawingWorkspaceDatabaseClient,
        bootstrap,
        capability,
        client,
        form,
        projectId: project.id,
        workspace,
      });
      return data(result, { headers });
    } catch (error) {
      const bounded = await drawingWorkspaceActionErrorResponse(error, {
        requestId,
      });
      return data(bounded.body, { status: bounded.status, headers });
    }
  }
  if (intent === "prepare_dxf_import") {
    try {
      const mutation = assertDrawingDxfImportScope({
        capability,
        workspace,
        mutation: parseDrawingDxfImportForm(form),
      });
      const result = await attestPreparedDrawingDxfImport(
        await prepareDrawingDxfProjectImport(client, {
          projectId: project.id,
          actorId: user.id,
          ...mutation,
        }),
        {
          actorId: user.id,
          projectId: project.id,
          revisionId: mutation.revisionId,
          canvasId: mutation.canvasId,
          sourceFileId: mutation.sourceFileId,
        },
      );
      return data(
        {
          ok: true,
          kind: "dxf_import_prepared" as const,
          error: null,
          result,
        },
        { headers },
      );
    } catch (error) {
      const bounded = await drawingWorkspaceActionErrorResponse(
        error instanceof DrawingDxfSourceError
          ? error.status === 503
            ? new DrawingWorkspaceRetryableError(error.message)
            : new Response(error.message, { status: error.status })
          : error,
        { requestId },
      );
      return data(bounded.body, { status: bounded.status, headers });
    }
  }
  if (intent === "attach_source") {
    try {
      const mutation = assertDrawingWorkspaceSourceAttachScope({
        capability,
        workspace,
        mutation: parseDrawingWorkspaceSourceAttachForm(form),
      });
      const candidates = await loadDrawingWorkspaceAttachCandidates(
        client,
        project.id,
      );
      if (
        !candidates.some((candidate) => candidate.id === mutation.sourceFileId)
      )
        throw new Response("연결할 PDF를 찾을 수 없습니다.", { status: 404 });
      const result = await attachDrawingWorkspaceSource(client, {
        documentId: workspace.document.id,
        ...mutation,
      });
      return data(
        {
          ok: true,
          kind: "source_attached" as const,
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
        workspace.document.revision.id !== mutation.drawingRevisionId ||
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
          quantityLineageObjectId: mutation.drawingObjectId,
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
  if (
    intent === "create_issue" ||
    intent === "comment" ||
    intent === "add_canvas_region_anchor"
  ) {
    try {
      if (!drawingWorkspaceCanComment(capability))
        throw new Response("댓글을 작성할 권한이 없습니다.", {
          status: 403,
        });
      const mutation = parseDrawingMutationForm(form);
      if (
        mutation.intent === "add_canvas_region_anchor" &&
        workspace.document.revision.id !== mutation.revisionId
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
      if (mutation.intent === "create_issue")
        return data(
          {
            ok: true,
            kind: "create_issue" as const,
            error: null,
            createdIssueId: z
              .string()
              .uuid()
              .parse((mutationResult as { id?: unknown }).id),
          },
          { headers },
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
      if (
        workspace.document.revision.status === "approved" ||
        workspace.document.revision.status === "superseded"
      )
        throw new DrawingWorkspaceRejectedError(
          "승인된 개정은 변경할 수 없습니다.",
        );
      if (workspace.document.revision.status !== "draft")
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
    const collaborationEnabled = [
      "apply_operation",
      "discard_conflicted_operations",
      "request_review",
    ].includes(typeof intent === "string" ? intent : "")
      ? await projectOrganizationFeatureEnabled(
          client as any,
          project.id,
          "realtime_collaboration",
        )
      : true;
    result = await handleWorkspaceMutation({
      client,
      projectId: project.id,
      capability,
      workspace,
      form,
      actorId: user.id,
      collaborationEnabled,
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
  const quantityLineage =
    actionData && "quantityLineage" in actionData
      ? actionData.quantityLineage
      : loaderData.quantityLineage;
  const quantityLineageObjectId =
    actionData && "quantityLineageObjectId" in actionData
      ? actionData.quantityLineageObjectId
      : loaderData.quantityLineageObjectId;
  const createdIssueId =
    actionData &&
    "kind" in actionData &&
    actionData.kind === "create_issue" &&
    actionData.ok
      ? actionData.createdIssueId
      : null;
  const revisionRelinkResult =
    actionData &&
    "kind" in actionData &&
    actionData.kind === "revision_anchor_relinked" &&
    actionData.ok
      ? actionData.result
      : null;
  return (
    <DrawingWorkspaceClient
      actionError={actionData?.error}
      capability={capability}
      collaborationEnabled={loaderData.realtimeCollaborationEnabled}
      collaborationBootstrap={loaderData.collaborationBootstrap ?? undefined}
      activityPage={loaderData.activityPage ?? undefined}
      assignees={loaderData.assignees}
      collaborationRoom={loaderData.collaborationRoom ?? undefined}
      revisionRelinkResult={revisionRelinkResult}
      revisionReview={loaderData.revisionReview}
      revisionReviewNextHref={loaderData.revisionReviewNextHref}
      revisionReviewPreviousHref={loaderData.revisionReviewPreviousHref}
      createdIssueId={createdIssueId}
      currentUserId={loaderData.currentUserId}
      measurementEvidenceUrl={loaderData.measurementEvidenceUrl}
      estimateOptions={loaderData.estimateOptions}
      estimateSummary={loaderData.estimateSummary ?? undefined}
      boqReturnHref={loaderData.boqReturnHref}
      projectId={project.id}
      quantityLineage={quantityLineage}
      quantityLineageObjectId={quantityLineageObjectId}
      quantityLineageUrl={loaderData.quantityLineageUrl}
      roomUrl={
        workspace.primarySource
          ? `/projects/${project.id}/drawings/${workspace.primarySource.id}`
          : `/projects/${project.id}/drawings`
      }
      sourceBundle={loaderData.sourceBundle}
      sourceAttach={loaderData.sourceAttach}
      drawingShares={loaderData.drawingShares}
      selectedIfcFileId={loaderData.selectedIfcFileId}
      viewMode={loaderData.viewState.view}
      workspace={workspace}
    />
  );
}
