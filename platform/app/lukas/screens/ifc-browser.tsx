import type { Route } from "./+types/ifc-browser";

import { ArrowLeft, FileSearch } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link, data, redirect, useRevalidator } from "react-router";

import makeServerClient from "~/core/lib/supa-client.server";
import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import { authLoginPath } from "~/features/auth/lib/auth-link.server";
import { adaptIfcRenderBundleDescriptor } from "~/lukas/lib/ifc-render-descriptor";
import { assertProjectOrganizationFeature } from "~/lukas/lib/organization-administration.server";
import {
  loadDrawingIfcDerivative,
  type DrawingWorkspaceClient,
  type DrawingWorkspaceFile,
} from "~/lukas/lib/drawing-workspace.server";

const IfcPropertyBrowser = lazy(
  () => import("~/lukas/components/ifc-property-browser.client"),
);

export const meta: Route.MetaFunction = ({ data }) => [
  {
    title: data?.file
      ? `${data.file.original_filename} | IFC 3D·속성 탐색 | 한길시스템`
      : "IFC 3D·속성 탐색 | 한길시스템",
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const [client, headers] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous)
    throw redirect(authLoginPath(request.url), { headers });
  try {
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
    return data(
      {
        project,
        file,
        derivative,
        renderBundle,
        requestedGlobalId,
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof Response) throw mergeResponseHeaders(error, headers);
    throw error;
  }
}

export default function IfcBrowser({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
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
        {mounted ? (
          <Suspense
            fallback={
              <p className="rounded-xl border p-4" role="status">
                IFC 모델을 불러오는 중입니다.
              </p>
            }
          >
            <IfcPropertyBrowser
              derivative={loaderData.derivative}
              fileName={loaderData.file.original_filename}
              initialGlobalId={loaderData.requestedGlobalId}
              onDerivativeRefresh={revalidator.revalidate}
              renderBundle={loaderData.renderBundle}
              sourceKey={loaderData.file.id}
            />
          </Suspense>
        ) : (
          <p className="rounded-xl border p-4" role="status">
            {loaderData.file.original_filename} IFC 모델을 준비하고 있습니다.
          </p>
        )}
      </div>
    </main>
  );
}
