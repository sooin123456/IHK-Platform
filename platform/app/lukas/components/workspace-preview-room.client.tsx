import {
  ArrowLeft,
  Box,
  CheckCircle2,
  FileText,
  Link2,
  MessageSquarePlus,
  Upload,
} from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import IfcPropertyBrowser from "~/lukas/components/ifc-property-browser.client";
import PdfDrawingViewer from "~/lukas/components/pdf-drawing-viewer.client";
import {
  addPreviewAnchor,
  addPreviewComment,
  createPreviewIssue,
  defaultPreviewRoomState,
  type PreviewAnchor,
  type PreviewIssueStatus,
  type PreviewRoomState,
  updatePreviewIssueStatus,
} from "~/lukas/lib/workspace-preview-state";

type PreviewFile = {
  id: string;
  name: string;
  kind: "ifc" | "pdf";
  byteSize: number;
  url: string | null;
};

const statusLabels: Record<PreviewIssueStatus, string> = {
  open: "열림",
  in_progress: "처리 중",
  closed: "완료",
};

const initialFiles: PreviewFile[] = [
  {
    id: "preview-drawing",
    name: "건축 평면도 A-101.pdf",
    kind: "pdf",
    byteSize: 0,
    url: null,
  },
  {
    id: "preview-ifc",
    name: "근린생활시설 모델.ifc",
    kind: "ifc",
    byteSize: 0,
    url: null,
  },
];

function storedState(key: string) {
  try {
    const value = localStorage.getItem(key);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<PreviewRoomState>;
    if (
      Array.isArray(parsed.issues) &&
      Array.isArray(parsed.comments) &&
      Array.isArray(parsed.anchors)
    ) {
      return parsed as PreviewRoomState;
    }
  } catch {
    // A broken local preview cache must not block the workspace.
  }
  return null;
}

function PreviewDrawing({
  onSelect,
}: {
  onSelect: (anchor: Pick<PreviewAnchor, "kind" | "label">) => void;
}) {
  const elements = [
    { label: "외벽 W-01", className: "left-[8%] top-[22%] h-[52%] w-[10%]" },
    { label: "창호 W-01", className: "left-[38%] top-[32%] h-[20%] w-[16%]" },
    { label: "기둥 C-03", className: "right-[14%] top-[18%] h-[58%] w-[9%]" },
  ];
  return (
    <div className="relative min-h-[480px] overflow-hidden rounded-xl bg-[#eef1f4] dark:bg-[#20242a]">
      <svg
        aria-hidden="true"
        className="absolute inset-0 size-full"
        viewBox="0 0 900 560"
      >
        <rect
          fill="none"
          height="390"
          stroke="#6b7280"
          strokeWidth="5"
          width="720"
          x="90"
          y="85"
        />
        <path
          d="M90 270h720M300 85v390M610 85v390"
          fill="none"
          stroke="#94a3b8"
          strokeWidth="3"
        />
        <path
          d="M300 270h310M430 270v205"
          fill="none"
          stroke="#64748b"
          strokeDasharray="10 8"
          strokeWidth="3"
        />
        <text fill="#64748b" fontSize="24" x="110" y="125">
          A-101 1층 평면도
        </text>
      </svg>
      {elements.map((element) => (
        <button
          aria-label={`${element.label} 선택`}
          className={`absolute rounded-lg border-2 border-[#2925d9] bg-[#6e69ff]/15 transition hover:bg-[#6e69ff]/30 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2925d9]/30 ${element.className}`}
          key={element.label}
          onClick={() =>
            onSelect({ kind: "preview_element", label: element.label })
          }
          type="button"
        >
          <span className="absolute left-1 top-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-[#2925d9]">
            {element.label}
          </span>
        </button>
      ))}
      <p className="absolute bottom-4 left-4 rounded-lg bg-white/90 px-3 py-2 text-xs font-medium text-slate-700 shadow-sm">
        표시된 객체를 선택해 이슈의 도면 근거로 연결하세요.
      </p>
    </div>
  );
}

