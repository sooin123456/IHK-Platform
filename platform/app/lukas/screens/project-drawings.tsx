import type { Route } from "./+types/project-drawings";

import {
  ArrowLeft,
  Box,
  FileText,
  FolderOpen,
  Plus,
  Upload,
} from "lucide-react";
import { Link, data } from "react-router";

import { ProjectWorkspaceNav } from "~/lukas/components/project-workspace-nav";
import {
  drawingContext,
  listDrawingFiles,
} from "~/lukas/lib/drawing-collaboration.server";
import { drawingRoomPath, drawingUploadPath } from "~/lukas/lib/drawing-entry";
import {
  drawingWorkspaceNewPath,
  drawingWorkspacePath,
  legacyDrawingWorkspacePath,
} from "~/lukas/lib/drawing-workspace-paths";
import { loadDrawingWorkspaceCapability } from "~/lukas/lib/drawing-workspace.server";

export const meta: Route.MetaFunction = ({ data }) => [
  {
    title: data?.project
      ? `${data.project.name} 도면 | 1HK Platform`
      : "도면 파일함 | 1HK Platform",
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { client, headers, project, role, user } = await drawingContext(
    request,
    params.projectId!,
  );
  const [files, { data: documents, error: documentsError }, capability] =
    await Promise.all([
      listDrawingFiles(client, project.id),
      (client as any)
        .from("lukas_drawing_documents")
        .select("id,project_id,title,source_file_id,updated_at")
        .eq("project_id", project.id)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false }),
      loadDrawingWorkspaceCapability(
        client as any,
        project.id,
        user.id,
        project.owner_id,
        role,
      ),
    ]);
  if (documentsError)
    throw new Response("도면 작업실을 불러오지 못했습니다.", { status: 500 });
  return data(
    {
      project,
      files,
      documents: documents ?? [],
      canCreateWorkspace: capability === "admin" || capability === "editor",
    },
    { headers },
  );
}

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ProjectDrawings({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto w-full max-w-7xl px-5 pb-28 pt-8 sm:px-8 sm:pb-12">
      <Link
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground underline underline-offset-4"
        to={`/projects/${loaderData.project.id}`}
      >
        <ArrowLeft className="size-4" /> 프로젝트 개요
      </Link>

      <header className="mt-4 flex flex-col gap-5 border-b pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-primary">1HK 도면 작업실</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            도면 파일함
          </h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            IFC 3D와 PDF 2D를 한곳에서 열고, 도면 위 이슈와 검토 기록을
            이어갑니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {loaderData.canCreateWorkspace ? (
            <>
              <Link
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
                to={drawingWorkspaceNewPath(loaderData.project.id)}
              >
                <Plus className="size-4" /> 새 작업실
              </Link>
              <Link
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold"
                to={drawingUploadPath(loaderData.project.id)}
              >
                <Upload className="size-4" /> 도면 추가
              </Link>
            </>
          ) : null}
          <Link
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold"
            to={`/projects/${loaderData.project.id}/files`}
          >
            <FolderOpen className="size-4" /> 전체 파일 관리
          </Link>
        </div>
      </header>

      <ProjectWorkspaceNav
        current="drawings"
        projectId={loaderData.project.id}
      />

      {loaderData.documents.length > 0 ? (
        <section className="mt-8" aria-labelledby="workspace-documents-title">
          <h2 className="text-lg font-bold" id="workspace-documents-title">
            작업실
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {loaderData.documents.map(
              (document: { id: string; title: string; updated_at: string }) => (
                <Link
                  className="rounded-3xl border bg-card p-5 shadow-sm transition hover:border-primary/40"
                  key={document.id}
                  to={drawingWorkspacePath(loaderData.project.id, document.id)}
                >
                  <p className="text-xs font-semibold text-primary">
                    도면 작업실
                  </p>
                  <h3 className="mt-2 font-bold">{document.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {new Date(document.updated_at).toLocaleDateString("ko-KR")}{" "}
                    업데이트
                  </p>
                </Link>
              ),
            )}
          </div>
        </section>
      ) : null}

      {loaderData.files.length === 0 && loaderData.documents.length === 0 ? (
        <section className="mt-8 rounded-3xl border border-dashed bg-card px-6 py-14 text-center">
          <FilesEmpty />
          <h2 className="mt-4 text-lg font-bold">
            아직 등록된 도면이 없습니다.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            빈 작업실에서 시작하거나, Revit에서 내보낸 IFC 또는 PDF 도면을
            추가하세요.
          </p>
          {loaderData.canCreateWorkspace ? (
            <Link
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
              to={drawingWorkspaceNewPath(loaderData.project.id)}
            >
              새 작업실
            </Link>
          ) : (
            <Link
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl border px-4 text-sm font-semibold"
              to={`/projects/${loaderData.project.id}`}
            >
              프로젝트 개요
            </Link>
          )}
        </section>
      ) : (
        <section className="mt-8" aria-labelledby="original-drawings-title">
          <h2 className="text-lg font-bold" id="original-drawings-title">
            원본 IFC·PDF
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {loaderData.files.map((file) => {
              const Icon = file.kind === "ifc" ? Box : FileText;
              const document = loaderData.documents.find(
                (candidate: { source_file_id: string | null }) =>
                  candidate.source_file_id === file.id,
              );
              return (
                <Link
                  className="group flex min-h-52 flex-col rounded-3xl border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                  key={file.id}
                  to={
                    file.kind === "ifc"
                      ? drawingRoomPath(loaderData.project.id, file.id)
                      : document
                        ? drawingWorkspacePath(
                            loaderData.project.id,
                            document.id,
                          )
                        : loaderData.canCreateWorkspace
                          ? legacyDrawingWorkspacePath(
                              loaderData.project.id,
                              file.id,
                            )
                          : `/projects/${loaderData.project.id}/files`
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
                      <Icon className="size-5" />
                    </span>
                    <span className="rounded-full border px-2.5 py-1 text-xs font-semibold uppercase text-muted-foreground">
                      {file.kind}
                    </span>
                  </div>
                  <h2 className="mt-5 line-clamp-2 font-bold group-hover:text-primary">
                    {file.original_filename}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {fileSize(file.byte_size)} ·{" "}
                    {new Date(file.created_at).toLocaleDateString("ko-KR")}
                  </p>
                  <span className="mt-auto pt-6 text-sm font-semibold text-primary">
                    도면 작업실 열기 →
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}

function FilesEmpty() {
  return (
    <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
      <FolderOpen className="size-6" />
    </span>
  );
}
