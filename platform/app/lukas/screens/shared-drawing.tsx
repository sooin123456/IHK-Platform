import type { Route } from "./+types/shared-drawing";

import { lazy, Suspense, useEffect, useState } from "react";
import { data, isRouteErrorResponse, useRouteError } from "react-router";

import {
  resolvePublicDrawingShare,
  type PublicDrawingShareView,
} from "~/lukas/lib/drawing-share.server";

const SharedDrawingViewer = lazy(
  () => import("~/lukas/components/shared-drawing-viewer.client"),
);

function SharedDrawingViewerBoundary({
  selectedCanvasId,
  view,
}: {
  selectedCanvasId: string;
  view: PublicDrawingShareView;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const fallback = (
    <section
      aria-label="도면 캔버스"
      className="grid min-h-[36rem] place-items-center rounded-xl border border-slate-700 bg-slate-950 text-sm text-slate-300"
    >
      도면을 불러오는 중입니다…
    </section>
  );
  if (!mounted) return fallback;
  return (
    <Suspense fallback={fallback}>
      <SharedDrawingViewer selectedCanvasId={selectedCanvasId} view={view} />
    </Suspense>
  );
}

const publicShareHeaders = () =>
  new Headers({
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  });

// React Router only promotes non-cookie loader headers into the final document
// response through a route headers export.
export function headers() {
  return publicShareHeaders();
}

function unavailable(): Response {
  return new Response("공유 도면을 열 수 없습니다.", {
    status: 404,
    headers: publicShareHeaders(),
  });
}

export function logPublicDrawingShareFailure(
  error: unknown,
  logger: (...data: unknown[]) => void = console.error,
) {
  logger("Shared drawing resolution failed", {
    code: "DRAWING_SHARE_UNAVAILABLE",
    kind: error instanceof Response ? `http_${error.status}` : "unexpected",
  });
}

export function publicDrawingShareResponse(
  view: PublicDrawingShareView,
  requestedCanvasId: string | null,
) {
  const selectedCanvasId = requestedCanvasId ?? view.canvases[0]?.id ?? null;
  if (
    !selectedCanvasId ||
    !view.canvases.some((canvas) => canvas.id === selectedCanvasId)
  )
    throw unavailable();
  return data({ view, selectedCanvasId }, { headers: publicShareHeaders() });
}

export async function loader({ request, params }: Route.LoaderArgs) {
  try {
    const { default: adminClient } = await import(
      "~/core/lib/supa-admin-client.server"
    );
    const view = await resolvePublicDrawingShare(adminClient, params.token);
    const selectedCanvasId = new URL(request.url).searchParams.get("canvas");
    return publicDrawingShareResponse(view, selectedCanvasId);
  } catch (error) {
    logPublicDrawingShareFailure(error);
    throw unavailable();
  }
}

export const meta: Route.MetaFunction = ({ data: page }) => [
  {
    title: page
      ? `${page.view.document.title} | 공유 도면 | 1HK Platform`
      : "공유 도면 | 1HK Platform",
  },
];

export default function SharedDrawingScreen({
  loaderData,
}: Route.ComponentProps) {
  const { view, selectedCanvasId } = loaderData;
  const selectedCanvas = view.canvases.find(
    (canvas) => canvas.id === selectedCanvasId,
  )!;
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[112rem] gap-4">
        <header className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300">
              1HK Drawing Share
            </p>
            <h1 className="mt-1 text-xl font-semibold text-white">
              {view.document.title}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {view.project.name} · 개정 {view.revision.sequence} · 버전{" "}
              {view.revision.version}
            </p>
          </div>
          <div className="rounded-full border border-cyan-700/60 bg-cyan-950/60 px-3 py-1 text-sm text-cyan-100">
            보기 전용 · 원본 수정 불가
          </div>
        </header>

        <nav
          aria-label="공유 도면 페이지와 캔버스"
          className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3"
        >
          {view.canvases.map((canvas) => {
            const page = view.pages.find(
              (candidate) => candidate.id === canvas.pageId,
            );
            const active = canvas.id === selectedCanvasId;
            return (
              <a
                aria-current={active ? "page" : undefined}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  active
                    ? "border-cyan-400 bg-cyan-950 text-white"
                    : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                }`}
                href={`?canvas=${encodeURIComponent(canvas.id)}`}
                key={canvas.id}
              >
                {page?.name ?? "페이지"} · {canvas.name}
              </a>
            );
          })}
        </nav>

        <SharedDrawingViewerBoundary
          selectedCanvasId={selectedCanvas.id}
          view={view}
        />

        <footer className="flex flex-wrap justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-xs text-slate-400">
          <span>
            스냅샷 SHA-256:{" "}
            <code className="break-all text-slate-300">
              {view.snapshotSha256}
            </code>
          </span>
          <span>
            링크 만료: {new Date(view.expiresAt).toLocaleString("ko-KR")}
          </span>
        </footer>
      </div>
    </main>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const unavailableShare = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-slate-100">
      <section className="max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 text-center">
        <h1 className="text-xl font-semibold">공유 도면을 열 수 없습니다.</h1>
        <p className="mt-2 text-sm text-slate-400">
          {unavailableShare
            ? "링크가 만료되었거나 취소되었습니다. 공유한 관리자에게 새 링크를 요청해 주세요."
            : "잠시 후 다시 시도해 주세요."}
        </p>
      </section>
    </main>
  );
}