export default function WorkspacePreviewRoomClient({
  projectId,
  fileId,
}: {
  projectId: string;
  fileId: string;
}) {
  const storageKey = `onehk:workspace-preview:${projectId}`;
  const objectUrls = useRef<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState(defaultPreviewRoomState);
  const [files, setFiles] = useState(initialFiles);
  const [selectedFileId, setSelectedFileId] = useState(
    initialFiles.some((file) => file.id === fileId)
      ? fileId
      : initialFiles[0].id,
  );
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(
    state.issues[0]?.id ?? null,
  );
  const [pendingAnchor, setPendingAnchor] = useState<Pick<
    PreviewAnchor,
    "kind" | "label"
  > | null>(null);
  const [notice, setNotice] = useState("도면 객체나 영역을 선택해 보세요.");

  useEffect(() => {
    const restored = storedState(storageKey);
    if (restored) {
      setState(restored);
      setSelectedIssueId(restored.issues[0]?.id ?? null);
    }
    setLoaded(true);
  }, [storageKey]);

  useEffect(() => {
    if (loaded) localStorage.setItem(storageKey, JSON.stringify(state));
  }, [loaded, state, storageKey]);

  useEffect(
    () => () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url)),
    [],
  );

  const selectedFile =
    files.find((file) => file.id === selectedFileId) ?? files[0];
  const selectedIssue =
    state.issues.find((issue) => issue.id === selectedIssueId) ?? null;
  const selectedComments = useMemo(
    () =>
      state.comments.filter((comment) => comment.issueId === selectedIssueId),
    [selectedIssueId, state.comments],
  );
  const selectedAnchors = useMemo(
    () => state.anchors.filter((anchor) => anchor.issueId === selectedIssueId),
    [selectedIssueId, state.anchors],
  );

  function update(next: PreviewRoomState) {
    setState(next);
  }

  function chooseAnchor(anchor: Pick<PreviewAnchor, "kind" | "label">) {
    setPendingAnchor(anchor);
    setNotice(`${anchor.label}을 선택했습니다. 오른쪽에서 이슈에 연결하세요.`);
  }

  function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== "ifc" && extension !== "pdf") {
      setNotice("IFC 또는 PDF 파일만 열 수 있습니다.");
      event.target.value = "";
      return;
    }
    const url = URL.createObjectURL(file);
    objectUrls.current.push(url);
    const next: PreviewFile = {
      id: `local-${crypto.randomUUID()}`,
      name: file.name,
      kind: extension,
      byteSize: file.size,
      url,
    };
    setFiles((current) => [...current, next]);
    setSelectedFileId(next.id);
    setNotice(
      `${file.name}을 브라우저에서 열었습니다. 서버에는 저장되지 않습니다.`,
    );
    event.target.value = "";
  }

  function createIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const next = createPreviewIssue(state, {
        title: String(form.get("title") ?? ""),
        description: String(form.get("description") ?? ""),
      });
      update(next);
      setSelectedIssueId(next.issues.at(-1)?.id ?? null);
      event.currentTarget.reset();
      setNotice("새 이슈를 만들었습니다.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "이슈를 만들지 못했습니다.",
      );
    }
  }

  function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedIssueId) return;
    const form = new FormData(event.currentTarget);
    try {
      update(
        addPreviewComment(
          state,
          selectedIssueId,
          String(form.get("comment") ?? ""),
        ),
      );
      event.currentTarget.reset();
      setNotice("댓글을 추가했습니다.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "댓글을 추가하지 못했습니다.",
      );
    }
  }

  function connectAnchor() {
    if (!selectedIssueId || !pendingAnchor) return;
    update(addPreviewAnchor(state, selectedIssueId, pendingAnchor));
    setNotice(`${pendingAnchor.label}을 이슈 근거로 연결했습니다.`);
    setPendingAnchor(null);
  }

  return (
    <main className="min-h-screen bg-[#f6f7f9] px-4 pb-10 pt-5 text-[#19191d] dark:bg-[#111214] dark:text-white sm:px-6">
      <div className="mx-auto max-w-[1700px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold"
            to="/workspace-preview"
          >
            <ArrowLeft className="size-4" /> 프로젝트로 돌아가기
          </Link>
          <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900">
            로컬 미리보기 · 서버 저장 안 됨
          </span>
        </div>
        <header className="mt-3 border-b pb-5 dark:border-white/10">
          <p className="text-sm font-semibold text-[#2925d9] dark:text-[#aaa7ff]">
            근린생활시설 도면 협업 · 도면 작업실
          </p>
          <h1 className="mt-2 text-2xl font-bold">{selectedFile.name}</h1>
          <p
            aria-live="polite"
            className="mt-2 text-sm text-muted-foreground"
            role="status"
          >
            {notice}
          </p>
        </header>

        <div className="mt-5 grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)_380px]">
          <aside className="rounded-2xl border bg-white p-3 dark:border-white/10 dark:bg-[#1a1b1e]">
            <div className="flex items-center justify-between gap-2 px-2 py-2">
              <h2 className="text-sm font-bold">프로젝트 도면</h2>
              <Label
                className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-lg bg-[#2925d9] px-2.5 text-xs font-bold text-white"
                htmlFor="preview-file-upload"
              >
                <Upload className="size-3.5" /> 열기
              </Label>
              <input
                accept=".ifc,.pdf"
                className="sr-only"
                id="preview-file-upload"
                onChange={uploadFile}
                type="file"
              />
            </div>
            <div className="mt-2 space-y-1">
              {files.map((file) => {
                const Icon = file.kind === "ifc" ? Box : FileText;
                return (
                  <button
                    aria-pressed={selectedFile.id === file.id}
                    className={`flex min-h-12 w-full items-center gap-2 rounded-xl px-3 text-left text-sm ${selectedFile.id === file.id ? "bg-[#2925d9] text-white" : "hover:bg-muted"}`}
                    key={file.id}
                    onClick={() => setSelectedFileId(file.id)}
                    type="button"
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{file.name}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-4 rounded-xl bg-muted p-3 text-xs leading-5 text-muted-foreground">
              로컬 파일은 현재 브라우저에서만 열리며 업로드되지 않습니다.
            </p>
          </aside>

          <section className="min-w-0 rounded-2xl border bg-white p-3 dark:border-white/10 dark:bg-[#1a1b1e]">
            {selectedFile.url && selectedFile.kind === "ifc" ? (
              <IfcPropertyBrowser
                byteSize={selectedFile.byteSize}
                fileName={selectedFile.name}
                initialGlobalId={null}
                onAnchorSelected={(anchor) =>
                  chooseAnchor({
                    kind: "ifc_element",
                    label: `IFC 객체 #${anchor.elementId}`,
                  })
                }
                signedUrl={selectedFile.url}
              />
            ) : selectedFile.url && selectedFile.kind === "pdf" ? (
              <PdfDrawingViewer
                fileName={selectedFile.name}
                onRegionSelected={(region) =>
                  chooseAnchor({
                    kind: "pdf_region",
                    label: `${region.pageNumber}쪽 선택 영역`,
                  })
                }
                signedUrl={selectedFile.url}
              />
            ) : (
              <PreviewDrawing onSelect={chooseAnchor} />
            )}
          </section>

          <aside className="rounded-2xl border bg-white p-4 dark:border-white/10 dark:bg-[#1a1b1e]">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold">도면 이슈</h2>
              <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold">
                {state.issues.length}건
              </span>
            </div>
            <form
              className="mt-4 space-y-3 rounded-xl border p-3 dark:border-white/10"
              onSubmit={createIssue}
            >
              <div>
                <Label htmlFor="preview-issue-title">이슈 제목</Label>
                <Input
                  className="mt-1 min-h-11"
                  id="preview-issue-title"
                  name="title"
                  placeholder="예: 창호 치수 확인"
                  required
                />
              </div>
              <div>
                <Label htmlFor="preview-issue-description">설명</Label>
                <textarea
                  className="mt-1 min-h-20 w-full rounded-lg border bg-background p-3 text-sm"
                  id="preview-issue-description"
                  name="description"
                />
              </div>
              <Button className="min-h-11 w-full" type="submit">
                <MessageSquarePlus className="size-4" /> 이슈 만들기
              </Button>
            </form>

            <div className="mt-4 space-y-2">
              {state.issues.map((issue) => (
                <button
                  aria-pressed={selectedIssueId === issue.id}
                  className={`w-full rounded-xl border p-3 text-left ${selectedIssueId === issue.id ? "border-[#2925d9] bg-[#2925d9]/5" : "hover:bg-muted/60"}`}
                  key={issue.id}
                  onClick={() => setSelectedIssueId(issue.id)}
                  type="button"
                >
                  <span className="flex items-start justify-between gap-2 text-sm font-semibold">
                    {issue.title}
                    <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[10px]">
                      {statusLabels[issue.status]}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            {selectedIssue ? (
              <section className="mt-5 border-t pt-4 dark:border-white/10">
                <h3 className="font-bold">{selectedIssue.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {selectedIssue.description}
                </p>
                <div className="mt-3">
                  <Label htmlFor="preview-status">처리 상태</Label>
                  <select
                    className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3 text-sm"
                    id="preview-status"
                    onChange={(event) =>
                      update(
                        updatePreviewIssueStatus(
                          state,
                          selectedIssue.id,
                          event.target.value as PreviewIssueStatus,
                        ),
                      )
                    }
                    value={selectedIssue.status}
                  >
                    <option value="open">열림</option>
                    <option value="in_progress">처리 중</option>
                    <option value="closed">완료</option>
                  </select>
                </div>
                {pendingAnchor ? (
                  <Button
                    className="mt-3 min-h-11 w-full"
                    onClick={connectAnchor}
                    type="button"
                    variant="outline"
                  >
                    <Link2 className="size-4" /> {pendingAnchor.label} 연결
                  </Button>
                ) : null}
                <div className="mt-4">
                  <h4 className="text-sm font-bold">연결된 도면 근거</h4>
                  <ul className="mt-2 space-y-2">
                    {selectedAnchors.map((anchor) => (
                      <li
                        className="rounded-lg bg-muted p-2.5 text-xs"
                        key={anchor.id}
                      >
                        {anchor.label}
                      </li>
                    ))}
                    {selectedAnchors.length === 0 ? (
                      <li className="text-xs text-muted-foreground">
                        연결된 근거가 없습니다.
                      </li>
                    ) : null}
                  </ul>
                </div>
                <div className="mt-4">
                  <h4 className="text-sm font-bold">댓글</h4>
                  <ul className="mt-2 space-y-2">
                    {selectedComments.map((comment) => (
                      <li
                        className="rounded-lg bg-muted p-2.5 text-xs"
                        key={comment.id}
                      >
                        {comment.body}
                      </li>
                    ))}
                  </ul>
                  <form className="mt-2 flex gap-2" onSubmit={addComment}>
                    <Input
                      aria-label="댓글"
                      className="min-h-11"
                      name="comment"
                      placeholder="댓글 입력"
                      required
                    />
                    <Button className="min-h-11 shrink-0" type="submit">
                      추가
                    </Button>
                  </form>
                </div>
                {selectedIssue.status === "closed" ? (
                  <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="size-4" /> 검토 완료
                  </p>
                ) : null}
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </main>
  );
}
