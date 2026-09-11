import type { Route } from "./+types/project-members";

import { ArrowLeft, UserPlus } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { z } from "zod";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import makeServerClient from "~/core/lib/supa-client.server";
import { authLoginPath } from "~/features/auth/lib/auth-link.server";

const assignableRoles = [
  "estimator",
  "reviewer",
  "approver",
  "site",
  "procurement",
  "viewer",
] as const;
const roleLabels: Record<string, string> = {
  owner: "소유자",
  estimator: "적산 담당",
  reviewer: "검토 담당",
  approver: "최종 승인",
  site: "현장 담당",
  procurement: "구매·계산서",
  viewer: "조회 전용",
};

async function context(request: Request, projectId: string) {
  const [client, headers] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous)
    throw redirect(authLoginPath(request.url), { headers });
  const { data: project } = await client
    .from("lukas_qto_projects")
    .select("id,name,owner_id,organization_id")
    .eq("id", projectId)
    .single();
  if (!project)
    throw mergeResponseHeaders(
      new Response("프로젝트를 찾을 수 없습니다.", { status: 404 }),
      headers,
    );
  const [{ data: organization }, { data: organizationMembership }] =
    await Promise.all([
      client
        .from("lukas_qto_organizations")
        .select("owner_id")
        .eq("id", project.organization_id)
        .maybeSingle(),
      client
        .from("lukas_qto_organization_members")
        .select("role")
        .eq("organization_id", project.organization_id)
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
  const mayManage =
    project.owner_id === user.id ||
    organization?.owner_id === user.id ||
    organizationMembership?.role === "owner" ||
    organizationMembership?.role === "admin" ||
    user.app_metadata.role === "hangil_staff";
  if (!mayManage)
    throw mergeResponseHeaders(
      new Response(
        "프로젝트 소유자 또는 회사 관리자만 구성원을 관리할 수 있습니다.",
        { status: 403 },
      ),
      headers,
    );
  return { client: client as any, headers, project };
}

export const meta: Route.MetaFunction = ({ data: page }) => [
  {
    title: page?.project
      ? `${page.project.name} 구성원 | 1HK Platform`
      : "프로젝트 구성원",
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { client, headers, project } = await context(
    request,
    params.projectId!,
  );
  try {
    const cursor = z
      .string()
      .uuid()
      .nullable()
      .safeParse(new URL(request.url).searchParams.get("after"));
    if (!cursor.success)
      throw new Response("구성원 페이지 위치가 올바르지 않습니다.", {
        status: 400,
      });
    const result: { data: any[] | null; error: { message: string } | null } =
      await client.rpc("lukas_qto_list_project_members", {
        p_project_id: project.id,
        p_after_user_id: cursor.data,
        p_page_size: 100,
      });
    if (result.error)
      throw new Response("구성원을 불러오지 못했습니다.", { status: 500 });
    const members = result.data ?? [];
    return data(
      {
        project,
        members,
        next: members.length === 100 ? members.at(-1).user_id : null,
        requestIds: {
          add: crypto.randomUUID(),
          remove: Object.fromEntries(
            members.map((member) => [member.user_id, crypto.randomUUID()]),
          ),
        },
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof Response) throw mergeResponseHeaders(error, headers);
    throw error;
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { client, headers, project } = await context(
    request,
    params.projectId!,
  );
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "set") {
      const unexpected = [...form.keys()].find(
        (key) => !["intent", "email", "role", "request_id"].includes(key),
      );
      if (unexpected) throw new Error(`허용되지 않은 필드: ${unexpected}`);
      const parsed = z
        .object({
          email: z
            .string()
            .trim()
            .email()
            .transform((value) => value.toLowerCase()),
          role: z.enum(assignableRoles),
          request_id: z.string().uuid(),
        })
        .parse(Object.fromEntries(form));
      const { error } = await client.rpc("lukas_qto_set_project_member", {
        p_organization_id: project.organization_id,
        p_project_id: project.id,
        p_email: parsed.email,
        p_role: parsed.role,
        p_request_id: parsed.request_id,
      });
      if (error) throw error;
    } else if (intent === "remove") {
      const unexpected = [...form.keys()].find(
        (key) => !["intent", "user_id", "reason", "request_id"].includes(key),
      );
      if (unexpected) throw new Error(`허용되지 않은 필드: ${unexpected}`);
      const parsed = z
        .object({
          user_id: z.string().uuid(),
          reason: z.string().trim().min(1).max(1000),
          request_id: z.string().uuid(),
        })
        .parse(Object.fromEntries(form));
      const { error } = await client.rpc("lukas_qto_remove_project_member", {
        p_organization_id: project.organization_id,
        p_project_id: project.id,
        p_user_id: parsed.user_id,
        p_reason: parsed.reason,
        p_request_id: parsed.request_id,
      });
      if (error) throw error;
    } else throw new Error("지원하지 않는 작업입니다.");
    return redirect(`/projects/${project.id}/members`, { headers });
  } catch (error) {
    return data(
      {
        error:
          error instanceof Error
            ? error.message
            : "구성원을 저장하지 못했습니다.",
      },
      { status: 400, headers },
    );
  }
}

function Hidden({ name, value }: { name: string; value: string }) {
  return <input name={name} type="hidden" value={value} />;
}

export default function ProjectMembers({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground underline underline-offset-4"
        to={`/projects/${loaderData.project.id}`}
      >
        <ArrowLeft className="size-4" /> 프로젝트로 돌아가기
      </Link>
      <header className="mt-5 border-b pb-8">
        <p className="text-sm font-bold text-primary">역할 분리</p>
        <h1 className="mt-2 text-3xl font-bold">
          {loaderData.project.name} 구성원
        </h1>
        <p className="mt-3 text-muted-foreground">
          회사에 참여한 정확한 이메일만 프로젝트 역할에 배정합니다.
        </p>
      </header>
      {actionData?.error ? (
        <p className="mt-5 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          {actionData.error}
        </p>
      ) : null}
      <section className="mt-8 rounded-2xl border bg-card p-6">
        <h2 className="font-semibold">회사 구성원 배정</h2>
        <Form
          className="mt-4 grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
          method="post"
        >
          <Hidden name="intent" value="set" />
          <Hidden name="request_id" value={loaderData.requestIds.add} />
          <div className="grid gap-2">
            <Label htmlFor="member-email">이메일</Label>
            <Input id="member-email" name="email" required type="email" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="member-role">역할</Label>
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              id="member-role"
              name="role"
            >
              {assignableRoles.map((role) => (
                <option key={role} value={role}>
                  {roleLabels[role]}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit">
            <UserPlus className="size-4" /> 추가·변경
          </Button>
        </Form>
      </section>
      <ul className="mt-6 grid gap-3">
        {loaderData.members.map((member: any) => (
          <li
            className="flex flex-col gap-3 rounded-2xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between"
            key={member.user_id}
          >
            <div>
              <p className="font-medium">{member.email}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {roleLabels[member.role] ?? member.role}
              </p>
            </div>
            {member.role !== "owner" ? (
              <Form method="post">
                <Hidden name="intent" value="remove" />
                <Hidden name="user_id" value={member.user_id} />
                <Hidden name="reason" value="프로젝트 역할 해제" />
                <Hidden
                  name="request_id"
                  value={loaderData.requestIds.remove[member.user_id]}
                />
                <Button size="sm" type="submit" variant="outline">
                  제거
                </Button>
              </Form>
            ) : null}
          </li>
        ))}
      </ul>
      {loaderData.next ? (
        <Button asChild className="mt-4" size="sm" variant="outline">
          <Link
            to={`/projects/${loaderData.project.id}/members?after=${loaderData.next}`}
          >
            다음 구성원
          </Link>
        </Button>
      ) : null}
    </main>
  );
}
