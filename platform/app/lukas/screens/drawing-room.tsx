import type { Route } from "./+types/drawing-room";

import { ArrowLeft, Box, FileText, MessageSquarePlus } from "lucide-react";
import { Form, Link, data } from "react-router";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import IfcPropertyBrowser from "~/lukas/components/ifc-property-browser.client";
import { ProjectWorkspaceNav } from "~/lukas/components/project-workspace-nav";
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

const statusLabels: Record<string, string> = {
  open: "열림",
  in_progress: "처리 중",
  resolution_requested: "확인 요청",
  closed: "완료",
};

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

      <div className="mt-6 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_320px]">
        <aside className="order-2 rounded-2xl border bg-card p-3 lg:order-1">
          <h2 className="px-2 py-2 text-sm font-bold">프로젝트 도면</h2>
          <div className="mt-1 flex gap-2 overflow-x-auto lg:block lg:space-y-1">
            {files.map((file) => {
              const Icon = file.kind === "ifc" ? Box : FileText;
              const active = file.id === room.file.id;
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`flex min-w-52 items-center gap-2 rounded-xl px-3 py-3 text-sm lg:min-w-0 ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  key={file.id}
                  to={`/projects/${project.id}/drawings/${file.id}`}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{file.original_filename}</span>
                </Link>
              );
            })}
          </div>
        </aside>

        <section className="order-1 min-w-0 rounded-2xl border bg-card p-3 lg:order-2">
          {room.file.kind === "ifc" ? (
            <IfcPropertyBrowser
              byteSize={room.file.byte_size}
              fileName={room.file.original_filename}
              signedUrl={loaderData.signedUrl}
            />
          ) : (
            <div className="grid min-h-[55vh] place-items-center rounded-xl bg-muted/50 p-8 text-center">
              <div>
                <FileText className="mx-auto size-10 text-primary" />
                <h2 className="mt-4 text-xl font-bold">PDF 도면 뷰어 연결 중</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  다음 단계에서 페이지 렌더링과 영역 지정 도구가 이 자리에 연결됩니다.
                </p>
              </div>
            </div>
          )}
        </section>

        <aside className="order-3 rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold">도면 이슈</h2>
            <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold">
              {room.issues.length}건
            </span>
          </div>
          {actionData?.error ? (
            <p className="mt-3 rounded-xl bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              {actionData.error}
            </p>
          ) : null}
          <Form className="mt-4 space-y-3 rounded-xl border p-3" method="post">
            <input name="intent" type="hidden" value="create_issue" />
            <div>
              <Label htmlFor="drawing-issue-title">새 이슈</Label>
              <Input
                className="mt-1 min-h-11"
                id="drawing-issue-title"
                name="title"
                placeholder="예: 창호 치수 확인"
                required
              />
            </div>
            <input name="description" type="hidden" value="" />
            <input name="priority" type="hidden" value="normal" />
            <Button className="min-h-11 w-full" type="submit">
              <MessageSquarePlus className="size-4" /> 이슈 만들기
            </Button>
          </Form>
          <div className="mt-4 space-y-2">
            {room.issues.length === 0 ? (
              <p className="rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">
                아직 등록된 이슈가 없습니다.
              </p>
            ) : (
              room.issues.map((issue) => (
                <article className="rounded-xl border p-3" key={issue.id}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold">{issue.title}</h3>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[11px] font-semibold">
                      {statusLabels[issue.status] ?? issue.status}
                    </span>
                  </div>
                  {issue.description ? (
                    <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                      {issue.description}
                    </p>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
