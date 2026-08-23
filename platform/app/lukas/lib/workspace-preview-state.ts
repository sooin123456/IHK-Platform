export type PreviewIssueStatus = "open" | "in_progress" | "closed";

export type PreviewIssue = {
  id: string;
  title: string;
  description: string;
  status: PreviewIssueStatus;
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

export type PreviewRoomState = {
  issues: PreviewIssue[];
  comments: PreviewComment[];
  anchors: PreviewAnchor[];
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

export function defaultPreviewRoomState(): PreviewRoomState {
  return {
    issues: [
      {
        id: "preview-issue-window",
        title: "창호 치수 확인",
        description: "IFC 객체와 평면도의 창호 폭이 같은지 확인합니다.",
        status: "open",
        createdAt: "2026-08-23T09:00:00.000Z",
      },
      {
        id: "preview-issue-wall",
        title: "외벽 마감 범위 검토",
        description: "입면도 기준 마감 구간을 확인합니다.",
        status: "in_progress",
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
  };
}

export function createPreviewIssue(
  state: PreviewRoomState,
  input: { title: string; description: string },
): PreviewRoomState {
  const title = input.title.trim();
  if (!title) throw new Error("이슈 제목을 입력하세요.");
  return {
    ...state,
    issues: [
      ...state.issues,
      {
        id: identifier("issue"),
        title,
        description: input.description.trim(),
        status: "open",
        createdAt: timestamp(),
      },
    ],
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
  };
}
