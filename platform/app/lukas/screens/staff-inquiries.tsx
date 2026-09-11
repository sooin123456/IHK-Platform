import type { Route } from "./+types/staff-inquiries";

import { Form, Link, data, redirect } from "react-router";
import { z } from "zod";

import { Button } from "~/core/components/ui/button";
import makeServerClient from "~/core/lib/supa-client.server";
import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import { authLoginPath } from "~/features/auth/lib/auth-link.server";

const statuses = ["new", "contacted", "qualified", "closed"] as const;
const labels: Record<(typeof statuses)[number], string> = {
  new: "신규",
  contacted: "연락 완료",
  qualified: "상담 진행",
  closed: "종료",
};

async function requireStaff(request: Request) {
  const [client, headers] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous)
    throw redirect(authLoginPath(request.url), { headers });
  if (user.app_metadata.role !== "hangil_staff")
    throw mergeResponseHeaders(
      new Response("한길시스템 담당자만 접근할 수 있습니다.", {
        status: 403,
      }),
      headers,
    );
  return { client, headers };
}

export const meta: Route.MetaFunction = () => [
  { title: "문의함 | 한길시스템" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const { client, headers } = await requireStaff(request);
  const { data: inquiries, error } = await client
    .from("hangil_project_inquiries")
    .select(
      "id, name, email, phone, company, project_name, message, status, created_at",
    )
    .order("created_at", { ascending: false });
  if (error)
    throw mergeResponseHeaders(
      new Response("문의 목록을 불러오지 못했습니다.", { status: 500 }),
      headers,
    );
  return data({ inquiries: inquiries ?? [] }, { headers });
}

export async function action({ request }: Route.ActionArgs) {
  const { client, headers } = await requireStaff(request);
  const formData = await request.formData();
  const parsed = z
    .object({ id: z.string().uuid(), status: z.enum(statuses) })
    .safeParse({ id: formData.get("id"), status: formData.get("status") });
  if (!parsed.success)
    return data({ error: "문의 상태를 확인하세요." }, { status: 400, headers });
  const { error } = await client
    .from("hangil_project_inquiries")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.id);
  if (error)
    return data(
      { error: "문의 상태를 저장하지 못했습니다." },
      { status: 400, headers },
    );
  return redirect("/staff/inquiries", { headers });
}

export default function StaffInquiries({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
      <Link
        className="text-sm text-muted-foreground underline underline-offset-4"
        to="/workspace"
      >
        ← 프로젝트 공간
      </Link>
      <header className="mt-5 border-b pb-8">
        <p className="text-sm font-bold text-[#3024d8]">한길시스템 / 담당자</p>
        <h1 className="mt-2 text-3xl font-bold">프로젝트 문의함</h1>
        <p className="mt-2 text-muted-foreground">
          웹에서 접수된 상담 요청입니다. 삭제하지 않고 처리 상태만 갱신합니다.
        </p>
      </header>
      {actionData?.error ? (
        <p className="mt-5 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
          {actionData.error}
        </p>
      ) : null}
      {loaderData.inquiries.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed p-8 text-center text-muted-foreground">
          접수된 문의가 없습니다.
        </p>
      ) : (
        <ul className="mt-8 grid gap-4">
          {loaderData.inquiries.map((item) => (
            <li
              className="rounded-2xl border bg-card p-6 shadow-sm"
              key={item.id}
            >
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold">{item.project_name}</h2>
                    <span className="rounded-full bg-[#efefff] px-3 py-1 text-xs font-bold text-[#3024d8]">
                      {labels[item.status as keyof typeof labels] ??
                        item.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {item.company || "회사 미입력"} · {item.name} ·{" "}
                    <a className="underline" href={`mailto:${item.email}`}>
                      {item.email}
                    </a>
                    {item.phone ? ` · ${item.phone}` : ""}
                  </p>
                  <p className="mt-4 whitespace-pre-wrap leading-7 text-[#444b58]">
                    {item.message}
                  </p>
                  <time className="mt-4 block text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat("ko-KR", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(item.created_at))}
                  </time>
                </div>
                <Form className="flex shrink-0 gap-2" method="post">
                  <input name="id" type="hidden" value={item.id} />
                  <select
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    defaultValue={item.status}
                    name="status"
                  >
                    {statuses.map((status) => (
                      <option key={status} value={status}>
                        {labels[status]}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="outline">
                    저장
                  </Button>
                </Form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
