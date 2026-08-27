import type { Route } from "./+types/drawing-room";

import { ArrowLeft } from "lucide-react";
import { Link, data, redirect } from "react-router";

import DrawingRoomClient from "~/lukas/components/drawing-room.client";
import { ProjectWorkspaceNav } from "~/lukas/components/project-workspace-nav";
import type { DrawingProjectRole } from "~/lukas/lib/drawing-collaboration-policy";
import {
  drawingContext,
  listDrawingAssignees,
  listDrawingFiles,
  loadDrawingRoom,
  mutateDrawingIssue,
  parseDrawingMutationForm,
} from "~/lukas/lib/drawing-collaboration.server";
import {
  loadDrawingRevisionReview,
  parseRelinkDrawingAnchorForm,
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
  const url = new URL(request.url);
  const requestedIssuePage = parseDrawingIssuePage(
    url.searchParams.get("page"),
  );
  const initialIssueId = parseDrawingIssueId(url.searchParams.get("issue"));
  const requestedAnchorId = parseDrawingAnchorId(
    url.searchParams.get("anchor"),
  );
  const [room, files, revisionReview, assignees] = await Promise.all([
    loadDrawingRoom(client, project.id, params.fileId!, {
      page: requestedIssuePage,
      focusIssueId: initialIssueId,
    }),
    listDrawingFiles(client, project.id),
    loadDrawingRevisionReview(client, project.id, params.fileId!),
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
  const { data: signed, error } = await client.storage
    .from("lukas-qto")
    .createSignedUrl(room.file.storage_path, 300);
  if (error || !signed?.signedUrl)
    throw new Response("도면 열기 링크를 만들지 못했습니다.", { status: 500 });
  return data(
    {
      project,
      role,
      room,
      files,
      revisionReview,
      initialGlobalId: drawingLegacyGlobalId(
        url.searchParams.get("anchor"),
        url.searchParams.get("globalId"),
      ),
      initialIssueId,
      activeAnchor,
      currentUserId: user.id,
      assignees,
      signedUrl: signed.signedUrl,
    },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  const { client, headers, project, user } = await drawingContext(
    request,
    params.projectId!,
  );
  try {
    const form = await request.formData();
    if (form.get("intent") === "relink_anchor") {
      const result = await relinkDrawingIssueAnchor(
        client,
        parseRelinkDrawingAnchorForm(form),
      );
      return data({ ok: true, error: null, relink: result }, { headers });
    }
    const input = parseDrawingMutationForm(form);
    await mutateDrawingIssue(client, user.id, project.id, input);
    return data({ ok: true, error: null, relink: null }, { headers });
  } catch (error) {
    if (error instanceof Response) throw error;
    return data(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "요청을 저장하지 못했습니다.",
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
        currentUserId={loaderData.currentUserId}
        projectId={project.id}
        revisionReview={loaderData.revisionReview}
        role={loaderData.role as DrawingProjectRole}
        signedUrl={loaderData.signedUrl}
      />
    </main>
  );
}
