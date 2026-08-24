import { useEffect, useRef, useState } from "react";

import {
  ArrowLeft,
  Check,
  Cloud,
  Hand,
  MousePointer2,
  Redo2,
  RotateCcw,
  Save,
  Undo2,
  X,
} from "lucide-react";
import { Form, Link } from "react-router";

import { Button } from "~/core/components/ui/button";
import type {
  DrawingWorkspace,
  DrawingWorkspaceCapability,
} from "~/lukas/lib/drawing-workspace.server";
import type {
  DrawingCanvasBackground,
  DrawingCanvasHandle,
} from "./drawing-canvas.client";

type CanvasModule = typeof import("./drawing-canvas.client");
type CanvasComponent = CanvasModule["DrawingCanvas"];

type Props = {
  actionError?: string | null;
  capability: DrawingWorkspaceCapability;
  currentUserId: string;
  ifcViewerUrl: string;
  roomUrl: string;
  sourceUrl: string | null;
  workspace: DrawingWorkspace & {
    document: NonNullable<DrawingWorkspace["document"]>;
  };
};

function canEdit(capability: DrawingWorkspaceCapability) {
  return capability === "admin" || capability === "editor";
}

function canReview(capability: DrawingWorkspaceCapability) {
  return capability === "admin" || capability === "reviewer";
}

