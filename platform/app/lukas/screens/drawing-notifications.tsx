import type { Route } from "./+types/drawing-notifications";

import { Bell, Check, ExternalLink } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";

import { Button } from "~/core/components/ui/button";
import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import makeServerClient from "~/core/lib/supa-client.server";
import { authMagicLinkPath } from "~/features/auth/lib/auth-link.server";

type NotificationRow = {
  id: string;
  project_id: string;
  issue_id: string;
  event_id: string;
  user_id: string;
  read_at: string | null;
  created_at: string;
};
type IssueRow = { id: string; title: string; status: string };
type EventRow = { id: string; event_type: string; note: string };
type AnchorRow = { issue_id: string; file_id: string; created_at: string };

export const meta: Route.MetaFunction = () => [
  { title: "알림 작업함 | 1HK Platform" },
];

async function authenticatedClient(request: Request) {
  const [client, headers] = makeServerClient(request);
  const { data: auth, error } = await client.auth.getUser();
  if (error || !auth.user || auth.user.is_anonymous)
    throw redirect(authMagicLinkPath(request.url), { headers });
  return { client, headers, user: auth.user };
}

export async function loader({ request }: Route.LoaderArgs) {
  const { client, headers, user } = await authenticatedClient(request);
  const notificationClient = client as any;
  const { data: notifications, error } = await notificationClient
    .from("lukas_drawing_notifications")
    .select("id,project_id,issue_id,event_id,user_id,read_at,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error)
    throw mergeResponseHeaders(
      new Response(`알림을 불러오지 못했습니다: ${error.message}`, {
        status: 500,
      }),
      headers,
    );
  const rows = (notifications ?? []) as NotificationRow[];
  const issueIds = [...new Set(rows.map((row) => row.issue_id))];
  const eventIds = [...new Set(rows.map((row) => row.event_id))];
  const [issuesResult, eventsResult, anchorsResult] = await Promise.all([
    issueIds.length
      ? notificationClient
          .from("lukas_drawing_issues")
          .select("id,title,status")
          .in("id", issueIds)
      : Promise.resolve({ data: [], error: null }),
    eventIds.length
      ? notificationClient
          .from("lukas_drawing_issue_events")
          .select("id,event_type,note")
          .in("id", eventIds)
      : Promise.resolve({ data: [], error: null }),
    issueIds.length
      ? notificationClient
          .from("lukas_drawing_issue_anchors")
          .select("issue_id,file_id,created_at")
          .in("issue_id", issueIds)
          .eq("active", true)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const relatedError =
    issuesResult.error ?? eventsResult.error ?? anchorsResult.error;
  if (relatedError)
    throw mergeResponseHeaders(
      new Response(`알림 상세를 불러오지 못했습니다: ${relatedError.message}`, {
        status: 500,
      }),
      headers,
    );
  const issues = new Map(
    ((issuesResult.data ?? []) as IssueRow[]).map((row) => [row.id, row]),
  );
  const events = new Map(
    ((eventsResult.data ?? []) as EventRow[]).map((row) => [row.id, row]),
  );
  const fileByIssue = new Map<string, string>();
  for (const anchor of (anchorsResult.data ?? []) as AnchorRow[])
    if (!fileByIssue.has(anchor.issue_id))
      fileByIssue.set(anchor.issue_id, anchor.file_id);
  return data(
    {
      notifications: rows.map((row) => ({
        ...row,
        issue: issues.get(row.issue_id) ?? null,
        event: events.get(row.event_id) ?? null,
        fileId: fileByIssue.get(row.issue_id) ?? null,
      })),
    },
    { headers },
  );
}

export async function action({ request }: Route.ActionArgs) {
  const { client, headers, user } = await authenticatedClient(request);
  const form = await request.formData();
  if (form.get("intent") !== "mark_read")
    return data(
      { ok: false, error: "지원하지 않는 요청입니다." },
      { status: 400, headers },
    );
  const id = form.get("notification_id");
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
    return data(
      { ok: false, error: "알림 ID가 올바르지 않습니다." },
      { status: 400, headers },
    );
  const { error } = await (client as any)
    .from("lukas_drawing_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("read_at", null);
  if (error)
    return data({ ok: false, error: error.message }, { status: 400, headers });
  return data({ ok: true, error: null }, { headers });
}

const eventLabels: Record<string, string> = {
  created: "이슈가 등록되었습니다",
  status_changed: "이슈 상태가 변경되었습니다",
  assignee_changed: "담당자가 변경되었습니다",
  due_changed: "기한이 변경되었습니다",
  priority_changed: "우선순위가 변경되었습니다",
  anchor_added: "도면 근거가 연결되었습니다",
  anchor_deactivated: "도면 근거가 해제되었습니다",
  comment_added: "새 댓글이 등록되었습니다",
  approval_recorded: "승인 또는 반려 결정이 기록되었습니다",
};

export default function DrawingNotifications({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const unread = loaderData.notifications.filter(
    (item) => !item.read_at,
  ).length;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8 sm:px-6">
      <Link
        className="text-sm text-muted-foreground underline underline-offset-4"
        to="/workspace"
      >
        ← 프로젝트
      </Link>
      <header className="mt-5 flex items-start justify-between gap-4 border-b pb-5">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Bell className="size-4" /> 협업 알림
          </p>
          <h1 className="mt-2 text-3xl font-bold">알림 작업함</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            내가 만든 이슈, 내게 배정된 일, 확인 요청을 한곳에서 봅니다.
          </p>
        </div>
        <span className="rounded-full bg-primary px-3 py-1 text-sm font-bold text-primary-foreground">
          안 읽음 {unread}
        </span>
      </header>
      {actionData?.error ? (
        <p
          className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {actionData.error}
        </p>
      ) : null}
      <div className="mt-6 space-y-3">
        {loaderData.notifications.map((item) => (
          <article
            className={`rounded-2xl border p-4 ${item.read_at ? "bg-muted/30" : "border-primary/40 bg-primary/5"}`}
            key={item.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-muted-foreground">
                  {eventLabels[item.event?.event_type ?? ""] ??
                    "도면 이슈가 변경되었습니다"}
                </p>
                <h2 className="mt-1 truncate font-bold">
                  {item.issue?.title ?? "삭제되거나 접근할 수 없는 이슈"}
                </h2>
                <p className="mt-2 text-xs text-muted-foreground">
                  {new Date(item.created_at).toLocaleString("ko-KR")}
                </p>
              </div>
              {!item.read_at ? (
                <Form method="post">
                  <input name="intent" type="hidden" value="mark_read" />
                  <input name="notification_id" type="hidden" value={item.id} />
                  <Button
                    className="min-h-11"
                    size="sm"
                    type="submit"
                    variant="outline"
                  >
                    <Check className="size-4" /> 읽음 처리
                  </Button>
                </Form>
              ) : null}
            </div>
            <Button asChild className="mt-3 min-h-11" variant="ghost">
              <Link
                to={
                  item.fileId
                    ? `/projects/${item.project_id}/drawings/${item.fileId}?issue=${item.issue_id}`
                    : `/projects/${item.project_id}/drawings`
                }
              >
                <ExternalLink className="size-4" /> 프로젝트 도면 열기
              </Link>
            </Button>
          </article>
        ))}
        {loaderData.notifications.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            아직 받은 알림이 없습니다.
          </p>
        ) : null}
      </div>
    </main>
  );
}
