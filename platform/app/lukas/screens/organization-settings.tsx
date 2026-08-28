import type { Route } from "./+types/organization-settings";

import { Building2, KeyRound, UserPlus, Users } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import makeServerClient from "~/core/lib/supa-client.server";
import {
  loadOrganizationAdminPage,
  parseOrganizationAdministrationForm,
  runOrganizationAdministrationMutation,
} from "~/lukas/lib/organization-administration.server";

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
  const isStaff = user.app_metadata.role === "hangil_staff";
  const mayManage =
    isStaff ||
    organization?.owner_id === user.id ||
    membership?.role === "owner" ||
    membership?.role === "admin";
  if (!organization || !mayManage)
    throw new Response("회사를 관리할 권한이 없습니다.", { status: 403 });
  return { client: client as any, headers, isStaff, organization, user };
}

export const meta: Route.MetaFunction = ({ data: page }) => [
  {
    title: page?.organization
      ? `${page.organization.name} 회사 관리 | 1HK Platform`
      : "회사 관리 | 1HK Platform",
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { client, headers, isStaff, organization, user } = await context(
    request,
    params.organizationId!,
  );
  const memberCursor = new URL(request.url).searchParams.get("memberAfter");
  let memberPage;
  try {
    memberPage = await loadOrganizationAdminPage<any>(
      client,
      "lukas_qto_list_organization_members",
      organization.id,
      memberCursor,
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError")
      throw new Response("구성원 페이지 위치가 올바르지 않습니다.", {
        status: 400,
      });
    throw error;
  }
  const members = memberPage.rows;
  const [invitations, entitlements, events, projects, managerMemberships] =
    await Promise.all([
      client
        .from("lukas_qto_organization_invitations")
        .select(
          "id,normalized_email,role,library_access,expires_at,accepted_at,revoked_at,created_at",
        )
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false })
        .limit(100),
      client
        .from("lukas_qto_organization_entitlement_versions")
        .select(
          "id,version_no,plan,seat_limit,project_limit,library_version_limit,trial_ends_at,features,reason,created_at",
        )
        .eq("organization_id", organization.id)
        .order("version_no", { ascending: false })
        .limit(20),
      client
        .from("lukas_qto_organization_admin_events")
        .select("id,event_type,details,created_at")
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false })
        .limit(50),
      client
        .from("lukas_qto_projects")
        .select("id,name,organization_id,archived_at")
        .eq("organization_id", organization.id)
        .is("archived_at", null)
        .order("name")
        .order("id")
        .limit(100),
      client
        .from("lukas_qto_organization_members")
        .select("organization_id,role")
        .eq("user_id", user.id)
        .in("role", ["owner", "admin"])
        .order("organization_id")
        .limit(100),
    ]);
  const failed = [
    invitations,
    entitlements,
    events,
    projects,
    managerMemberships,
  ].find((result) => result.error);
  if (failed?.error)
    throw new Response(
      `회사 관리 정보를 불러오지 못했습니다: ${failed.error.message}`,
      {
        status: 500,
      },
    );
  const destinationIds = (managerMemberships.data ?? [])
    .map((item: any) => item.organization_id)
    .filter((id: string) => id !== organization.id);
  const destinations =
    destinationIds.length === 0
      ? { data: [], error: null }
      : await client
          .from("lukas_qto_organizations")
          .select("id,name")
          .in("id", destinationIds)
          .order("name")
          .limit(100);
  if (destinations.error)
    throw new Response("이동 대상 회사를 불러오지 못했습니다.", {
      status: 500,
    });
  return data(
    {
      organization,
      isStaff,
      members,
      memberNext: memberPage.next,
      invitations: invitations.data ?? [],
      entitlements: entitlements.data ?? [],
      events: events.data ?? [],
      projects: projects.data ?? [],
      destinations: destinations.data ?? [],
      requestIds: {
        settings: crypto.randomUUID(),
        invite: crypto.randomUUID(),
        entitlement: crypto.randomUUID(),
        members: Object.fromEntries(
          members.map((member: any) => [member.user_id, crypto.randomUUID()]),
        ),
        invitations: Object.fromEntries(
          (invitations.data ?? []).map((invitation: any) => [
            invitation.id,
            crypto.randomUUID(),
          ]),
        ),
        projects: Object.fromEntries(
          (projects.data ?? []).map((project: any) => [
            project.id,
            crypto.randomUUID(),
          ]),
        ),
      },
    },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  let mutation: ReturnType<typeof parseOrganizationAdministrationForm>;
  try {
    mutation = parseOrganizationAdministrationForm(await request.formData());
  } catch (error) {
    return data(
      {
        error: error instanceof Error ? error.message : "입력값을 확인하세요.",
      },
      { status: 400 },
    );
  }
  const { client, headers, isStaff, organization } = await context(
    request,
    params.organizationId!,
  );
  if (mutation.intent === "set_entitlement" && !isStaff)
    return data(
      { error: "서비스 운영자만 플랜 권한을 변경할 수 있습니다." },
      { status: 403, headers },
    );
  try {
    const result = await runOrganizationAdministrationMutation(
      client,
      organization.id,
      mutation,
    );
    if (
      mutation.intent === "invite_member" &&
      result &&
      !(result as { targetUserId?: string }).targetUserId
    ) {
      const { default: adminClient } =
        await import("~/core/lib/supa-admin-client.server");
      const invitationId = (result as { invitationId: string }).invitationId;
      const origin = new URL(request.url).origin;
      const { error } = await adminClient.auth.admin.inviteUserByEmail(
        mutation.email,
        {
          redirectTo: `${origin}/organization-invitations/${invitationId}/accept`,
        },
      );
      if (error) throw error;
    }
    return redirect(`/organizations/${organization.id}/settings`, { headers });
  } catch (error) {
    return data(
      {
        error:
          error instanceof Error
            ? error.message
            : "회사 관리 작업을 완료하지 못했습니다.",
      },
      { status: 409, headers },
    );
  }
}

