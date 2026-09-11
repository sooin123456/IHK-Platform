import type { Route } from "./+types/drawing-room";

import { ArrowLeft } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link, data, redirect } from "react-router";

import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import { ProjectWorkspaceNav } from "~/lukas/components/project-workspace-nav";
import {
  canRelinkDrawingRevision,
  type DrawingProjectRole,
} from "~/lukas/lib/drawing-collaboration-policy";
import {
  drawingContext,
  listDrawingAssignees,
  listDrawingFiles,
  loadDrawingRoom,
  mutateDrawingIssue,
  parseDrawingMutationForm,
} from "~/lukas/lib/drawing-collaboration.server";
import {
  assertGenericDrawingAnchorMutationAllowed,
  DrawingRevisionRelinkError,
  loadDrawingRevisionReviewCandidate,
  loadDrawingRevisionReviewPage,
  loadDrawingRevisionRelinkReplay,
  parseRelinkDrawingAnchorForm,
  parseDrawingRevisionReviewCursor,
  relinkDrawingIssueAnchor,
} from "~/lukas/lib/drawing-revision.server";
import {
  drawingViewerAnchor,
  drawingLegacyGlobalId,
  parseDrawingAnchorId,
  selectDrawingAnchorForView,
} from "~/lukas/lib/drawing-anchor-navigation";
import {
  parseDrawingIssueId,
  parseDrawingIssuePage,
} from "~/lukas/lib/drawing-pagination";
import { adaptIfcRenderBundleDescriptor } from "~/lukas/lib/ifc-render-descriptor";
import {
  loadDrawingIfcDerivative,
  type DrawingWorkspaceClient,
} from "~/lukas/lib/drawing-workspace.server";

const DrawingRoomClient = lazy(
  () => import("~/lukas/components/drawing-room.client"),
);
export function revisionReviewFocusIssueIds(
  revisionReview: ReadonlyArray<{ issueId: string }>,
) {
  return [...new Set(revisionReview.map((candidate) => candidate.issueId))];
}

