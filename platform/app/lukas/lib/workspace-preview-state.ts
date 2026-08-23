export type PreviewIssueStatus = "open" | "in_progress" | "closed";
export type PreviewPriority = "low" | "normal" | "high" | "urgent";

export type PreviewAssignee = {
  id: string;
  name: string;
  role: "reviewer" | "estimator" | "site";
};

export const previewAssignees: PreviewAssignee[] = [
  { id: "preview-user-reviewer", name: "김검토", role: "reviewer" },
  { id: "preview-user-estimator", name: "이적산", role: "estimator" },
  { id: "preview-user-site", name: "박현장", role: "site" },
];

export type PreviewIssue = {
  id: string;
  title: string;
  description: string;
  status: PreviewIssueStatus;
  priority: PreviewPriority;
  assigneeId: string | null;
  dueDate: string | null;
  createdAt: string;
};

export type PreviewComment = {
  id: string;
  issueId: string;
  body: string;
  createdAt: string;
};

export type PreviewAnchor = {
  id: string;
  issueId: string;
  kind: "preview_element" | "ifc_element" | "pdf_region";
  label: string;
};

export type PreviewEventKind =
  | "created"
  | "comment_added"
  | "anchor_added"
  | "status_changed"
  | "assignee_changed"
  | "due_changed"
  | "priority_changed";

export type PreviewEvent = {
  id: string;
  issueId: string;
  kind: PreviewEventKind;
  detail: string;
  createdAt: string;
};

export type PreviewNotification = {
  id: string;
  issueId: string;
  recipientId: string;
  message: string;
  read: boolean;
  createdAt: string;
};

export type PreviewRevisionReview = {
  id: string;
  issueId: string;
  previousAnchorLabel: string;
  previousFileName: string;
  currentFileName: string;
  status: "needs_reanchor" | "resolved";
  replacementAnchorLabel: string | null;
};

export type PreviewRoomState = {
  issues: PreviewIssue[];
  comments: PreviewComment[];
  anchors: PreviewAnchor[];
  events: PreviewEvent[];
  notifications: PreviewNotification[];
  revisionReviews: PreviewRevisionReview[];
};

