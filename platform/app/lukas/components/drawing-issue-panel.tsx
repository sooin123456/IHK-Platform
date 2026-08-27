import { useMemo } from "react";

import {
  CheckCircle2,
  History,
  Link2,
  MessageSquarePlus,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { Form, Link, useLocation } from "react-router";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import {
  canAssignDrawingIssue,
  canRecordDrawingApproval,
  canTransitionDrawingIssue,
  drawingIssueStatuses,
  type DrawingProjectRole,
} from "~/lukas/lib/drawing-collaboration-policy";
import type { DrawingIssue } from "~/lukas/lib/drawing-collaboration.types";
import {
  drawingIssuePageHref,
  type DrawingIssuePageInfo,
} from "~/lukas/lib/drawing-pagination";
import type {
  DrawingApprovalRow,
  DrawingAnchorRow,
  DrawingAssignee,
  DrawingEventRow,
} from "~/lukas/lib/drawing-collaboration.server";
import type { DrawingRevisionReviewItem } from "~/lukas/lib/drawing-revision.server";
import { drawingAnchorHref } from "~/lukas/lib/drawing-anchor-navigation";

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
const roleLabels: Record<string, string> = {
  owner: "프로젝트 소유자",
  staff: "운영 담당",
  reviewer: "검토·승인",
  estimator: "적산 담당",
  site: "현장 담당",
  procurement: "구매 담당",
  viewer: "조회 전용",
};
const eventLabels: Record<string, string> = {
  created: "이슈 생성",
  status_changed: "상태 변경",
  assignee_changed: "담당자 변경",
  due_changed: "기한 변경",
  priority_changed: "우선순위 변경",
  anchor_added: "도면 근거 연결",
  anchor_deactivated: "도면 근거 해제",
  comment_added: "댓글 등록",
  approval_recorded: "승인 결정",
};

function assigneeLabel(assignee: DrawingAssignee) {
  return `${roleLabels[assignee.role] ?? assignee.role} · ${assignee.userId.slice(0, 8)}`;
}

export default function DrawingIssuePanel({
  issues,
  issuePage,
  comments,
  role,
  selectedIssueId,
  onSelectIssue,
  pendingAnchor,
  projectId,
  currentFileId,
  revisionReview,
  relinkCandidate,
  relinkNewAnchorId,
  onFocusRelinkCandidate,
  onCancelRelinkCandidate,
  assignees,
  anchors,
  approvals,
  currentUserId,
  events,
}: {
  issues: DrawingIssue[];
  issuePage: DrawingIssuePageInfo;
  comments: Comment[];
  role: DrawingProjectRole;
  selectedIssueId: string | null;
  onSelectIssue: (issueId: string) => void;
  pendingAnchor: object | null;
  projectId: string;
  currentFileId: string;
  revisionReview: DrawingRevisionReviewItem[];
  relinkCandidate: DrawingRevisionReviewItem | null;
  relinkNewAnchorId: string | null;
  onFocusRelinkCandidate: (candidate: DrawingRevisionReviewItem) => void;
  onCancelRelinkCandidate: () => void;
  assignees: DrawingAssignee[];
  anchors: DrawingAnchorRow[];
  approvals: DrawingApprovalRow[];
  currentUserId: string;
  events: DrawingEventRow[];
}) {
  const location = useLocation();
  const selected = issues.find((issue) => issue.id === selectedIssueId) ?? null;
  const selectedComments = useMemo(
    () => comments.filter((comment) => comment.issue_id === selected?.id),
    [comments, selected?.id],
  );
  const selectedAnchors = useMemo(
    () => anchors.filter((anchor) => anchor.issue_id === selected?.id),
    [anchors, selected?.id],
  );
  const selectedEvents = useMemo(
    () => events.filter((event) => event.issue_id === selected?.id),
    [events, selected?.id],
  );
  const selectedApprovals = useMemo(
    () => approvals.filter((approval) => approval.issue_id === selected?.id),
    [approvals, selected?.id],
  );
  const mayWrite = role !== "viewer";
  const statusOptions = selected
    ? drawingIssueStatuses.filter(
        (status) =>
          status !== selected.status &&
          canTransitionDrawingIssue(role, selected.status, status),
      )
    : [];

  return (
    <section aria-label="도면 이슈" className="rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">도면 이슈</h2>
        <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold">
          전체 {issuePage.totalCount}건
        </span>
      </div>

      {revisionReview.length > 0 ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="flex items-center gap-2 text-sm font-bold">
            <RefreshCw className="size-4" /> 개정 도면 재검토{" "}
            {revisionReview.length}건
          </p>
          <p className="mt-1 text-xs opacity-80">
            이전 근거는 보존됩니다. 새 도면에서 위치를 확인한 뒤 다시
            연결하세요.
          </p>
          <div className="mt-3 space-y-2">
            {revisionReview.map((item) => (
              <div
                className="rounded-lg bg-background/80 p-2"
                key={item.previousAnchorId}
              >
                <p className="text-xs font-semibold">{item.issueTitle}</p>
                <p className="mt-2 text-xs">
                  {item.kind === "ifc_candidate" && item.ifcGlobalId
                    ? "같은 IFC 객체 후보를 먼저 확인한 뒤 새 근거로 명시적으로 선택하세요."
                    : item.sourceKind === "ifc_element"
                      ? "같은 IFC 객체가 확인되지 않았습니다. 새 도면에서 객체를 다시 선택하세요."
                      : "PDF 좌표는 자동 복사하지 않습니다. 새 도면에서 영역을 다시 선택하세요."}
                </p>
                <button
                  aria-pressed={
                    relinkCandidate?.previousAnchorId === item.previousAnchorId
                  }
                  className="mt-2 inline-flex min-h-10 items-center text-xs font-semibold text-primary underline underline-offset-4"
                  onClick={() => onFocusRelinkCandidate(item)}
                  type="button"
                >
                  {relinkCandidate?.previousAnchorId === item.previousAnchorId
                    ? "검토 중인 후보"
                    : "후보 검토"}
                </button>
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
              <select
                className="mt-1 min-h-11 w-full rounded-lg border bg-background px-2 text-sm"
                defaultValue="normal"
                id="issue-priority"
                name="priority"
              >
                <option value="low">낮음</option>
                <option value="normal">보통</option>
                <option value="high">높음</option>
                <option value="urgent">긴급</option>
              </select>
            </div>
            <div>
              <Label htmlFor="issue-create-due">기한</Label>
              <Input
                className="mt-1 min-h-11"
                id="issue-create-due"
                name="due_at"
                type="date"
              />
            </div>
          </div>
          {canAssignDrawingIssue(role) ? (
            <div>
              <Label htmlFor="issue-create-assignee">담당자</Label>
              <select
                className="mt-1 min-h-11 w-full rounded-lg border bg-background px-2 text-sm"
                defaultValue=""
                id="issue-create-assignee"
                name="assignee_user_id"
              >
                <option value="">나중에 지정</option>
                {assignees.map((assignee) => (
                  <option key={assignee.userId} value={assignee.userId}>
                    {assigneeLabel(assignee)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
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
              {issue.assignee_user_id
                ? `담당 ${issue.assignee_user_id.slice(0, 8)}`
                : "담당자 없음"}
            </p>
          </button>
        ))}
        {issues.length === 0 ? (
          <p className="rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">
            아직 등록된 이슈가 없습니다.
          </p>
        ) : null}
      </div>

      {issuePage.totalPages > 1 ? (
        <nav
          aria-label="도면 이슈 페이지"
          className="mt-4 flex items-center justify-between gap-3 border-t pt-4 text-sm"
        >
          {issuePage.page > 1 ? (
            <Link
              className="inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
              to={drawingIssuePageHref(location.search, issuePage.page - 1)}
            >
              이전 50건
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-muted-foreground">
            {issuePage.page} / {issuePage.totalPages}쪽
          </span>
          {issuePage.page < issuePage.totalPages ? (
            <Link
              className="inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
              to={drawingIssuePageHref(location.search, issuePage.page + 1)}
            >
              다음 50건
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      {selected ? (
        <div className="mt-5 border-t pt-4">
          <h3 className="font-bold">{selected.title}</h3>
          {selected.description ? (
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {selected.description}
            </p>
          ) : null}

          {pendingAnchor &&
          mayWrite &&
          relinkCandidate &&
          relinkNewAnchorId &&
          relinkCandidate.issueId === selected.id &&
          (pendingAnchor as { kind?: unknown }).kind ===
            relinkCandidate.sourceKind ? (
            <Form
              aria-label="개정 근거 원자적 교체"
              className="mt-4 space-y-3 rounded-xl border border-amber-300 p-3"
              method="post"
            >
              <input name="intent" type="hidden" value="relink_anchor" />
              <input
                name="previous_anchor_id"
                type="hidden"
                value={relinkCandidate.previousAnchorId}
              />
              <input
                name="new_anchor_id"
                type="hidden"
                value={relinkNewAnchorId}
              />
              <input
                name="current_file_id"
                type="hidden"
                value={currentFileId}
              />
              <input
                name="anchor_json"
                type="hidden"
                value={JSON.stringify(pendingAnchor)}
              />
              <Label htmlFor={`relink-note-${selected.id}`}>
                교체 검토 메모
              </Label>
              <Input
                className="min-h-11"
                id={`relink-note-${selected.id}`}
                name="note"
                placeholder="새 개정본에서 확인한 내용"
                required
              />
              <p className="text-xs text-muted-foreground">
                확인 시 이전 근거 해제와 새 근거 활성화를 한 번에 저장합니다.
                실패하면 이전 활성 근거가 그대로 유지됩니다.
              </p>
              <div className="flex gap-2">
                <Button className="min-h-11 flex-1" type="submit">
                  <RefreshCw className="size-4" /> 원자적으로 근거 교체 확인
                </Button>
                <Button
                  className="min-h-11"
                  onClick={onCancelRelinkCandidate}
                  type="button"
                  variant="outline"
                >
                  취소
                </Button>
              </div>
            </Form>
          ) : pendingAnchor && mayWrite && !relinkCandidate ? (
            <Form className="mt-4" method="post">
              <input name="intent" type="hidden" value="add_anchor" />
              <input name="issue_id" type="hidden" value={selected.id} />
              <input
                name="anchor_json"
                type="hidden"
                value={JSON.stringify(pendingAnchor)}
              />
              <Button
                className="min-h-11 w-full"
                type="submit"
                variant="outline"
              >
                <Link2 className="size-4" /> 선택한 도면 근거 연결
              </Button>
            </Form>
          ) : null}

          <section className="mt-5" aria-label="연결된 도면 근거">
            <h4 className="text-sm font-bold">연결된 도면 근거</h4>
            <div className="mt-2 space-y-2">
              {selectedAnchors.map((anchor) => (
                <div
                  className={`rounded-xl border p-3 text-sm ${anchor.active ? "" : "opacity-60"}`}
                  key={anchor.id}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        {anchor.label ||
                          (anchor.anchor_kind === "ifc_element"
                            ? `IFC 객체 #${anchor.element_id}`
                            : `PDF ${anchor.page_number}쪽`)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {anchor.anchor_kind === "ifc_element"
                          ? "IFC 객체 근거"
                          : "PDF 영역 근거"}{" "}
                        · {anchor.active ? "사용 중" : "해제됨"}
                      </p>
                      {anchor.replaces_anchor_id ? (
                        <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                          이전 근거 {anchor.replaces_anchor_id.slice(0, 8)} 교체
                        </p>
                      ) : null}
                    </div>
                    <Link
                      className="shrink-0 text-xs font-semibold text-primary underline underline-offset-4"
                      to={drawingAnchorHref(projectId, anchor)}
                    >
                      열기
                    </Link>
                  </div>
                  {anchor.active && mayWrite ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        근거 해제
                      </summary>
                      <Form className="mt-2 flex gap-2" method="post">
                        <input
                          name="intent"
                          type="hidden"
                          value="deactivate_anchor"
                        />
                        <input
                          name="anchor_id"
                          type="hidden"
                          value={anchor.id}
                        />
                        <Input
                          className="min-h-11"
                          name="note"
                          placeholder="해제 사유"
                          required
                        />
                        <Button
                          className="min-h-11"
                          type="submit"
                          variant="outline"
                        >
                          해제
                        </Button>
                      </Form>
                    </details>
                  ) : null}
                </div>
              ))}
              {selectedAnchors.length === 0 ? (
                <p className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
                  아직 연결된 도면 근거가 없습니다.
                </p>
              ) : null}
            </div>
          </section>

          {mayWrite ? (
            <div className="mt-4 grid gap-3">
              {statusOptions.length > 0 ? (
                <Form method="post">
                  <input name="intent" type="hidden" value="set_status" />
                  <input name="issue_id" type="hidden" value={selected.id} />
                  <input
                    name="expected_version"
                    type="hidden"
                    value={selected.version}
                  />
                  <Label htmlFor={`status-${selected.id}`}>상태</Label>
                  <div className="mt-1 flex gap-2">
                    <select
                      className="min-h-11 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm"
                      defaultValue=""
                      id={`status-${selected.id}`}
                      name="status"
                      required
                    >
                      <option disabled value="">
                        다음 상태 선택
                      </option>
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {statusLabels[status]}
                        </option>
                      ))}
                    </select>
                    <Button className="min-h-11" type="submit">
                      <CheckCircle2 className="size-4" /> 저장
                    </Button>
                  </div>
                </Form>
              ) : null}
              {canAssignDrawingIssue(role) ? (
                <>
                  <Form method="post">
                    <input name="intent" type="hidden" value="set_assignee" />
                    <input name="issue_id" type="hidden" value={selected.id} />
                    <input
                      name="expected_version"
                      type="hidden"
                      value={selected.version}
                    />
                    <Label htmlFor={`assignee-${selected.id}`}>담당자</Label>
                    <div className="mt-1 flex gap-2">
                      <select
                        className="min-h-11 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm"
                        defaultValue={selected.assignee_user_id ?? ""}
                        id={`assignee-${selected.id}`}
                        name="assignee_user_id"
                      >
                        <option value="">담당자 해제</option>
                        {assignees.map((assignee) => (
                          <option key={assignee.userId} value={assignee.userId}>
                            {assigneeLabel(assignee)}
                          </option>
                        ))}
                      </select>
                      <Button
                        className="min-h-11"
                        type="submit"
                        variant="outline"
                      >
                        지정
                      </Button>
                    </div>
                  </Form>
                  <Form method="post">
                    <input name="intent" type="hidden" value="set_priority" />
                    <input name="issue_id" type="hidden" value={selected.id} />
                    <input
                      name="expected_version"
                      type="hidden"
                      value={selected.version}
                    />
                    <Label htmlFor={`priority-${selected.id}`}>우선순위</Label>
                    <div className="mt-1 flex gap-2">
                      <select
                        className="min-h-11 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm"
                        defaultValue={selected.priority}
                        id={`priority-${selected.id}`}
                        name="priority"
                      >
                        <option value="low">낮음</option>
                        <option value="normal">보통</option>
                        <option value="high">높음</option>
                        <option value="urgent">긴급</option>
                      </select>
                      <Button
                        className="min-h-11"
                        type="submit"
                        variant="outline"
                      >
                        저장
                      </Button>
                    </div>
                  </Form>
                  <Form method="post">
                    <input name="intent" type="hidden" value="set_due" />
                    <input name="issue_id" type="hidden" value={selected.id} />
                    <input
                      name="expected_version"
                      type="hidden"
                      value={selected.version}
                    />
                    <Label htmlFor={`due-${selected.id}`}>기한</Label>
                    <div className="mt-1 flex gap-2">
                      <Input
                        className="min-h-11"
                        id={`due-${selected.id}`}
                        name="due_at"
                        type="date"
                        defaultValue={selected.due_at?.slice(0, 10) ?? ""}
                      />
                      <Button
                        className="min-h-11"
                        type="submit"
                        variant="outline"
                      >
                        저장
                      </Button>
                    </div>
                  </Form>
                </>
              ) : null}
            </div>
          ) : null}

          {selected.status === "resolution_requested" ? (
            <section className="mt-5 rounded-xl border border-primary/30 bg-primary/5 p-3">
              <h4 className="text-sm font-bold">승인 또는 반려</h4>
              {canRecordDrawingApproval(
                role,
                currentUserId,
                selected.created_by,
                selected.status,
              ) ? (
                <Form className="mt-3 space-y-3" method="post">
                  <input name="intent" type="hidden" value="record_approval" />
                  <input name="issue_id" type="hidden" value={selected.id} />
                  <input
                    name="subject_version"
                    type="hidden"
                    value={selected.version}
                  />
                  <div>
                    <Label htmlFor={`decision-${selected.id}`}>검토 결정</Label>
                    <select
                      className="mt-1 min-h-11 w-full rounded-lg border bg-background px-2 text-sm"
                      defaultValue=""
                      id={`decision-${selected.id}`}
                      name="decision"
                      required
                    >
                      <option disabled value="">
                        결정을 선택하세요
                      </option>
                      <option value="approved">승인</option>
                      <option value="rejected">반려</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor={`approval-note-${selected.id}`}>
                      검토 의견
                    </Label>
                    <textarea
                      className="mt-1 min-h-24 w-full rounded-lg border bg-background p-3 text-sm"
                      id={`approval-note-${selected.id}`}
                      name="note"
                      placeholder="확인한 근거와 결정 사유를 남겨주세요."
                      required
                    />
                  </div>
                  <Button className="min-h-11 w-full" type="submit">
                    결정 기록
                  </Button>
                </Form>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  다른 검토자가 승인 또는 반려해야 합니다. 작성자는 자신의
                  이슈를 승인할 수 없습니다.
                </p>
              )}
            </section>
          ) : null}

          <section className="mt-5 border-t pt-4" aria-label="승인 기록">
            <h4 className="text-sm font-bold">승인 기록</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              승인과 반려 결정은 수정하거나 삭제하지 않고 계속 보존합니다.
            </p>
            <ol className="mt-2 space-y-2">
              {selectedApprovals.map((approval) => (
                <li
                  className="rounded-lg bg-muted/50 p-3 text-xs"
                  key={approval.id}
                >
                  <p className="font-semibold">
                    {approval.decision === "approved" ? "승인" : "반려"} · 이슈
                    버전 {approval.subject_version}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                    {approval.note}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {new Date(approval.created_at).toLocaleString("ko-KR")} ·{" "}
                    {approval.reviewer_id.slice(0, 8)}
                  </p>
                </li>
              ))}
              {selectedApprovals.length === 0 ? (
                <li className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                  아직 기록된 승인 결정이 없습니다.
                </li>
              ) : null}
            </ol>
          </section>

          <div className="mt-5">
            <Label htmlFor={`comment-${selected.id}`}>댓글</Label>
            <div className="mt-2 space-y-2">
              {selectedComments.map((comment) => (
                <div
                  className="rounded-xl bg-muted/60 p-3 text-sm"
                  key={comment.id}
                >
                  <p className="whitespace-pre-wrap">{comment.body}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {new Date(comment.created_at).toLocaleString("ko-KR")}
                  </p>
                </div>
              ))}
            </div>
            {mayWrite ? (
              <Form className="mt-2 space-y-2" method="post">
                <input name="intent" type="hidden" value="comment" />
                <input name="issue_id" type="hidden" value={selected.id} />
                <input
                  id={`comment-id-${selected.id}`}
                  name="comment_id"
                  type="hidden"
                />
                <Input
                  className="min-h-11"
                  id={`comment-${selected.id}`}
                  name="body"
                  placeholder="댓글을 입력하세요"
                  required
                />
                <Label htmlFor={`comment-mentions-${selected.id}`}>
                  멘션할 프로젝트 멤버 (선택 항목만 알림)
                </Label>
                <select
                  className="min-h-24 w-full rounded-lg border bg-background p-2 text-sm"
                  id={`comment-mentions-${selected.id}`}
                  multiple
                  name="mentioned_user_ids"
                >
                  {assignees
                    .filter((assignee) => assignee.userId !== currentUserId)
                    .map((assignee) => (
                      <option key={assignee.userId} value={assignee.userId}>
                        {assigneeLabel(assignee)}
                      </option>
                    ))}
                </select>
                <Button
                  className="min-h-11 w-full"
                  onClick={() => {
                    const input = document.getElementById(
                      `comment-id-${selected.id}`,
                    ) as HTMLInputElement | null;
                    if (input) input.value = crypto.randomUUID();
                  }}
                  type="submit"
                >
                  등록
                </Button>
              </Form>
            ) : null}
          </div>

          <section className="mt-5 border-t pt-4" aria-label="변경 기록">
            <h4 className="flex items-center gap-2 text-sm font-bold">
              <History className="size-4" /> 변경 기록
            </h4>
            <ol className="mt-2 space-y-2">
              {selectedEvents.map((event) => (
                <li
                  className="rounded-lg bg-muted/50 p-2 text-xs"
                  key={event.id}
                >
                  <p className="font-semibold">
                    {eventLabels[event.event_type] ?? event.event_type}
                  </p>
                  {event.note ? (
                    <p className="mt-1 text-muted-foreground">{event.note}</p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {new Date(event.created_at).toLocaleString("ko-KR")} ·{" "}
                    {event.actor_id ? event.actor_id.slice(0, 8) : "시스템"}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}

      <p aria-live="polite" className="sr-only" role="status">
        {pendingAnchor ? "도면 근거가 선택되었습니다." : ""}
      </p>
    </section>
  );
}
