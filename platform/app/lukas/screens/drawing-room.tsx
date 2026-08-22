import type { Route } from "./+types/drawing-room";

import { ArrowLeft } from "lucide-react";
import { Link, data } from "react-router";

import DrawingRoomClient from "~/lukas/components/drawing-room.client";
import { ProjectWorkspaceNav } from "~/lukas/components/project-workspace-nav";
import type { DrawingProjectRole } from "~/lukas/lib/drawing-collaboration-policy";
import {
  drawingContext,
  listDrawingFiles,
  loadDrawingRoom,
  mutateDrawingIssue,
  parseDrawingMutationForm,
} from "~/lukas/lib/drawing-collaboration.server";

export const meta: Route.MetaFunction = ({ data: page }) => [
  {
    title: page?.room?.file
      ? `${page.room.file.original_filename} | 도면 작업실 | 1HK Platform`
      : "도면 작업실 | 1HK Platform",
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { client, headers, project, role } = await drawingContext(
    request,
    params.projectId!,
  );
  const [room, files] = await Promise.all([
    loadDrawingRoom(client, project.id, params.fileId!),
    listDrawingFiles(client, project.id),
  ]);
  const { data: signed, error } = await client.storage
    .from("lukas-qto")
    .createSignedUrl(room.file.storage_path, 300);
  if (error || !signed?.signedUrl)
    throw new Response("도면 열기 링크를 만들지 못했습니다.", { status: 500 });
  return data(
    { project, role, room, files, signedUrl: signed.signedUrl },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  const { client, headers, project, user } = await drawingContext(
    request,
    params.projectId!,
  );
  try {
    const input = parseDrawingMutationForm(await request.formData());
    await mutateDrawingIssue(client, user.id, project.id, input);
    return data({ ok: true, error: null }, { headers });
  } catch (error) {
    if (error instanceof Response) throw error;
    return data(
      {
        ok: false,
        error: error instanceof Error ? error.message : "요청을 저장하지 못했습니다.",
      },
      { status: 400, headers },
    );
  }
}

export default function DrawingRoom({ loaderData, actionData }: Route.ComponentProps) {
  const { project, room, files } = loaderData;
  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 pb-28 pt-6 sm:px-6 sm:pb-10">
      <Link
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground underline underline-offset-4"
        to={`/projects/${project.id}/drawings`}
      >
        <ArrowLeft className="size-4" /> 도면 파일함
      </Link>
      <header className="mt-3 border-b pb-5">
        <p className="text-sm font-semibold text-primary">{project.name} · 도면 작업실</p>
        <h1 className="mt-2 truncate text-2xl font-bold">{room.file.original_filename}</h1>
      </header>
      <ProjectWorkspaceNav current="drawings" projectId={project.id} />

      {actionData?.error ? (
        <p className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {actionData.error}
        </p>
      ) : null}
      <DrawingRoomClient
        comments={room.comments}
        file={room.file}
        files={files}
        issues={room.issues}
        projectId={project.id}
        role={loaderData.role as DrawingProjectRole}
        signedUrl={loaderData.signedUrl}
      />
    </main>
  );
}
