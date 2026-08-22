import { useMemo } from "react";

import { CheckCircle2, Link2, MessageSquarePlus, RefreshCw, UserRound } from "lucide-react";
import { Form, Link } from "react-router";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import {
  canAssignDrawingIssue,
  canTransitionDrawingIssue,
  drawingIssueStatuses,
  type DrawingProjectRole,
} from "~/lukas/lib/drawing-collaboration-policy";
import type { DrawingIssue } from "~/lukas/lib/drawing-collaboration.types";
import type { DrawingRevisionReviewItem } from "~/lukas/lib/drawing-revision.server";

type Comment = {
  id: string;
  issue_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

const statusLabels: Record<string, string> = {
  open: "열림",
  in_progress: "처리 중",
  resolution_requested: "확인 요청",
  closed: "완료",
};

export default function DrawingIssuePanel({
  issues,
  comments,
  role,
  selectedIssueId,
  onSelectIssue,
  pendingAnchor,
  projectId,
  currentFileId,
  revisionReview,
}: {
  issues: DrawingIssue[];
  comments: Comment[];
  role: DrawingProjectRole;
  selectedIssueId: string | null;
  onSelectIssue: (issueId: string) => void;
  pendingAnchor: object | null;
  projectId: string;
  currentFileId: string;
  revisionReview: DrawingRevisionReviewItem[];
}) {
  const selected = issues.find((issue) => issue.id === selectedIssueId) ?? null;
  const selectedComments = useMemo(
    () => comments.filter((comment) => comment.issue_id === selected?.id),
    [comments, selected?.id],
  );
  const mayWrite = role !== "viewer";

  return (
    <section aria-label="도면 이슈" className="rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">도면 이슈</h2>
        <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold">
          {issues.length}건
        </span>
      </div>

      {revisionReview.length > 0 ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="flex items-center gap-2 text-sm font-bold">
            <RefreshCw className="size-4" /> 개정 도면 재검토 {revisionReview.length}건
          </p>
          <p className="mt-1 text-xs opacity-80">
            이전 근거는 보존됩니다. 새 도면에서 위치를 확인한 뒤 다시 연결하세요.
          </p>
          <div className="mt-3 space-y-2">
            {revisionReview.map((item) => (
              <div className="rounded-lg bg-background/80 p-2" key={item.previousAnchorId}>
                <p className="text-xs font-semibold">{item.issueTitle}</p>
                {item.kind === "ifc_candidate" && item.ifcGlobalId ? (
                  <Link
                    className="mt-2 inline-flex min-h-10 items-center text-xs font-semibold text-primary underline underline-offset-4"
                    onClick={() => onSelectIssue(item.issueId)}
                    to={`/projects/${projectId}/drawings/${currentFileId}?globalId=${encodeURIComponent(item.ifcGlobalId)}&issue=${encodeURIComponent(item.issueId)}`}
                  >
                    같은 IFC 객체 후보 확인
                  </Link>
                ) : (
                  <p className="mt-2 text-xs">PDF 좌표는 자동 복사하지 않습니다. 새 도면에서 영역을 다시 선택하세요.</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {mayWrite ? (
        <Form className="mt-4 space-y-3 rounded-xl border p-3" method="post">
          <input name="intent" type="hidden" value="create_issue" />
          <div>
            <Label htmlFor="issue-title">이슈 제목</Label>
            <Input
              className="mt-1 min-h-11"
              id="issue-title"
              name="title"
              placeholder="예: 창호 치수 확인"
              required
            />
          </div>
          <div>
            <Label htmlFor="issue-description">설명</Label>
            <textarea
              className="mt-1 min-h-20 w-full rounded-lg border bg-background p-3 text-sm"
              id="issue-description"
              name="description"
              placeholder="확인할 내용과 기준을 적어주세요."
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="issue-priority">우선순위</Label>
              <select className="mt-1 min-h-11 w-full rounded-lg border bg-background px-2 text-sm" defaultValue="normal" id="issue-priority" name="priority">
                <option value="low">낮음</option>
                <option value="normal">보통</option>
                <option value="high">높음</option>
                <option value="urgent">긴급</option>
              </select>
            </div>
            <div>
              <Label htmlFor="issue-create-due">기한</Label>
              <Input className="mt-1 min-h-11" id="issue-create-due" name="due_at" type="date" />
            </div>
          </div>
          <Button className="min-h-11 w-full" type="submit">
            <MessageSquarePlus className="size-4" /> 이슈 만들기
          </Button>
        </Form>
      ) : (
        <p className="mt-4 rounded-xl bg-muted p-3 text-sm text-muted-foreground">
          조회 권한으로 참여 중입니다. 이슈와 근거를 확인할 수 있습니다.
        </p>
      )}

      <div className="mt-4 space-y-2">
        {issues.map((issue) => (
          <button
            aria-pressed={selected?.id === issue.id}
            className={`w-full rounded-xl border p-3 text-left ${selected?.id === issue.id ? "border-primary bg-primary/5" : "hover:bg-muted/60"}`}
            key={issue.id}
            onClick={() => onSelectIssue(issue.id)}
            type="button"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-semibold">{issue.title}</span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[11px] font-semibold">
                {statusLabels[issue.status] ?? issue.status}
              </span>
            </div>
            <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <UserRound className="size-3.5" />
              {issue.assignee_user_id ? `담당 ${issue.assignee_user_id.slice(0, 8)}` : "담당자 없음"}
            </p>
          </button>
        ))}
        {issues.length === 0 ? (
          <p className="rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">
            아직 등록된 이슈가 없습니다.
          </p>
        ) : null}
      </div>

      {selected ? (
        <div className="mt-5 border-t pt-4">
          <h3 className="font-bold">{selected.title}</h3>
          {selected.description ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{selected.description}</p> : null}

          {pendingAnchor && mayWrite ? (
            <Form className="mt-4" method="post">
              <input name="intent" type="hidden" value="add_anchor" />
              <input name="issue_id" type="hidden" value={selected.id} />
              <input name="anchor_json" type="hidden" value={JSON.stringify(pendingAnchor)} />
              <Button className="min-h-11 w-full" type="submit" variant="outline">
                <Link2 className="size-4" /> 선택한 도면 근거 연결
              </Button>
            </Form>
          ) : null}

          {mayWrite ? (
            <div className="mt-4 grid gap-3">
              <Form method="post">
                <input name="intent" type="hidden" value="set_status" />
                <input name="issue_id" type="hidden" value={selected.id} />
                <input name="expected_version" type="hidden" value={selected.version} />
                <Label htmlFor={`status-${selected.id}`}>상태</Label>
                <div className="mt-1 flex gap-2">
                  <select className="min-h-11 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm" defaultValue={selected.status} id={`status-${selected.id}`} name="status">
                    {drawingIssueStatuses.filter((status) => canTransitionDrawingIssue(role, selected.status, status)).map((status) => (
                      <option key={status} value={status}>{statusLabels[status]}</option>
                    ))}
                  </select>
                  <Button className="min-h-11" type="submit"><CheckCircle2 className="size-4" /> 저장</Button>
                </div>
              </Form>
              {canAssignDrawingIssue(role) ? (
                <Form method="post">
                  <input name="intent" type="hidden" value="set_assignee" />
                  <input name="issue_id" type="hidden" value={selected.id} />
                  <input name="expected_version" type="hidden" value={selected.version} />
                  <Label htmlFor={`assignee-${selected.id}`}>담당자</Label>
                  <div className="mt-1 flex gap-2">
                    <Input className="min-h-11" id={`assignee-${selected.id}`} name="assignee_user_id" placeholder="구성원 ID (비우면 해제)" defaultValue={selected.assignee_user_id ?? ""} />
                    <Button className="min-h-11" type="submit" variant="outline">지정</Button>
                  </div>
                </Form>
              ) : null}
              <Form method="post">
                <input name="intent" type="hidden" value="set_due" />
                <input name="issue_id" type="hidden" value={selected.id} />
                <input name="expected_version" type="hidden" value={selected.version} />
                <Label htmlFor={`due-${selected.id}`}>기한</Label>
                <div className="mt-1 flex gap-2">
                  <Input className="min-h-11" id={`due-${selected.id}`} name="due_at" type="date" defaultValue={selected.due_at?.slice(0, 10) ?? ""} />
                  <Button className="min-h-11" type="submit" variant="outline">저장</Button>
                </div>
              </Form>
            </div>
          ) : null}

          <div className="mt-5">
            <Label htmlFor={`comment-${selected.id}`}>댓글</Label>
            <div className="mt-2 space-y-2">
              {selectedComments.map((comment) => (
                <div className="rounded-xl bg-muted/60 p-3 text-sm" key={comment.id}>
                  <p className="whitespace-pre-wrap">{comment.body}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground">{new Date(comment.created_at).toLocaleString("ko-KR")}</p>
                </div>
              ))}
            </div>
            {mayWrite ? (
              <Form className="mt-2 flex gap-2" method="post">
                <input name="intent" type="hidden" value="comment" />
                <input name="issue_id" type="hidden" value={selected.id} />
                <Input className="min-h-11" id={`comment-${selected.id}`} name="body" placeholder="댓글을 입력하세요" required />
                <Button className="min-h-11" type="submit">등록</Button>
              </Form>
            ) : null}
          </div>
        </div>
      ) : null}

      <p aria-live="polite" className="sr-only" role="status">
        {pendingAnchor ? "도면 근거가 선택되었습니다." : ""}
      </p>
    </section>
  );
}
