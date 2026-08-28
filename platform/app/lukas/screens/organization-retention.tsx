import type { Route } from "./+types/organization-retention";

import { ArchiveRestore, Scale, ShieldCheck } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import makeServerClient from "~/core/lib/supa-client.server";
import {
  parseOrganizationRetentionForm,
  runOrganizationRetentionMutation,
} from "~/lukas/lib/organization-retention.server";

export const meta: Route.MetaFunction = ({ data: page }) => [
  {
    title: page?.organization
      ? `${page.organization.name} 보존 관리 | 1HK Platform`
      : "보존 관리 | 1HK Platform",
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
      .select("role")
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
    mayManage:
      user.app_metadata.role === "hangil_staff" ||
      organization.owner_id === user.id ||
      membership?.role === "owner" ||
      membership?.role === "admin",
  };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { client, headers, organization, mayManage } = await context(
    request,
    params.organizationId!,
  );
  const [
    projectsResult,
    policiesResult,
    eventsResult,
    activeHoldsResult,
    restoresResult,
  ] = await Promise.all([
    mayManage
      ? client.rpc("lukas_qto_list_retention_projects", {
          p_organization_id: organization.id,
        })
      : Promise.resolve({ data: [], error: null }),
    client
      .from("lukas_qto_retention_policy_versions")
      .select(
        "id,version_no,archive_retention_days,approved_retention_days,reason,created_at",
      )
      .eq("organization_id", organization.id)
      .order("version_no", { ascending: false })
      .limit(20),
    client
      .from("lukas_qto_retention_events")
      .select(
        "id,project_id,event_type,hold_id,releases_event_id,purge_after,reason,evidence,created_at",
      )
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: false })
      .limit(100),
    client.rpc("lukas_qto_list_active_legal_holds", {
      p_organization_id: organization.id,
    }),
    client
      .from("lukas_qto_restore_runs")
      .select(
        "id,provider_backup_id,provider_restore_project_ref,source_commit,rpo_seconds,rto_seconds,status,recorded_at",
      )
      .eq("organization_id", organization.id)
      .order("recorded_at", { ascending: false })
      .limit(20),
  ]);
  const failed = [
    projectsResult,
    policiesResult,
    eventsResult,
    activeHoldsResult,
    restoresResult,
  ].find((result) => result.error);
  if (failed?.error)
    throw new Response(
      `보존 기록을 불러오지 못했습니다: ${failed.error.message}`,
      {
        status: 500,
      },
    );
  const projects = projectsResult.data ?? [];
  const events = eventsResult.data ?? [];
  const activeHolds = activeHoldsResult.data ?? [];
  return data(
    {
      organization,
      mayManage,
      projects,
      policies: policiesResult.data ?? [],
      events,
      activeHolds,
      restores: restoresResult.data ?? [],
      requestIds: {
        policy: crypto.randomUUID(),
        projects: Object.fromEntries(
          projects.map((project: any) => [
            project.id,
            {
              archive: crypto.randomUUID(),
              delete: crypto.randomUUID(),
              hold: crypto.randomUUID(),
              holdId: crypto.randomUUID(),
            },
          ]),
        ),
        releases: Object.fromEntries(
          activeHolds.map((hold: any) => [hold.id, crypto.randomUUID()]),
        ),
      },
    },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  let mutation: ReturnType<typeof parseOrganizationRetentionForm>;
  try {
    mutation = parseOrganizationRetentionForm(await request.formData());
  } catch (error) {
    return data(
      {
        error: error instanceof Error ? error.message : "입력값을 확인하세요.",
      },
      { status: 400 },
    );
  }
  const { client, headers, organization, mayManage } = await context(
    request,
    params.organizationId!,
  );
  if (!mayManage)
    return data(
      { error: "보존 정책을 관리할 권한이 없습니다." },
      { status: 403, headers },
    );
  try {
    await runOrganizationRetentionMutation(client, organization.id, mutation);
    return redirect(`/organizations/${organization.id}/retention`, { headers });
  } catch (error) {
    return data(
      {
        error:
          error instanceof Error
            ? error.message
            : "보존 작업을 완료하지 못했습니다.",
      },
      { status: 409, headers },
    );
  }
}

function Hidden({ name, value }: { name: string; value: string }) {
  return <input name={name} type="hidden" value={value} />;
}

