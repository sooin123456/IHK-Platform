import type { Route } from "./+types/project-drawings";

import { ArrowLeft, Box, FileText, FolderOpen, Upload } from "lucide-react";
import { Link, data } from "react-router";

import { ProjectWorkspaceNav } from "~/lukas/components/project-workspace-nav";
import {
  drawingContext,
  listDrawingFiles,
} from "~/lukas/lib/drawing-collaboration.server";

export const meta: Route.MetaFunction = ({ data }) => [
  {
    title: data?.project
      ? `${data.project.name} 도면 | 1HK Platform`
      : "도면 파일함 | 1HK Platform",
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { client, headers, project } = await drawingContext(
    request,
    params.projectId!,
  );
  const files = await listDrawingFiles(client, project.id);
  return data({ project, files }, { headers });
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
          <h1 className="mt-2 text-3xl font-bold tracking-tight">도면 파일함</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            IFC 3D와 PDF 2D를 한곳에서 열고, 도면 위 이슈와 검토 기록을 이어갑니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
            to={`/projects/${loaderData.project.id}/files?kind=ifc#upload`}
          >
            <Upload className="size-4" /> 도면 추가
          </Link>
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

      {loaderData.files.length === 0 ? (
        <section className="mt-8 rounded-3xl border border-dashed bg-card px-6 py-14 text-center">
          <FilesEmpty />
          <h2 className="mt-4 text-lg font-bold">아직 등록된 도면이 없습니다.</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Revit에서 내보낸 IFC 또는 PDF 도면을 먼저 추가하세요.
          </p>
        </section>
      ) : (
        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {loaderData.files.map((file) => {
            const Icon = file.kind === "ifc" ? Box : FileText;
            return (
              <Link
                className="group flex min-h-52 flex-col rounded-3xl border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                key={file.id}
                to={`/projects/${loaderData.project.id}/drawings/${file.id}`}
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
                  {fileSize(file.byte_size)} · {new Date(file.created_at).toLocaleDateString("ko-KR")}
                </p>
                <span className="mt-auto pt-6 text-sm font-semibold text-primary">
                  협업 작업실 열기 →
                </span>
              </Link>
            );
          })}
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