export const meta: Route.MetaFunction = ({ data: page }) => [
  {
    title: page?.room?.file
      ? `${page.room.file.original_filename} | 도면 작업실 | 1HK Platform`
      : "도면 작업실 | 1HK Platform",
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { client, headers, project, role, user } = await drawingContext(
    request,
    params.projectId!,
  );
  try {
    const url = new URL(request.url);
    const requestedIssuePage = parseDrawingIssuePage(
      url.searchParams.get("page"),
    );
    const initialIssueId = parseDrawingIssueId(url.searchParams.get("issue"));
    const requestedAnchorId = parseDrawingAnchorId(
      url.searchParams.get("anchor"),
    );
    let revisionReviewCursor: string | null;
    try {
      revisionReviewCursor = parseDrawingRevisionReviewCursor(
        url.searchParams.get("revisionReviewCursor"),
      );
    } catch {
      throw new Response("개정 검토 페이지 커서가 올바르지 않습니다.", {
        status: 400,
      });
    }
    const revisionReview = await loadDrawingRevisionReviewPage(
      client,
      project.id,
      params.fileId!,
      revisionReviewCursor,
    );
    const [room, files, assignees] = await Promise.all([
      loadDrawingRoom(client, project.id, params.fileId!, {
        page: requestedIssuePage,
        focusIssueId: initialIssueId,
        focusIssueIds: revisionReviewFocusIssueIds(revisionReview.items),
      }),
      listDrawingFiles(client, project.id),
      listDrawingAssignees(client, project.id, project.owner_id),
    ]);
    if (room.issuePage.page !== requestedIssuePage) {
      url.searchParams.set("page", String(room.issuePage.page));
      throw redirect(`${url.pathname}${url.search}`, { headers });
    }
    const activeAnchor = drawingViewerAnchor(
      selectDrawingAnchorForView(
        room.anchors,
        requestedAnchorId,
        initialIssueId,
        room.file.id,
      ),
    );
    const ifcDerivative =
      room.file.kind === "ifc"
        ? await loadDrawingIfcDerivative(
            client as unknown as DrawingWorkspaceClient,
            room.file,
          )
        : null;
    const renderBundle = adaptIfcRenderBundleDescriptor(
      ifcDerivative
        ? {
            id: room.file.id,
            sha256: room.file.sha256,
            derivative: ifcDerivative,
          }
        : null,
    );
    const signedUrl =
      room.file.kind === "pdf"
        ? await (async () => {
            const { data: signed, error } = await client.storage
              .from("lukas-qto")
              .createSignedUrl(room.file.storage_path, 300);
            if (error || !signed?.signedUrl)
              throw new Response("도면 열기 링크를 만들지 못했습니다.", {
                status: 500,
              });
            return signed.signedUrl;
          })()
        : null;
    return data(
      {
        project,
        role,
        room,
        files,
        revisionReview: revisionReview.items,
        revisionReviewNextHref: revisionReview.nextCursor
          ? (() => {
              url.searchParams.set(
                "revisionReviewCursor",
                revisionReview.nextCursor,
              );
              return `${url.pathname}${url.search}`;
            })()
          : null,
        revisionReviewPreviousHref: revisionReviewCursor
          ? (() => {
              if (revisionReview.previousCursor)
                url.searchParams.set(
                  "revisionReviewCursor",
                  revisionReview.previousCursor,
                );
              else url.searchParams.delete("revisionReviewCursor");
              return `${url.pathname}${url.search}`;
            })()
          : null,
        initialGlobalId: drawingLegacyGlobalId(
          url.searchParams.get("anchor"),
          url.searchParams.get("globalId"),
        ),
        initialIssueId,
        activeAnchor,
        currentUserId: user.id,
        assignees,
        ifcDerivative,
        renderBundle,
        signedUrl,
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof Response) throw mergeResponseHeaders(error, headers);
    throw error;
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { client, headers, project, role, user } = await drawingContext(
    request,
    params.projectId!,
  );
  try {
    const form = await request.formData();
    if (form.get("intent") === "relink_anchor") {
      const input = parseRelinkDrawingAnchorForm(form);
      if (!canRelinkDrawingRevision(role))
        throw new DrawingRevisionRelinkError("forbidden", "42501");
      if (
        input.currentFileId !== params.fileId ||
        input.anchor.fileId !== params.fileId
      )
        throw new DrawingRevisionRelinkError("rejected", "P1R01");
      const { data: currentFile, error: currentFileError } = await client
        .from("lukas_qto_files")
        .select("id")
        .eq("id", params.fileId!)
        .eq("project_id", project.id)
        .maybeSingle();
      if (currentFileError)
        throw new DrawingRevisionRelinkError("retryable", "UNKNOWN");
      if (!currentFile)
        throw new DrawingRevisionRelinkError("rejected", "P1R01");
      const replay = await loadDrawingRevisionRelinkReplay(client, input);
      if (replay)
        return data({ ok: true, error: null, relink: replay }, { headers });
      const candidate = await loadDrawingRevisionReviewCandidate(
        client,
        project.id,
        params.fileId!,
        input.previousAnchorId,
      );
      if (!candidate || candidate.sourceKind !== input.anchor.kind)
        throw new DrawingRevisionRelinkError("rejected", "P1R01");
      const result = await relinkDrawingIssueAnchor(client, input);
      return data({ ok: true, error: null, relink: result }, { headers });
    }
    const input = parseDrawingMutationForm(form);
    if (input.intent === "add_anchor")
      await assertGenericDrawingAnchorMutationAllowed(client, project.id, {
        intent: input.intent,
        issueId: input.issueId,
      });
    else if (input.intent === "deactivate_anchor")
      await assertGenericDrawingAnchorMutationAllowed(client, project.id, {
        intent: input.intent,
        anchorId: input.anchorId,
      });
    await mutateDrawingIssue(client, user.id, project.id, input);
    return data({ ok: true, error: null, relink: null }, { headers });
  } catch (error) {
    if (error instanceof Response) throw mergeResponseHeaders(error, headers);
    return data(
      {
        ok: false,
        error:
          error instanceof DrawingRevisionRelinkError
            ? error.message
            : "요청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        relink: null,
      },
      { status: 400, headers },
    );
  }
}

export default function DrawingRoom({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { project, room, files } = loaderData;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 pb-28 pt-6 sm:px-6 sm:pb-10">
      <Link
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground underline underline-offset-4"
        to={`/projects/${project.id}/drawings`}
      >
        <ArrowLeft className="size-4" /> 도면 파일함
      </Link>
      <header className="mt-3 flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-primary">
            {project.name} · 도면 작업실
          </p>
          <h1 className="mt-2 truncate text-2xl font-bold">
            {room.file.original_filename}
          </h1>
        </div>
        <Link
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border px-4 text-sm font-semibold underline-offset-4 hover:underline"
          to={`/projects/${project.id}/drawings/${room.file.id}/workspace`}
        >
          도면 편집 작업실
        </Link>
      </header>
      <ProjectWorkspaceNav current="drawings" projectId={project.id} />

      {actionData?.error ? (
        <p
          className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {actionData.error}
        </p>
      ) : null}
      {actionData?.relink ? (
        <p
          className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
          role="status"
        >
          이전 근거를 해제하고 새 근거를 활성화했습니다. 두 변경은 한 번의
          원자적 작업으로 저장되었습니다.
        </p>
      ) : null}
      {mounted ? (
        <Suspense
          fallback={
            <p className="mt-5 rounded-xl border p-4" role="status">
              도면과 협업 기록을 불러오는 중입니다.
            </p>
          }
        >
          <DrawingRoomClient
            assignees={loaderData.assignees}
            anchors={room.anchors}
            activeAnchor={loaderData.activeAnchor}
            approvals={room.approvals}
            comments={room.comments}
            events={room.events}
            file={room.file}
            files={files}
            issues={room.issues}
            issuePage={room.issuePage}
            initialGlobalId={loaderData.initialGlobalId}
            initialIssueId={loaderData.initialIssueId}
            ifcDerivative={loaderData.ifcDerivative}
            currentUserId={loaderData.currentUserId}
            projectId={project.id}
            revisionReview={loaderData.revisionReview}
            revisionReviewNextHref={loaderData.revisionReviewNextHref}
            revisionReviewPreviousHref={loaderData.revisionReviewPreviousHref}
            role={loaderData.role as DrawingProjectRole}
            renderBundle={loaderData.renderBundle}
            signedUrl={loaderData.signedUrl}
          />
        </Suspense>
      ) : (
        <p className="mt-5 rounded-xl border p-4" role="status">
          {room.file.original_filename} 도면 작업실을 준비하고 있습니다.
        </p>
      )}
    </main>
  );
}
