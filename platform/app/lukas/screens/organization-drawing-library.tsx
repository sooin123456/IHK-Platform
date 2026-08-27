import type { Route } from "./+types/organization-drawing-library";

import { BookOpen, Copy, Upload, XCircle } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import makeServerClient from "~/core/lib/supa-client.server";
import {
  ORGANIZATION_LIBRARY_LIST_LIMIT,
  listOrganizationDrawingLibrary,
  parseOrganizationDrawingLibraryForm,
  parseOrganizationDrawingLibrarySearch,
  runOrganizationDrawingLibraryMutation,
} from "~/lukas/lib/organization-drawing-library.server";

const kindLabels = {
  style: "스타일",
  block: "블록",
  property_schema: "사용자 속성",
  workspace_template: "작업실 템플릿",
} as const;
const statusLabels = {
  draft: "초안",
  published: "발행됨",
  deprecated: "사용 중단",
} as const;
type ProjectOption = { id: string; name: string; organization_id: string };
type RevisionOption = {
  id: string;
  project_id: string;
  status: string;
  version: number;
};
type SourceOption = { id: string; revision_id: string; name: string };
type ImportTarget = {
  key: string;
  projectId: string;
  revisionId: string | null;
  label: string;
};

export const meta: Route.MetaFunction = ({ data: page }) => [
  {
    title: page?.organization
      ? `${page.organization.name} 도면 라이브러리 | 1HK Platform`
      : "회사 도면 라이브러리 | 1HK Platform",
  },
];

