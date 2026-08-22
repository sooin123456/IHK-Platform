import type { Route } from "./+types/ifc-browser";

import { ArrowLeft, FileSearch } from "lucide-react";
import { Link, redirect } from "react-router";

import IfcPropertyBrowser from "~/lukas/components/ifc-property-browser.client";
import makeServerClient from "~/core/lib/supa-client.server";

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

  const { data: file } = await client
    .from("lukas_qto_files")
    .select("id, kind, original_filename, storage_path, byte_size, sha256")
    .eq("id", params.fileId)
    .eq("project_id", project.id)
    .single();
  if (!file || file.kind !== "ifc")
    throw new Response("IFC 원본을 찾을 수 없습니다.", { status: 404 });
  if (file.byte_size > 200 * 1024 * 1024)
    throw new Response(
      "200MB를 초과하는 IFC는 현재 웹에서 열 수 없습니다. 파일을 분할하거나 경량화한 뒤 다시 등록해 주세요.",
      { status: 413 },
    );

  const { data: signed, error } = await client.storage
    .from("lukas-qto")
    .createSignedUrl(file.storage_path, 300);
  if (error || !signed?.signedUrl)
    throw new Response("IFC 열기 링크를 만들지 못했습니다.", { status: 500 });
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
    signedUrl: signed.signedUrl,
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
          <p className="text-sm font-medium text-primary">IFC 3D·원본 탐색</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            모델을 보고 요소와 속성을 확인합니다.
          </h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            {loaderData.project.name} · 이 화면은 IFC를 브라우저에서만 읽습니다.
            수량을 새로 계산하거나 원본을 바꾸지 않습니다.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm">
          <FileSearch className="size-4 text-primary" />
          <span>{(loaderData.file.byte_size / 1024 / 1024).toFixed(1)} MB</span>
        </div>
      </header>
      <div className="mt-8">
        <IfcPropertyBrowser
          byteSize={loaderData.file.byte_size}
          fileName={loaderData.file.original_filename}
          initialGlobalId={loaderData.requestedGlobalId}
          signedUrl={loaderData.signedUrl}
        />
      </div>
    </main>
  );
}
