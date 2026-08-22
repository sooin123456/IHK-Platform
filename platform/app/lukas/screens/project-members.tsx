import type { Route } from "./+types/project-members";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "database.types";
import { ArrowLeft, UserPlus } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { z } from "zod";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import makeServerClient from "~/core/lib/supa-client.server";

const assignableRoles = [
  "estimator",
  "reviewer",
  "site",
  "procurement",
  "viewer",
] as const;
const roleLabels: Record<string, string> = {
  owner: "소유자",
  estimator: "적산 담당",
  reviewer: "검토·승인",
  site: "현장 담당",
  procurement: "구매·계산서",
  viewer: "조회 전용",
};
type MemberRow = {
  project_id: string;
  user_id: string;
  role: string;
  created_at: string;
};
type MemberDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & {
      lukas_qto_project_members: {
        Row: MemberRow;
        Insert: Omit<MemberRow, "created_at"> & { created_at?: string };
        Update: { role?: string };
        Relationships: [];
      };
    };
  };
};

async function context(request: Request, projectId: string) {
  const [client, headers] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous) throw redirect("/login");
  const { data: project } = await client
    .from("lukas_qto_projects")
    .select("id, name, owner_id")
    .eq("id", projectId)
    .single();
  if (!project) throw new Response("프로젝트를 찾을 수 없습니다.", { status: 404 });
  const mayManage =
    project.owner_id === user.id || user.app_metadata.role === "hangil_staff";
  if (!mayManage)
    throw new Response("프로젝트 소유자만 구성원을 관리할 수 있습니다.", {
      status: 403,
    });
  return {
    client: client as unknown as SupabaseClient<MemberDatabase>,
    headers,
    project,
    user,
  };
}

export const meta: Route.MetaFunction = ({ data: page }) => [
  { title: page?.project ? `${page.project.name} 구성원 | 한길시스템` : "프로젝트 구성원" },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { client, project } = await context(request, params.projectId!);
  const { data: members, error } = await client
    .from("lukas_qto_project_members")
    .select("project_id, user_id, role, created_at")
    .eq("project_id", project.id)
    .order("created_at");
  if (error) throw new Response("구성원을 불러오지 못했습니다.", { status: 500 });
  const { default: adminClient } = await import("~/core/lib/supa-admin-client.server");
  const { data: users, error: usersError } = await adminClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (usersError) throw new Response("구성원 이메일을 확인하지 못했습니다.", { status: 500 });
  const emailById = new Map(users.users.map((user) => [user.id, user.email ?? "이메일 없음"]));
  return {
    project,
    members: (members ?? []).map((member) => ({
      ...member,
      email: emailById.get(member.user_id) ?? "등록 사용자",
    })),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { client, headers, project } = await context(request, params.projectId!);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "add") {
      const parsed = z
        .object({
          email: z.string().trim().email().transform((value) => value.toLowerCase()),
          role: z.enum(assignableRoles),
        })
        .parse({ email: form.get("email"), role: form.get("role") });
      const { default: adminClient } = await import("~/core/lib/supa-admin-client.server");
      const { data: users, error: usersError } = await adminClient.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (usersError) throw usersError;
      const target = users.users.find(
        (user) => user.email?.toLowerCase() === parsed.email,
      );
      if (!target || target.is_anonymous)
        throw new Error("먼저 해당 이메일로 Lukas QTO에 가입해야 합니다.");
      if (target.id === project.owner_id)
        throw new Error("프로젝트 소유자의 역할은 변경할 수 없습니다.");
      const { error } = await client.from("lukas_qto_project_members").upsert(
        { project_id: project.id, user_id: target.id, role: parsed.role },
        { onConflict: "project_id,user_id" },
      );
      if (error) throw error;
    } else if (intent === "remove") {
      const userId = z.string().uuid().parse(form.get("user_id"));
      if (userId === project.owner_id)
        throw new Error("프로젝트 소유자는 제거할 수 없습니다.");
      const { error } = await client
        .from("lukas_qto_project_members")
        .delete()
        .eq("project_id", project.id)
        .eq("user_id", userId);
      if (error) throw error;
    } else throw new Error("지원하지 않는 작업입니다.");
    return redirect(`/projects/${project.id}/members`, { headers });
  } catch (error) {
    return data(
      { error: error instanceof Error ? error.message : "구성원을 저장하지 못했습니다." },
      { status: 400, headers },
    );
  }
}

export default function ProjectMembers({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8">
      <Link className="inline-flex items-center gap-1 text-sm text-muted-foreground underline underline-offset-4" to={`/projects/${loaderData.project.id}`}>
        <ArrowLeft className="size-4" /> 프로젝트로 돌아가기
      </Link>
      <header className="mt-5 border-b pb-8">
        <p className="text-sm font-bold text-primary">ROLE SEPARATION</p>
        <h1 className="mt-2 text-3xl font-bold">{loaderData.project.name} 구성원</h1>
        <p className="mt-3 text-muted-foreground">
          적산은 계획을 만들고, 검토자는 승인하며, 현장은 입고·설치·반품·폐기를,
          구매 담당은 발주·계산서·EPD를 기록합니다.
        </p>
      </header>
      {actionData?.error ? <p className="mt-5 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">{actionData.error}</p> : null}
      <section className="mt-8 rounded-2xl border bg-card p-6">
        <h2 className="font-semibold">가입한 사용자 초대</h2>
        <Form className="mt-4 grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end" method="post">
          <input name="intent" type="hidden" value="add" />
          <div className="grid gap-2"><Label htmlFor="member-email">이메일</Label><Input id="member-email" name="email" required type="email" /></div>
          <div className="grid gap-2"><Label htmlFor="member-role">역할</Label><select className="h-10 rounded-md border bg-background px-3 text-sm" id="member-role" name="role">{assignableRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></div>
          <Button type="submit"><UserPlus className="size-4" /> 추가·변경</Button>
        </Form>
      </section>
      <ul className="mt-6 grid gap-3">
        {loaderData.members.map((member) => (
          <li className="flex flex-col gap-3 rounded-2xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between" key={member.user_id}>
            <div><p className="font-medium">{member.email}</p><p className="mt-1 text-sm text-muted-foreground">{roleLabels[member.role] ?? member.role}</p></div>
            {member.role !== "owner" ? <Form method="post"><input name="intent" type="hidden" value="remove" /><input name="user_id" type="hidden" value={member.user_id} /><Button size="sm" type="submit" variant="outline">제거</Button></Form> : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
