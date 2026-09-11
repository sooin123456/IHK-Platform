import type { Route } from "./+types/organization-drawing-library";

import { BookOpen, Copy, Upload, XCircle } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import makeServerClient from "~/core/lib/supa-client.server";
import { authLoginPath } from "~/features/auth/lib/auth-link.server";
import {
  ORGANIZATION_LIBRARY_LIST_LIMIT,
  assertOrganizationDrawingLibraryMutationAllowed,
  loadOrganizationPriceBookReuseEvidence,
  listOrganizationDrawingLibrary,
  parseOrganizationDrawingLibraryForm,
  parseOrganizationDrawingLibrarySearch,
  runOrganizationDrawingLibraryMutation,
} from "~/lukas/lib/organization-drawing-library.server";
import { drawingWorkspaceCapabilityForRole } from "~/lukas/lib/drawing-workspace.server";

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
type ProjectOption = {
  id: string;
  name: string;
  organization_id: string;
  can_create_workspace: boolean;
};
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
type PriceBookReuseCandidate = {
  source_sha256: string;
  project_count: number;
  price_book_count: number;
  projects: { id: string; name: string }[];
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
  if (!user || user.is_anonymous)
    throw redirect(authLoginPath(request.url), { headers });
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
    throw mergeResponseHeaders(
      new Response("회사를 찾을 수 없습니다.", { status: 404 }),
      headers,
    );
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
  const { client, headers, organization, user, mayManage } = await context(
    request,
    params.organizationId!,
  );
  try {
    const filters = parseOrganizationDrawingLibrarySearch(
      new URL(request.url).searchParams,
    );
    const [
      { data: projects, error: projectError },
      versions,
      allVersions,
      priceBookReuseEvidence,
    ] = await Promise.all([
      client
        .from("lukas_qto_projects")
        .select("id,name,organization_id,owner_id")
        .eq("organization_id", organization.id)
        .order("name")
        .order("id")
        .limit(ORGANIZATION_LIBRARY_LIST_LIMIT),
      listOrganizationDrawingLibrary(client, organization.id, filters),
      listOrganizationDrawingLibrary(client, organization.id, {}),
      mayManage
        ? loadOrganizationPriceBookReuseEvidence(client, organization.id)
        : Promise.resolve({ candidates: [], status: "unavailable" as const }),
    ]);
    if (projectError)
      throw new Response("회사 프로젝트를 불러오지 못했습니다.", {
        status: 500,
      });
    const projectIds = (projects ?? []).map(
      (project: { id: string }) => project.id,
    );
    const [revisionResult, membershipResult] =
      projectIds.length === 0
        ? [
            { data: [], error: null },
            { data: [], error: null },
          ]
        : await Promise.all([
            client
              .from("lukas_drawing_revisions")
              .select("id,project_id,status,version")
              .in("project_id", projectIds)
              .in("status", ["draft", "approved"])
              .order("updated_at", { ascending: false })
              .order("id")
              .limit(ORGANIZATION_LIBRARY_LIST_LIMIT),
            client
              .from("lukas_qto_project_members")
              .select("project_id,role")
              .in("project_id", projectIds)
              .eq("user_id", user.id),
          ]);
    if (revisionResult.error || membershipResult.error)
      throw new Response("도면 리비전을 불러오지 못했습니다.", { status: 500 });
    const revisions = revisionResult.data ?? [];
    const memberRoleByProject = new Map<string, string>(
      (membershipResult.data ?? []).map(
        (membership: { project_id: string; role: string }) => [
          membership.project_id,
          membership.role,
        ],
      ),
    );
    const workspaceProjects = (projects ?? []).map(
      (project: {
        id: string;
        name: string;
        organization_id: string;
        owner_id: string;
      }) => {
        const capability = drawingWorkspaceCapabilityForRole(
          user.app_metadata.role === "hangil_staff"
            ? "staff"
            : project.owner_id === user.id
              ? "owner"
              : memberRoleByProject.get(project.id),
        );
        return {
          id: project.id,
          name: project.name,
          organization_id: project.organization_id,
          can_create_workspace:
            capability === "admin" || capability === "editor",
        };
      },
    );
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
        projects: workspaceProjects,
        revisions: revisions ?? [],
        sources: Object.fromEntries(
          sourceResults.map((result) => [result.kind, result.data ?? []]),
        ),
        versions,
        allVersions,
        priceBookReuseEvidence,
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof Response) throw mergeResponseHeaders(error, headers);
    throw error;
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { client, headers, organization } = await context(
    request,
    params.organizationId!,
  );
  let mutation: ReturnType<typeof parseOrganizationDrawingLibraryForm>;
  try {
    mutation = parseOrganizationDrawingLibraryForm(await request.formData());
  } catch (error) {
    return data(
      {
        error: error instanceof Error ? error.message : "입력값을 확인하세요.",
      },
      { status: 400, headers },
    );
  }
  try {
    if (mutation.intent !== "create_draft") {
      const { data: version, error: versionError } = await client
        .from("lukas_drawing_library_versions")
        .select("id,organization_id,source_kind")
        .eq("id", mutation.versionId)
        .eq("organization_id", organization.id)
        .maybeSingle();
      if (versionError || !version)
        throw new Error("회사 라이브러리 버전을 찾을 수 없습니다.");
      assertOrganizationDrawingLibraryMutationAllowed(version, mutation.intent);
    }
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
  const editableProjects = loaderData.projects.filter(
    (project: ProjectOption) => project.can_create_workspace,
  );
  const priceBookReuseEvidence = loaderData.priceBookReuseEvidence ?? {
    candidates: [],
    status: "available" as const,
  };
  const editableProjectIds = new Set(
    editableProjects.map((project: ProjectOption) => project.id),
  );
  const approvedRevisions = loaderData.revisions.filter(
    (revision: RevisionOption) => revision.status === "approved",
  );
  const draftRevisions = loaderData.revisions.filter(
    (revision: RevisionOption) =>
      revision.status === "draft" &&
      editableProjectIds.has(revision.project_id),
  );
  const projectName = new Map<string, string>(
    loaderData.projects.map((project: ProjectOption) => [
      project.id,
      project.name,
    ]),
  );
  const predecessorOptions = (kind: string, name?: string) =>
    loaderData.allVersions.filter(
      (version) =>
        version.entry.kind === kind &&
        version.status !== "draft" &&
        (!name || version.entry.name === name),
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
          <p className="mt-1 text-sm text-muted-foreground">
            승인 리비전과 표준 객체를 직접 선택합니다. 기존 이름과 일치하면 최신
            발행 버전이 직전 버전으로 자동 선택됩니다.
          </p>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {Object.entries(loaderData.sources).flatMap(([kind, sources]) =>
              (sources as SourceOption[]).map((source) => {
                const predecessors = predecessorOptions(kind, source.name);
                return (
                  <Form
                    className="grid gap-3 rounded-xl border p-4"
                    key={`${kind}:${source.id}`}
                    method="post"
                  >
                    <input name="intent" type="hidden" value="create_draft" />
                    <input name="kind" type="hidden" value={kind} />
                    <input
                      name="source_revision_id"
                      type="hidden"
                      value={source.revision_id}
                    />
                    <input
                      name="source_entity_id"
                      type="hidden"
                      value={source.id}
                    />
                    <p className="text-xs font-semibold text-primary">
                      {kindLabels[kind as keyof typeof kindLabels]} ·{" "}
                      {projectName.get(
                        approvedRevisions.find(
                          (revision: RevisionOption) =>
                            revision.id === source.revision_id,
                        )?.project_id ?? "",
                      )}
                    </p>
                    <label className="grid gap-1 text-sm">
                      <span>라이브러리 이름</span>
                      <Input
                        defaultValue={source.name}
                        maxLength={255}
                        name="name"
                        required
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span>직전 버전</span>
                      <select
                        className="min-h-11 rounded-lg border bg-background px-3"
                        defaultValue={predecessors[0]?.id ?? ""}
                        name="predecessor_version_id"
                      >
                        <option value="">새 표준으로 시작</option>
                        {predecessors.map((version) => (
                          <option key={version.id} value={version.id}>
                            {version.entry.name} · v{version.version_no}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button type="submit">
                      <Copy className="size-4" /> 이 객체로 초안 만들기
                    </Button>
                  </Form>
                );
              }),
            )}
            {approvedRevisions.map((revision: RevisionOption) => {
              const templateName = `${projectName.get(revision.project_id)} 템플릿`;
              const predecessors = predecessorOptions(
                "workspace_template",
                templateName,
              );
              return (
                <Form
                  className="grid gap-3 rounded-xl border p-4"
                  key={`template:${revision.id}`}
                  method="post"
                >
                  <input name="intent" type="hidden" value="create_draft" />
                  <input name="kind" type="hidden" value="workspace_template" />
                  <input
                    name="source_revision_id"
                    type="hidden"
                    value={revision.id}
                  />
                  <p className="text-xs font-semibold text-primary">
                    작업실 템플릿 · {projectName.get(revision.project_id)} · v
                    {revision.version}
                  </p>
                  <label className="grid gap-1 text-sm">
                    <span>라이브러리 이름</span>
                    <Input
                      defaultValue={templateName}
                      maxLength={255}
                      name="name"
                      required
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span>직전 버전</span>
                    <select
                      className="min-h-11 rounded-lg border bg-background px-3"
                      defaultValue={predecessors[0]?.id ?? ""}
                      name="predecessor_version_id"
                    >
                      <option value="">새 템플릿으로 시작</option>
                      {predecessors.map((version) => (
                        <option key={version.id} value={version.id}>
                          {version.entry.name} · v{version.version_no}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button type="submit">
                    <Copy className="size-4" /> 이 리비전으로 초안 만들기
                  </Button>
                </Form>
              );
            })}
          </div>
        </section>
      ) : null}

      {loaderData.mayManage ? (
        <section
          aria-labelledby="price-book-reuse-evidence-title"
          className="mt-7 rounded-2xl border bg-card p-5"
        >
          <h2 className="font-bold" id="price-book-reuse-evidence-title">
            단가표 반복 사용 증거
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            같은 원본 SHA-256을 서로 다른 프로젝트에서 사용한 경우만 표시합니다.
            이 목록은 읽기 전용이며 단가표를 복사하거나 공유하지 않습니다.
          </p>
          {priceBookReuseEvidence.status === "unavailable" ? (
            <p
              className="mt-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground"
              role="status"
            >
              단가표 반복 사용 증거를 현재 불러올 수 없습니다. 기존 회사 도면
              라이브러리는 계속 사용할 수 있습니다.
            </p>
          ) : priceBookReuseEvidence.candidates.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              동일 원본을 2개 이상의 프로젝트에서 반복 사용한 근거가 없어 조직
              단가표 레지스트리를 만들지 않았습니다.
            </p>
          ) : (
            <div className="mt-4 grid gap-3">
              {priceBookReuseEvidence.candidates.map(
                (candidate: PriceBookReuseCandidate) => (
                  <article
                    className="rounded-xl border p-4"
                    key={candidate.source_sha256}
                  >
                    <p className="text-sm font-semibold">
                      {candidate.project_count}개 프로젝트 ·{" "}
                      {candidate.price_book_count}개 단가표
                    </p>
                    <code className="mt-2 block break-all text-xs text-muted-foreground">
                      SHA-256 {candidate.source_sha256}
                    </code>
                    <ul
                      className="mt-3 flex flex-wrap gap-2"
                      aria-label="사용 프로젝트"
                    >
                      {candidate.projects.map((project) => (
                        <li
                          className="rounded-full border px-3 py-1 text-xs"
                          key={project.id}
                        >
                          {project.name}
                        </li>
                      ))}
                    </ul>
                  </article>
                ),
              )}
            </div>
          )}
        </section>
      ) : null}

      <section className="mt-7 grid gap-4">
        {loaderData.versions.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">
            조건에 맞는 회사 표준이 없습니다.
          </p>
        ) : (
          loaderData.versions.map((version) => {
            const platformStarter = version.source_kind !== "project_revision";
            return (
              <article
                className="rounded-2xl border bg-card p-5"
                key={version.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-primary">
                      {platformStarter
                        ? `1HK 기본 · ${version.source_kind === "platform_native" ? `예제 · v${version.native_asset_version} · ` : ""}읽기 전용`
                        : `${kindLabels[version.entry.kind]} · v${version.version_no}`}
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
                  {!platformStarter &&
                  loaderData.mayManage &&
                  version.status === "draft" ? (
                    <Form method="post">
                      <input name="intent" type="hidden" value="publish" />
                      <input
                        name="version_id"
                        type="hidden"
                        value={version.id}
                      />
                      <Button type="submit">
                        <Upload className="size-4" /> 발행
                      </Button>
                    </Form>
                  ) : null}
                  {!platformStarter &&
                  loaderData.mayManage &&
                  version.status === "published" ? (
                    <Form method="post">
                      <input name="intent" type="hidden" value="deprecate" />
                      <input
                        name="version_id"
                        type="hidden"
                        value={version.id}
                      />
                      <Button type="submit" variant="outline">
                        <XCircle className="size-4" /> 사용 중단
                      </Button>
                    </Form>
                  ) : null}
                  {platformStarter && version.entry.kind === "block" ? <p className="text-sm text-muted-foreground">기본 심볼은 도면 편집기의 블록 라이브러리에서 추가하세요.</p> : null}
                  {platformStarter && version.entry.kind === "workspace_template" && version.status === "published" ? (
                    <div className="grid w-full gap-2 border-t pt-3">
                      <p className="text-xs font-semibold text-muted-foreground">
                        사용할 프로젝트
                      </p>
                      {editableProjects.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          사용 가능한 프로젝트가 없습니다
                        </p>
                      ) : (
                        editableProjects.map((project: ProjectOption) => (
                          <Link
                            className="inline-flex min-h-11 items-center justify-between rounded-lg border px-3 text-sm font-semibold"
                            key={project.id}
                            to={version.source_kind === "platform_native" ? `/projects/${project.id}/workspaces/new` : `/projects/${project.id}/workspaces/new?starterKey=${encodeURIComponent(version.platform_starter_key!)}`}
                          >
                            {project.name} · 사용
                          </Link>
                        ))
                      )}
                    </div>
                  ) : null}
                  {!platformStarter && version.status === "published" ? (
                    <div className="grid w-full gap-2 border-t pt-3">
                      <p className="text-xs font-semibold text-muted-foreground">
                        가져올 대상
                      </p>
                      {(version.entry.kind === "workspace_template"
                        ? editableProjects.map((project: ProjectOption) => ({
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
            );
          })
        )}
      </section>
    </main>
  );
}