export default function OrganizationRetention({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const current = loaderData.policies[0];
  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {loaderData.organization.name}
          </p>
          <h1 className="text-3xl font-semibold">보존·삭제·복구 증거</h1>
          <p className="mt-2 text-muted-foreground">
            승인 근거는 직접 삭제하지 않고 정책, 법적 보존, 관리형 복구 검증을
            추가형 기록으로 남깁니다.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/workspace">작업실</Link>
        </Button>
      </header>
      {actionData?.error ? (
        <p className="rounded-lg bg-destructive/10 p-3 text-destructive">
          {actionData.error}
        </p>
      ) : null}

      <section className="rounded-2xl border p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="size-5" /> 조직 보존 정책
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          현재: 일반 {current?.archive_retention_days ?? "미설정"}일 · 승인 근거{" "}
          {current?.approved_retention_days ?? "미설정"}일
        </p>
        {loaderData.mayManage ? (
          <Form method="post" className="mt-4 grid gap-3 md:grid-cols-4">
            <Hidden name="intent" value="set_policy" />
            <Hidden name="request_id" value={loaderData.requestIds.policy} />
            <div>
              <Label htmlFor="archive-days">일반 보존(일)</Label>
              <Input
                id="archive-days"
                name="archive_retention_days"
                type="number"
                min="0"
                max="3650"
                defaultValue={current?.archive_retention_days ?? 30}
              />
            </div>
            <div>
              <Label htmlFor="approved-days">승인 근거(일)</Label>
              <Input
                id="approved-days"
                name="approved_retention_days"
                type="number"
                min="365"
                max="3650"
                defaultValue={current?.approved_retention_days ?? 2555}
              />
            </div>
            <div>
              <Label htmlFor="policy-reason">변경 사유</Label>
              <Input id="policy-reason" name="reason" required />
            </div>
            <Button className="self-end" type="submit">
              새 정책 버전 추가
            </Button>
          </Form>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ArchiveRestore className="size-5" /> 프로젝트 수명주기
        </h2>
        {loaderData.projects.map((project: any) => {
          const ids = loaderData.requestIds.projects[project.id];
          return (
            <article className="rounded-2xl border p-5" key={project.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-medium">{project.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {project.deletion_requested_at
                      ? `삭제 요청 · purge ${project.purge_after}`
                      : project.archived_at
                        ? "보관됨"
                        : "활성"}
                  </p>
                </div>
                {loaderData.mayManage ? (
                  <div className="flex flex-wrap gap-2">
                    {!project.archived_at ? (
                      <Form method="post">
                        <Hidden name="intent" value="archive" />
                        <Hidden name="project_id" value={project.id} />
                        <Hidden name="request_id" value={ids.archive} />
                        <Hidden name="reason" value="관리자 보관" />
                        <Button size="sm" variant="outline">
                          보관
                        </Button>
                      </Form>
                    ) : null}
                    {!project.deletion_requested_at ? (
                      <Form method="post">
                        <Hidden name="intent" value="request_delete" />
                        <Hidden name="project_id" value={project.id} />
                        <Hidden name="request_id" value={ids.delete} />
                        <Hidden name="reason" value="관리자 삭제 요청" />
                        <Button size="sm" variant="outline">
                          삭제 요청
                        </Button>
                      </Form>
                    ) : null}
                    <Form method="post">
                      <Hidden name="intent" value="place_hold" />
                      <Hidden name="project_id" value={project.id} />
                      <Hidden name="hold_id" value={ids.holdId} />
                      <Hidden name="request_id" value={ids.hold} />
                      <Hidden name="reason" value="관리자 법적 보존" />
                      <Button size="sm" variant="outline">
                        <Scale className="size-4" /> 법적 보존
                      </Button>
                    </Form>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border p-5">
          <h2 className="font-semibold">추가형 보존 이벤트</h2>
          <div className="mt-3 space-y-2 text-sm">
            {loaderData.events.map((event: any) => (
              <div className="rounded-lg bg-muted p-3" key={event.id}>
                <strong>{event.event_type}</strong> · {event.reason}
                <br />
                <span className="text-muted-foreground">
                  {event.created_at}
                </span>
                {event.event_type === "legal_hold_placed" &&
                loaderData.activeHolds.some(
                  (hold: any) => hold.id === event.id,
                ) &&
                loaderData.mayManage ? (
                  <Form method="post" className="mt-2">
                    <Hidden name="intent" value="release_hold" />
                    <Hidden name="project_id" value={event.project_id} />
                    <Hidden name="hold_id" value={event.hold_id} />
                    <Hidden name="reason" value="관리자 법적 보존 해제" />
                    <Hidden
                      name="request_id"
                      value={loaderData.requestIds.releases[event.id]}
                    />
                    <Button size="sm" variant="outline">
                      보존 해제
                    </Button>
                  </Form>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border p-5">
          <h2 className="font-semibold">관리형 복구 증거</h2>
          <div className="mt-3 space-y-2 text-sm">
            {loaderData.restores.length ? (
              loaderData.restores.map((restore: any) => (
                <div className="rounded-lg bg-muted p-3" key={restore.id}>
                  <strong>{restore.status}</strong> · backup{" "}
                  {restore.provider_backup_id}
                  <br />
                  <span className="text-muted-foreground">
                    RPO {restore.rpo_seconds}s · RTO {restore.rto_seconds}s ·{" "}
                    {restore.source_commit.slice(0, 8)}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">
                provider identity로 검증된 복구 실행이 없습니다.
              </p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