function identifier(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function timestamp() {
  return new Date().toISOString();
}

function requireIssue(state: PreviewRoomState, issueId: string) {
  if (!state.issues.some((issue) => issue.id === issueId)) {
    throw new Error("선택한 이슈를 찾을 수 없습니다.");
  }
}

function event(
  issueId: string,
  kind: PreviewEventKind,
  detail: string,
): PreviewEvent {
  return {
    id: identifier("event"),
    issueId,
    kind,
    detail,
    createdAt: timestamp(),
  };
}

export function defaultPreviewRoomState(): PreviewRoomState {
  return {
    issues: [
      {
        id: "preview-issue-window",
        title: "창호 치수 확인",
        description: "IFC 객체와 평면도의 창호 폭이 같은지 확인합니다.",
        status: "open",
        priority: "high",
        assigneeId: "preview-user-reviewer",
        dueDate: "2026-08-28",
        createdAt: "2026-08-23T09:00:00.000Z",
      },
      {
        id: "preview-issue-wall",
        title: "외벽 마감 범위 검토",
        description: "입면도 기준 마감 구간을 확인합니다.",
        status: "in_progress",
        priority: "normal",
        assigneeId: "preview-user-site",
        dueDate: "2026-08-30",
        createdAt: "2026-08-23T09:05:00.000Z",
      },
    ],
    comments: [
      {
        id: "preview-comment-1",
        issueId: "preview-issue-window",
        body: "설계자 확인이 필요합니다.",
        createdAt: "2026-08-23T09:10:00.000Z",
      },
    ],
    anchors: [
      {
        id: "preview-anchor-1",
        issueId: "preview-issue-window",
        kind: "preview_element",
        label: "창호 W-01",
      },
    ],
    events: [
      {
        id: "preview-event-1",
        issueId: "preview-issue-window",
        kind: "created",
        detail: "김검토 담당으로 이슈 생성",
        createdAt: "2026-08-23T09:00:00.000Z",
      },
      {
        id: "preview-event-2",
        issueId: "preview-issue-window",
        kind: "comment_added",
        detail: "댓글 등록",
        createdAt: "2026-08-23T09:10:00.000Z",
      },
    ],
    notifications: [
      {
        id: "preview-notification-1",
        issueId: "preview-issue-window",
        recipientId: "preview-user-reviewer",
        message: "창호 치수 확인 이슈가 배정되었습니다.",
        read: false,
        createdAt: "2026-08-23T09:00:00.000Z",
      },
    ],
    revisionReviews: [
      {
        id: "preview-revision-1",
        issueId: "preview-issue-window",
        previousAnchorLabel: "창호 W-01",
        previousFileName: "A-101 Rev.1.pdf",
        currentFileName: "A-101 Rev.2.pdf",
        status: "needs_reanchor",
        replacementAnchorLabel: null,
      },
    ],
  };
}

export function createPreviewIssue(
  state: PreviewRoomState,
  input: {
    title: string;
    description: string;
    priority?: PreviewPriority;
    assigneeId?: string | null;
    dueDate?: string | null;
  },
): PreviewRoomState {
  const title = input.title.trim();
  if (!title) throw new Error("이슈 제목을 입력하세요.");
  const assignee = input.assigneeId
    ? previewAssignees.find((candidate) => candidate.id === input.assigneeId)
    : null;
  if (input.assigneeId && !assignee)
    throw new Error("담당자를 찾을 수 없습니다.");
  const issue: PreviewIssue = {
    id: identifier("issue"),
    title,
    description: input.description.trim(),
    status: "open",
    priority: input.priority ?? "normal",
    assigneeId: input.assigneeId ?? null,
    dueDate: input.dueDate ?? null,
    createdAt: timestamp(),
  };
  const notification: PreviewNotification | null = assignee
    ? {
        id: identifier("notification"),
        issueId: issue.id,
        recipientId: assignee.id,
        message: `${issue.title} 이슈가 배정되었습니다.`,
        read: false,
        createdAt: timestamp(),
      }
    : null;
  return {
    ...state,
    issues: [...state.issues, issue],
    events: [...state.events, event(issue.id, "created", "이슈 생성")],
    notifications: notification
      ? [...state.notifications, notification]
      : state.notifications,
  };
}

export function addPreviewComment(
  state: PreviewRoomState,
  issueId: string,
  bodyValue: string,
): PreviewRoomState {
  requireIssue(state, issueId);
  const body = bodyValue.trim();
  if (!body) throw new Error("댓글을 입력하세요.");
  return {
    ...state,
    comments: [
      ...state.comments,
      { id: identifier("comment"), issueId, body, createdAt: timestamp() },
    ],
    events: [...state.events, event(issueId, "comment_added", "댓글 등록")],
  };
}

export function addPreviewAnchor(
  state: PreviewRoomState,
  issueId: string,
  anchor: Pick<PreviewAnchor, "kind" | "label">,
): PreviewRoomState {
  requireIssue(state, issueId);
  const label = anchor.label.trim();
  if (!label) throw new Error("도면 근거 이름이 필요합니다.");
  return {
    ...state,
    anchors: [
      ...state.anchors,
      { id: identifier("anchor"), issueId, kind: anchor.kind, label },
    ],
    events: [...state.events, event(issueId, "anchor_added", `${label} 연결`)],
    revisionReviews: state.revisionReviews.map((review) =>
      review.issueId === issueId && review.status === "needs_reanchor"
        ? { ...review, status: "resolved", replacementAnchorLabel: label }
        : review,
    ),
  };
}

export function updatePreviewIssueStatus(
  state: PreviewRoomState,
  issueId: string,
  status: PreviewIssueStatus,
): PreviewRoomState {
  requireIssue(state, issueId);
  return {
    ...state,
    issues: state.issues.map((issue) =>
      issue.id === issueId ? { ...issue, status } : issue,
    ),
    events: [
      ...state.events,
      event(issueId, "status_changed", `상태를 ${status}로 변경`),
    ],
  };
}

export function updatePreviewIssueAssignment(
  state: PreviewRoomState,
  issueId: string,
  assigneeId: string | null,
): PreviewRoomState {
  requireIssue(state, issueId);
  const assignee = assigneeId
    ? previewAssignees.find((candidate) => candidate.id === assigneeId)
    : null;
  if (assigneeId && !assignee) throw new Error("담당자를 찾을 수 없습니다.");
  const notification: PreviewNotification | null = assignee
    ? {
        id: identifier("notification"),
        issueId,
        recipientId: assignee.id,
        message: `${state.issues.find((issue) => issue.id === issueId)?.title} 이슈가 배정되었습니다.`,
        read: false,
        createdAt: timestamp(),
      }
    : null;
  return {
    ...state,
    issues: state.issues.map((issue) =>
      issue.id === issueId ? { ...issue, assigneeId } : issue,
    ),
    events: [
      ...state.events,
      event(issueId, "assignee_changed", assignee?.name ?? "담당자 해제"),
    ],
    notifications: notification
      ? [...state.notifications, notification]
      : state.notifications,
  };
}

export function updatePreviewIssueSchedule(
  state: PreviewRoomState,
  issueId: string,
  input: { dueDate: string | null; priority: PreviewPriority },
): PreviewRoomState {
  requireIssue(state, issueId);
  const current = state.issues.find((issue) => issue.id === issueId)!;
  const events = [...state.events];
  if (current.dueDate !== input.dueDate)
    events.push(event(issueId, "due_changed", input.dueDate ?? "기한 해제"));
  if (current.priority !== input.priority)
    events.push(event(issueId, "priority_changed", input.priority));
  return {
    ...state,
    issues: state.issues.map((issue) =>
      issue.id === issueId
        ? { ...issue, dueDate: input.dueDate, priority: input.priority }
        : issue,
    ),
    events,
  };
}

export function markPreviewNotificationRead(
  state: PreviewRoomState,
  notificationId: string,
): PreviewRoomState {
  if (!state.notifications.some((item) => item.id === notificationId))
    throw new Error("알림을 찾을 수 없습니다.");
  return {
    ...state,
    notifications: state.notifications.map((item) =>
      item.id === notificationId ? { ...item, read: true } : item,
    ),
  };
}