function Hidden({ name, value }: { name: string; value: string }) {
  return <input name={name} type="hidden" value={value} />;
}

const featureLabels = {
  drawing_workspace: "도면 작업실",
  organization_library: "회사 라이브러리",
  realtime_collaboration: "실시간 공동 편집",
  ifc_workspace: "IFC 작업실",
  quantity_lineage: "수량·내역 계보",
} as const;

export default function OrganizationSettings({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const current = loaderData.entitlements[0];
  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {loaderData.organization.name}
          </p>
          <h1 className="text-3xl font-semibold">회사 관리</h1>
          <p className="mt-2 text-muted-foreground">
            구성원, 프로젝트, 좌석·쿼터와 기능 권한 변경을 감사 기록으로
            남깁니다.
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
          <Building2 className="size-5" /> 회사 설정
        </h2>
        <Form className="mt-4 flex max-w-xl gap-3" method="post">
          <Hidden name="intent" value="update_settings" />
          <Hidden name="request_id" value={loaderData.requestIds.settings} />
          <Input
            aria-label="회사명"
            defaultValue={loaderData.organization.name}
            name="name"
            required
          />
          <Button type="submit">저장</Button>
        </Form>
      </section>

      <section className="rounded-2xl border p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <UserPlus className="size-5" /> 정확한 이메일 초대
        </h2>
        <Form
          className="mt-4 grid gap-3 md:grid-cols-[1fr_9rem_7rem_7rem_auto] md:items-end"
          method="post"
        >
          <Hidden name="intent" value="invite_member" />
          <Hidden name="request_id" value={loaderData.requestIds.invite} />
          <div>
            <Label htmlFor="invite-email">이메일</Label>
            <Input id="invite-email" name="email" required type="email" />
          </div>
          <div>
            <Label htmlFor="invite-role">회사 역할</Label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3"
              id="invite-role"
              name="role"
            >
              <option value="member">구성원</option>
              <option value="admin">관리자</option>
            </select>
          </div>
          <div>
            <Label htmlFor="invite-days">유효일</Label>
            <Input
              defaultValue="7"
              id="invite-days"
              max="30"
              min="1"
              name="expires_in_days"
              type="number"
            />
          </div>
          <label className="flex h-10 items-center gap-2">
            <input defaultChecked name="library_access" type="checkbox" />{" "}
            라이브러리
          </label>
          <Button type="submit">초대</Button>
        </Form>
        <ul className="mt-5 grid gap-2">
          {loaderData.invitations.map((invitation: any) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3"
              key={invitation.id}
            >
              <div>
                <p className="font-medium">{invitation.normalized_email}</p>
                <p className="text-xs text-muted-foreground">
                  {invitation.accepted_at
                    ? "수락됨"
                    : invitation.revoked_at
                      ? "취소됨"
                      : `만료 ${new Date(invitation.expires_at).toLocaleDateString("ko-KR")}`}
                </p>
              </div>
              {!invitation.accepted_at && !invitation.revoked_at ? (
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link
                      to={`/organization-invitations/${invitation.id}/accept`}
                    >
                      수락 링크
                    </Link>
                  </Button>
                  <Form className="flex gap-2" method="post">
                    <Hidden name="intent" value="revoke_invitation" />
                    <Hidden name="invitation_id" value={invitation.id} />
                    <Hidden
                      name="request_id"
                      value={loaderData.requestIds.invitations[invitation.id]}
                    />
                    <Input
                      aria-label="초대 취소 사유"
                      defaultValue="관리자 취소"
                      name="reason"
                      required
                    />
                    <Button size="sm" type="submit" variant="outline">
                      취소
                    </Button>
                  </Form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Users className="size-5" /> 구성원과 라이브러리 접근
        </h2>
        <ul className="mt-4 grid gap-3">
          {loaderData.members.map((member: any) => (
            <li className="rounded-lg border p-4" key={member.user_id}>
              <p className="font-medium">{member.email}</p>
              {member.role === "owner" ? (
                <p className="text-sm text-muted-foreground">
                  소유자 · 라이브러리 접근
                </p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-3">
                  <Form
                    className="flex flex-wrap items-center gap-3"
                    method="post"
                  >
                    <Hidden name="intent" value="change_member" />
                    <Hidden name="user_id" value={member.user_id} />
                    <Hidden
                      name="request_id"
                      value={loaderData.requestIds.members[member.user_id]}
                    />
                    <select
                      className="h-10 rounded-md border bg-background px-3"
                      defaultValue={member.role}
                      name="role"
                    >
                      <option value="member">구성원</option>
                      <option value="admin">관리자</option>
                    </select>
                    <label className="flex items-center gap-2">
                      <input
                        defaultChecked={member.library_access}
                        name="library_access"
                        type="checkbox"
                      />{" "}
                      라이브러리 접근
                    </label>
                    <Button size="sm" type="submit">
                      변경
                    </Button>
                  </Form>
                  <Form className="flex items-center gap-2" method="post">
                    <Hidden name="intent" value="remove_member" />
                    <Hidden name="user_id" value={member.user_id} />
                    <Hidden
                      name="request_id"
                      value={loaderData.requestIds.members[member.user_id]}
                    />
                    <Input
                      aria-label="구성원 제거 사유"
                      name="reason"
                      required
                    />
                    <Button size="sm" type="submit" variant="destructive">
                      제거
                    </Button>
                  </Form>
                </div>
              )}
            </li>
          ))}
        </ul>
        {loaderData.memberNext ? (
          <Button asChild className="mt-4" size="sm" variant="outline">
            <Link
              to={`/organizations/${loaderData.organization.id}/settings?memberAfter=${loaderData.memberNext}`}
            >
              다음 구성원
            </Link>
          </Button>
        ) : null}
      </section>

      <section className="rounded-2xl border p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <KeyRound className="size-5" /> 플랜·좌석·쿼터·기능 권한
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          현재 {current?.plan ?? "미설정"} · 좌석 한도{" "}
          {current?.seat_limit ?? 0} · 프로젝트 한도{" "}
          {current?.project_limit ?? 0} · 라이브러리 버전 한도{" "}
          {current?.library_version_limit ?? 0}
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {Object.entries(featureLabels).map(([key, label]) => (
            <p className="rounded-lg bg-muted/40 p-3 text-sm" key={key}>
              {current?.features?.[key] ? "사용" : "제한"} · {label}
            </p>
          ))}
        </div>
        {loaderData.isStaff ? (
          <Form className="mt-5 grid gap-3 md:grid-cols-3" method="post">
            <Hidden name="intent" value="set_entitlement" />
            <Hidden
              name="request_id"
              value={loaderData.requestIds.entitlement}
            />
            <div>
              <Label htmlFor="plan">플랜</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3"
                defaultValue={current?.plan ?? "free"}
                id="plan"
                name="plan"
              >
                {["legacy", "free", "team", "business", "enterprise"].map(
                  (item) => (
                    <option key={item}>{item}</option>
                  ),
                )}
              </select>
            </div>
            <div>
              <Label htmlFor="seats">좌석</Label>
              <Input
                defaultValue={current?.seat_limit ?? 3}
                id="seats"
                min="1"
                name="seat_limit"
                type="number"
              />
            </div>
            <div>
              <Label htmlFor="projects">프로젝트 쿼터</Label>
              <Input
                defaultValue={current?.project_limit ?? 3}
                id="projects"
                min="1"
                name="project_limit"
                type="number"
              />
            </div>
            <div>
              <Label htmlFor="versions">라이브러리 버전 쿼터</Label>
              <Input
                defaultValue={current?.library_version_limit ?? 10}
                id="versions"
                min="0"
                name="library_version_limit"
                type="number"
              />
            </div>
            <div>
              <Label htmlFor="trial">체험 종료 시각</Label>
              <Input
                defaultValue={current?.trial_ends_at?.slice(0, 16) ?? ""}
                id="trial"
                name="trial_ends_at"
                type="datetime-local"
              />
            </div>
            <div>
              <Label htmlFor="entitlement-reason">변경 사유</Label>
              <Input id="entitlement-reason" name="reason" required />
            </div>
            <div className="md:col-span-3 flex flex-wrap gap-4">
              {Object.entries(featureLabels).map(([key, label]) => (
                <label className="flex items-center gap-2" key={key}>
                  <input
                    defaultChecked={current?.features?.[key] ?? true}
                    name={key}
                    type="checkbox"
                  />{" "}
                  {label}
                </label>
              ))}
            </div>
            <Button className="md:col-span-3" type="submit">
              새 권한 버전 추가
            </Button>
          </Form>
        ) : null}
      </section>

      <section className="rounded-2xl border p-6">
        <h2 className="text-lg font-semibold">프로젝트 관리</h2>
        <ul className="mt-4 grid gap-3">
          {loaderData.projects.map((project: any) => (
            <li className="rounded-lg border p-4" key={project.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{project.name}</p>
                <Button asChild size="sm" variant="outline">
                  <Link to={`/projects/${project.id}/members`}>
                    구성원 관리
                  </Link>
                </Button>
              </div>
              {loaderData.destinations.length ? (
                <Form className="mt-3 flex flex-wrap gap-2" method="post">
                  <Hidden name="intent" value="move_project" />
                  <Hidden name="project_id" value={project.id} />
                  <Hidden
                    name="request_id"
                    value={loaderData.requestIds.projects[project.id]}
                  />
                  <select
                    className="h-10 rounded-md border bg-background px-3"
                    name="destination_organization_id"
                  >
                    {loaderData.destinations.map((destination: any) => (
                      <option key={destination.id} value={destination.id}>
                        {destination.name}
                      </option>
                    ))}
                  </select>
                  <Input aria-label="이동 사유" name="reason" required />
                  <Button type="submit" variant="outline">
                    이동
                  </Button>
                </Form>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
