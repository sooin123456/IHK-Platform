import type { Route } from "./+types/ifc-browser";

import { ArrowLeft, FileSearch } from "lucide-react";
import { Link, redirect } from "react-router";

import IfcPropertyBrowser from "~/lukas/components/ifc-property-browser.client";
import makeServerClient from "~/core/lib/supa-client.server";
import { adaptIfcRenderBundleDescriptor } from "~/lukas/lib/ifc-render-descriptor";
import { assertProjectOrganizationFeature } from "~/lukas/lib/organization-administration.server";
import {
  loadDrawingIfcDerivative,
  type DrawingWorkspaceClient,
  type DrawingWorkspaceFile,
} from "~/lukas/lib/drawing-workspace.server";

export const meta: Route.MetaFunction = ({ data }) => [
  {
    title: data?.file
      ? `${data.file.original_filename} | IFC 3D·속성 탐색 | 한길시스템`
      : "IFC 3D·속성 탐색 | 한길시스템",
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const [client] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw redirect("/login");

  const { data: project } = await client
    .from("lukas_qto_projects")
    .select("id, name")
    .eq("id", params.projectId)
    .single();
  if (!project)
    throw new Response("프로젝트를 찾을 수 없습니다.", { status: 404 });
  await assertProjectOrganizationFeature(
    client as any,
    project.id,
    "ifc_workspace",
  );

  const { data: file } = await client
    .from("lukas_qto_files")
    .select(
      "id, project_id, kind, original_filename, storage_path, content_type, byte_size, sha256, immutable, created_at",
    )
    .eq("id", params.fileId)
    .eq("project_id", project.id)
    .single();
  if (!file || file.kind !== "ifc")
    throw new Response("IFC 파일을 찾을 수 없습니다.", { status: 404 });
  const derivative = await loadDrawingIfcDerivative(
    client as unknown as DrawingWorkspaceClient,
    file as DrawingWorkspaceFile,
  );
  const renderBundle = adaptIfcRenderBundleDescriptor({
    id: file.id,
    sha256: file.sha256,
    derivative,
  });
  const requestedGlobalId = new URL(request.url).searchParams.get("globalId");
  if (
    requestedGlobalId !== null &&
    !/^[0-9A-Za-z_$]{22}$/.test(requestedGlobalId)
  )
    throw new Response("IFC GlobalId 형식이 올바르지 않습니다.", {
      status: 400,
    });
  return {
    project,
    file,
    derivative,
    renderBundle,
    requestedGlobalId,
  };
}

export default function IfcBrowser({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-8">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground underline underline-offset-4"
        to={`/projects/${loaderData.project.id}`}
      >
        <ArrowLeft className="size-4" /> 프로젝트로 돌아가기
      </Link>
      <header className="mt-5 flex flex-col gap-3 border-b pb-8 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">IFC 3D·검증 파생물</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            모델을 보고 요소와 속성을 확인합니다.
          </h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            {loaderData.project.name} · 검증된 IFC 파생물로 요소와 속성을
            확인합니다. 수량을 새로 계산하거나 원본을 바꾸지 않습니다.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm">
          <FileSearch className="size-4 text-primary" />
          <span>
            {loaderData.derivative.status === "ready"
              ? `${(loaderData.derivative.geometryByteSize / 1024 / 1024).toFixed(1)} MB GLB`
              : "파생물 생성 상태 확인 중"}
          </span>
        </div>
      </header>
      <div className="mt-8">
        <IfcPropertyBrowser
          derivative={loaderData.derivative}
          fileName={loaderData.file.original_filename}
          initialGlobalId={loaderData.requestedGlobalId}
          renderBundle={loaderData.renderBundle}
          sourceKey={loaderData.file.id}
        />
      </div>
    </main>
  );
}