export default function DrawingWorkspaceClient({
  actionError,
  capability,
  currentUserId,
  ifcViewerUrl,
  roomUrl,
  sourceUrl,
  workspace,
}: Props) {
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const [Canvas, setCanvas] = useState<CanvasComponent | null>(null);
  const [activeTool, setActiveTool] = useState<"select" | "pan">("select");
  const { file, document: drawingDocument } = workspace;
  const { revision } = drawingDocument;
  const page = revision.pages[0];
  const editable = canEdit(capability) && revision.status === "draft";
  const reviewable =
    canReview(capability) &&
    revision.status === "review_requested" &&
    revision.created_by !== currentUserId;

  useEffect(() => {
    let alive = true;
    void import("./drawing-canvas.client").then((module) => {
      if (alive) setCanvas(() => module.DrawingCanvas);
    });
    return () => {
      alive = false;
    };
  }, []);

  const background: DrawingCanvasBackground =
    page?.background_pdf_page && sourceUrl
      ? {
          kind: "pdf",
          width: page.width_mm,
          height: page.height_mm,
          pageNumber: page.background_pdf_page,
          signedUrl: sourceUrl,
        }
      : {
          kind: "blank",
          width: page?.width_mm ?? 841,
          height: page?.height_mm ?? 594,
        };

  return (
    <main className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex min-h-16 flex-wrap items-center gap-3 border-b border-white/10 bg-slate-900 px-3 py-2 sm:px-4">
        <Link
          aria-label="협업 도면실로 돌아가기"
          className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white"
          to={roomUrl}
        >
          <ArrowLeft className="size-4" /> 협업 도면실
        </Link>
        <div className="min-w-0 flex-1 border-l border-white/10 pl-3">
          <p className="text-xs font-semibold text-indigo-300">도면 작업실</p>
          <h1 className="truncate text-sm font-bold">
            {drawingDocument.title}
          </h1>
          <p className="truncate text-xs text-slate-400">
            {file.original_filename}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span
            aria-label="저장 상태: 저장됨"
            className="inline-flex min-h-9 items-center gap-1 px-2 text-xs text-emerald-300"
            role="status"
          >
            <Cloud className="size-4" /> 저장됨
          </span>
          <Button
            aria-label="저장"
            disabled
            size="icon"
            title="저장됨"
            variant="ghost"
          >
            <Save className="size-4" />
          </Button>
          <Button
            aria-label="실행 취소"
            disabled
            size="icon"
            title="실행 취소"
            variant="ghost"
          >
            <Undo2 className="size-4" />
          </Button>
          <Button
            aria-label="다시 실행"
            disabled
            size="icon"
            title="다시 실행"
            variant="ghost"
          >
            <Redo2 className="size-4" />
          </Button>
          {editable ? (
            <Form method="post">
              <input name="intent" type="hidden" value="request_review" />
              <input name="revision_id" type="hidden" value={revision.id} />
              <Button name="review" type="submit" variant="secondary">
                <Check className="size-4" /> 검토 요청
              </Button>
            </Form>
          ) : null}
          {reviewable ? (
            <div className="flex items-center gap-1" aria-label="리비전 검토">
              <Button
                aria-label="도면 승인"
                disabled
                title="스냅샷 확인 후 사용할 수 있습니다."
                variant="secondary"
              >
                <Check className="size-4" /> 승인
              </Button>
              <Button
                aria-label="도면 반려"
                disabled
                title="스냅샷 확인 후 사용할 수 있습니다."
                variant="destructive"
              >
                <X className="size-4" /> 반려
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      {actionError ? (
        <p
          className="border-b border-red-500/30 bg-red-950 px-4 py-2 text-sm text-red-100"
          role="alert"
        >
          {actionError}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[14rem_minmax(0,1fr)_17rem]">
        <aside
          aria-label="레이어 패널"
          className="border-b border-white/10 bg-slate-900 p-4 lg:border-b-0 lg:border-r"
        >
          <h2 className="text-sm font-bold">레이어</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {revision.layers.map((layer) => (
              <li
                className="flex items-center justify-between gap-2 rounded-md bg-white/5 px-3 py-2"
                key={layer.id}
              >
                <span className="truncate">{layer.name}</span>
                <span className="text-xs text-slate-400">
                  {layer.locked ? "잠김" : layer.visible ? "표시" : "숨김"}
                </span>
              </li>
            ))}
          </ul>
        </aside>

        <section
          aria-label="도면 캔버스"
          className="relative min-h-[34rem] min-w-0 bg-slate-950"
        >
          <div
            className={
              file.kind === "ifc"
                ? "grid h-full min-h-[34rem] xl:grid-cols-[minmax(0,1fr)_16rem]"
                : "h-full min-h-[34rem]"
            }
          >
            <div className="min-h-0 min-w-0">
              {Canvas ? (
                <Canvas
                  activeTool={activeTool}
                  background={background}
                  ref={canvasRef}
                />
              ) : (
                <div
                  className="grid h-full min-h-[34rem] place-items-center text-sm text-slate-400"
                  role="status"
                >
                  캔버스를 준비하는 중입니다.
                </div>
              )}
            </div>
            {file.kind === "ifc" ? (
              <aside className="border-t border-white/10 bg-slate-900 p-4 xl:border-l xl:border-t-0">
                <h2 className="text-sm font-bold">IFC 원본 보기</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  2D 오버레이는 빈 도면에서 시작합니다. 2D와 3D 화면 동기화는
                  이후 단계에서 제공합니다.
                </p>
                <Link
                  className="mt-4 inline-flex min-h-11 items-center rounded-md border border-white/15 px-3 text-sm font-semibold hover:bg-white/10"
                  rel="noreferrer"
                  target="_blank"
                  to={ifcViewerUrl}
                >
                  IFC 3D 원본 열기
                </Link>
              </aside>
            ) : null}
          </div>

          <nav
            aria-label="캔버스 도구"
            className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/15 bg-slate-900/95 p-1.5 shadow-xl backdrop-blur"
          >
            <Button
              aria-label="선택 도구"
              aria-pressed={activeTool === "select"}
              onClick={() => setActiveTool("select")}
              size="icon"
              variant={activeTool === "select" ? "secondary" : "ghost"}
            >
              <MousePointer2 className="size-4" />
            </Button>
            <Button
              aria-label="이동 도구"
              aria-pressed={activeTool === "pan"}
              onClick={() => setActiveTool("pan")}
              size="icon"
              variant={activeTool === "pan" ? "secondary" : "ghost"}
            >
              <Hand className="size-4" />
            </Button>
            <Button
              aria-label="화면 맞춤"
              onClick={() => canvasRef.current?.resetViewport()}
              size="icon"
              variant="ghost"
            >
              <RotateCcw className="size-4" />
            </Button>
          </nav>
        </section>

        <aside
          aria-label="속성 검사기"
          className="border-t border-white/10 bg-slate-900 p-4 lg:border-l lg:border-t-0"
        >
          <h2 className="text-sm font-bold">속성</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs text-slate-400">리비전</dt>
              <dd>{revision.sequence}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">상태</dt>
              <dd>{revision.status}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">페이지</dt>
              <dd>{page?.name ?? "도면 1"}</dd>
            </div>
          </dl>
          <p className="mt-6 text-sm leading-6 text-slate-400">
            객체를 선택하면 이 영역에서 속성을 확인할 수 있습니다.
          </p>
        </aside>
      </div>
    </main>
  );
}