async function context(request: Request, organizationId: string) {
  const [client, headers] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous) throw redirect("/login");
  const [{ data: organization }, { data: membership }] = await Promise.all([
    client
      .from("lukas_qto_organizations")
      .select("id,name,owner_id")
      .eq("id", organizationId)
      .maybeSingle(),
    client
      .from("lukas_qto_organization_members")
      .select("organization_id,user_id,role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  if (
    !organization ||
    (!membership &&
      organization.owner_id !== user.id &&
      user.app_metadata.role !== "hangil_staff")
  )
    throw new Response("회사를 찾을 수 없습니다.", { status: 404 });
  return {
    client: client as any,
    headers,
    organization,
    user,
    mayManage:
      user.app_metadata.role === "hangil_staff" ||
      organization.owner_id === user.id ||
      membership?.role === "owner" ||
      membership?.role === "admin",
  };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const filters = parseOrganizationDrawingLibrarySearch(
    new URL(request.url).searchParams,
  );
  const { client, headers, organization, mayManage } = await context(
    request,
    params.organizationId!,
  );
  const [{ data: projects, error: projectError }, versions] = await Promise.all(
    [
      client
        .from("lukas_qto_projects")
        .select("id,name,organization_id")
        .eq("organization_id", organization.id)
        .order("name")
        .order("id")
        .limit(ORGANIZATION_LIBRARY_LIST_LIMIT),
      listOrganizationDrawingLibrary(client, organization.id, filters),
    ],
  );
  if (projectError)
    throw new Response("회사 프로젝트를 불러오지 못했습니다.", { status: 500 });
  const projectIds = (projects ?? []).map(
    (project: { id: string }) => project.id,
  );
  const { data: revisions, error: revisionError } =
    projectIds.length === 0
      ? { data: [], error: null }
      : await client
          .from("lukas_drawing_revisions")
          .select("id,project_id,status,version")
          .in("project_id", projectIds)
          .in("status", ["draft", "approved"])
          .order("updated_at", { ascending: false })
          .order("id")
          .limit(ORGANIZATION_LIBRARY_LIST_LIMIT);
  if (revisionError)
    throw new Response("도면 리비전을 불러오지 못했습니다.", { status: 500 });
  const approvedRevisionIds = (revisions ?? [])
    .filter((revision: { status: string }) => revision.status === "approved")
    .map((revision: { id: string }) => revision.id);
  const sourceTables = [
    ["style", "lukas_drawing_styles", "id,revision_id,name"],
    ["block", "lukas_drawing_blocks", "id,revision_id,name"],
    [
      "property_schema",
      "lukas_drawing_property_schemas",
      "id,revision_id,name",
    ],
  ] as const;
  const sourceResults =
    approvedRevisionIds.length === 0
      ? sourceTables.map(([kind]) => ({ kind, data: [], error: null }))
      : await Promise.all(
          sourceTables.map(async ([kind, table, select]) => {
            const result = await client
              .from(table)
              .select(select)
              .in("revision_id", approvedRevisionIds)
              .order("name")
              .order("id")
              .limit(ORGANIZATION_LIBRARY_LIST_LIMIT);
            return { kind, ...result };
          }),
        );
  if (sourceResults.some((result) => result.error))
    throw new Response("도면 표준 원본을 불러오지 못했습니다.", {
      status: 500,
    });
  return data(
    {
      organization,
      importRequestId: crypto.randomUUID(),
      mayManage,
      filters,
      projects: projects ?? [],
      revisions: revisions ?? [],
      sources: Object.fromEntries(
        sourceResults.map((result) => [result.kind, result.data ?? []]),
      ),
      versions,
    },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  let mutation: ReturnType<typeof parseOrganizationDrawingLibraryForm>;
  try {
    mutation = parseOrganizationDrawingLibraryForm(await request.formData());
  } catch (error) {
    return data(
      {
        error: error instanceof Error ? error.message : "입력값을 확인하세요.",
      },
      { status: 400 },
    );
  }
  const { client, headers, organization } = await context(
    request,
    params.organizationId!,
  );
  try {
    await runOrganizationDrawingLibraryMutation(
      client,
      organization.id,
      mutation,
    );
    return redirect(`/organizations/${organization.id}/drawing-library`, {
      headers,
    });
  } catch (error) {
    return data(
      {
        error:
          error instanceof Error
            ? error.message
            : "회사 라이브러리 작업을 완료하지 못했습니다.",
      },
      { status: 409, headers },
    );
  }
}

export default function OrganizationDrawingLibrary({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const approvedRevisions = loaderData.revisions.filter(
    (revision: RevisionOption) => revision.status === "approved",
  );
  const draftRevisions = loaderData.revisions.filter(
    (revision: RevisionOption) => revision.status === "draft",
  );
  const projectName = new Map<string, string>(
    loaderData.projects.map((project: ProjectOption) => [
      project.id,
      project.name,
    ]),
  );
  return (
    <main className="mx-auto w-full max-w-7xl px-5 pb-24 pt-8 sm:px-8">
      <Link className="text-sm underline underline-offset-4" to="/workspace">
        ← 프로젝트 작업공간
      </Link>
      <header className="mt-5 flex flex-wrap items-end justify-between gap-4 border-b pb-7">
        <div>
          <p className="text-sm font-semibold text-primary">
            {loaderData.organization.name}
          </p>
          <h1 className="mt-2 text-3xl font-bold">회사 도면 라이브러리</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            승인된 도면의 표준을 발행하고 프로젝트 초안에 고정 사본으로
            가져옵니다. 이미 가져온 프로젝트에는 새 버전이 자동 반영되지
            않습니다.
          </p>
        </div>
        <BookOpen className="size-8 text-primary" />
      </header>

      <Form className="mt-5 flex flex-wrap gap-2" method="get">
        <select
          className="min-h-11 rounded-lg border bg-background px-3"
          defaultValue={loaderData.filters.kind ?? ""}
          name="kind"
        >
          <option value="">모든 종류</option>
          {Object.entries(kindLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          className="min-h-11 rounded-lg border bg-background px-3"
          defaultValue={loaderData.filters.status ?? ""}
          name="status"
        >
          <option value="">모든 상태</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          필터 적용
        </Button>
      </Form>

      {actionData?.error ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {actionData.error}
        </p>
      ) : null}

      {loaderData.mayManage ? (
        <section
          className="mt-7 rounded-2xl border bg-card p-5"
          aria-labelledby="library-publish-title"
        >
          <h2 className="font-bold" id="library-publish-title">
            승인 도면에서 새 버전 준비
          </h2>
          <Form className="mt-4 grid gap-3 lg:grid-cols-5" method="post">
            <input name="intent" type="hidden" value="create_draft" />
            <label className="grid gap-1 text-sm">
              <span>종류</span>
              <select
                className="min-h-11 rounded-lg border bg-background px-3"
                name="kind"
                required
              >
                {Object.entries(kindLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span>라이브러리 이름</span>
              <Input maxLength={255} name="name" required />
            </label>
            <label className="grid gap-1 text-sm">
              <span>승인 리비전</span>
              <select
                className="min-h-11 rounded-lg border bg-background px-3"
                name="source_revision_id"
                required
              >
                {approvedRevisions.map((revision: RevisionOption) => (
                  <option key={revision.id} value={revision.id}>
                    {projectName.get(revision.project_id)} · v{revision.version}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span>원본 객체 UUID (템플릿은 비움)</span>
              <Input
                name="source_entity_id"
                placeholder="스타일·블록·속성 UUID"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span>직전 버전 UUID (첫 버전은 비움)</span>
              <Input name="predecessor_version_id" />
            </label>
            <Button
              className="lg:col-span-5"
              disabled={approvedRevisions.length === 0}
              type="submit"
            >
              <Copy className="size-4" /> 초안 버전 만들기
            </Button>
          </Form>
          <details className="mt-3 text-xs text-muted-foreground">
            <summary>선택 가능한 표준 객체</summary>
            <ul className="mt-2 grid gap-1">
              {Object.entries(loaderData.sources).flatMap(([kind, sources]) =>
                (sources as SourceOption[]).map((source) => (
                  <li key={source.id}>
                    {kindLabels[kind as keyof typeof kindLabels]} ·{" "}
                    {source.name} · <code>{source.id}</code>
                  </li>
                )),
              )}
            </ul>
          </details>
        </section>
      ) : null}

      <section className="mt-7 grid gap-4">
        {loaderData.versions.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">
            조건에 맞는 회사 표준이 없습니다.
          </p>
        ) : (
          loaderData.versions.map((version) => (
            <article
              className="rounded-2xl border bg-card p-5"
              key={version.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-primary">
                    {kindLabels[version.entry.kind]} · v{version.version_no}
                  </p>
                  <h2 className="mt-1 text-lg font-bold">
                    {version.entry.name}
                  </h2>
                  <code className="mt-2 block break-all text-xs text-muted-foreground">
                    SHA-256 {version.content_sha256}
                  </code>
                </div>
                <span className="rounded-full border px-3 py-1 text-xs font-semibold">
                  {statusLabels[version.status]}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {loaderData.mayManage && version.status === "draft" ? (
                  <Form method="post">
                    <input name="intent" type="hidden" value="publish" />
                    <input name="version_id" type="hidden" value={version.id} />
                    <Button type="submit">
                      <Upload className="size-4" /> 발행
                    </Button>
                  </Form>
                ) : null}
                {loaderData.mayManage && version.status === "published" ? (
                  <Form method="post">
                    <input name="intent" type="hidden" value="deprecate" />
                    <input name="version_id" type="hidden" value={version.id} />
                    <Button type="submit" variant="outline">
                      <XCircle className="size-4" /> 사용 중단
                    </Button>
                  </Form>
                ) : null}
                {version.status === "published" ? (
                  <div className="grid w-full gap-2 border-t pt-3">
                    <p className="text-xs font-semibold text-muted-foreground">
                      가져올 대상
                    </p>
                    {(version.entry.kind === "workspace_template"
                      ? loaderData.projects.map((project: ProjectOption) => ({
                          key: project.id,
                          projectId: project.id,
                          revisionId: null,
                          label: `${project.name}에 새 도면 만들기`,
                        }))
                      : draftRevisions.map((revision: RevisionOption) => ({
                          key: revision.id,
                          projectId: revision.project_id,
                          revisionId: revision.id,
                          label: `${projectName.get(revision.project_id)} · 초안 v${revision.version}`,
                        }))
                    ).map((target: ImportTarget) => (
                      <Form
                        className="flex items-center justify-between gap-3 rounded-lg border p-2"
                        key={target.key}
                        method="post"
                      >
                        <input name="intent" type="hidden" value="import" />
                        <input
                          name="version_id"
                          type="hidden"
                          value={version.id}
                        />
                        <input
                          name="client_request_id"
                          type="hidden"
                          value={loaderData.importRequestId}
                        />
                        <input
                          name="project_id"
                          type="hidden"
                          value={target.projectId}
                        />
                        {target.revisionId ? (
                          <input
                            name="revision_id"
                            type="hidden"
                            value={target.revisionId}
                          />
                        ) : null}
                        <span className="text-sm">{target.label}</span>
                        <Button type="submit" variant="outline">
                          고정 사본 가져오기
                        </Button>
                      </Form>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
