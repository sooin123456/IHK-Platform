import { useEffect, useRef, useState, type FormEvent } from "react";

import { useFetcher } from "react-router";

import type { DrawingRevisionShare } from "~/lukas/lib/drawing-share.server";
import type { DrawingWorkspaceCapability } from "~/lukas/lib/drawing-workspace.server";

const frozenStatuses = new Set([
  "review_requested",
  "reviewed",
  "approved",
  "superseded",
]);

export function canManageDrawingShares(
  capability: DrawingWorkspaceCapability,
  revisionStatus: string,
  snapshotReady: boolean,
) {
  return (
    capability === "admin" &&
    snapshotReady &&
    frozenStatuses.has(revisionStatus)
  );
}

type CreatedShare = {
  shareId: string;
  sharePath: string;
  expiresAt: string;
};

type ShareActionData =
  | {
      ok: true;
      kind: "drawing_share_created";
      error: null;
      result: CreatedShare;
    }
  | {
      ok: true;
      kind: "drawing_share_revoked";
      error: null;
      result: { shareId: string; revokedAt: string };
    }
  | { ok: false; error: string; kind?: string; result?: never };

type Props = {
  capability: DrawingWorkspaceCapability;
  createdShare?: CreatedShare | null;
  revisionStatus: string;
  shares: DrawingRevisionShare[];
  snapshotReady: boolean;
};

function prepareRequestId(event: FormEvent<HTMLFormElement>) {
  const input = event.currentTarget.elements.namedItem("request_id");
  if (input instanceof HTMLInputElement && !input.value)
    input.value = crypto.randomUUID();
}

export default function DrawingShareControls({
  capability,
  createdShare = null,
  revisionStatus,
  shares,
  snapshotReady,
}: Props) {
  const createFetcher = useFetcher<ShareActionData>();
  const revokeFetcher = useFetcher<ShareActionData>();
  const shareMutationPending =
    createFetcher.state !== "idle" || revokeFetcher.state !== "idle";
  const createFormRef = useRef<HTMLFormElement>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [dismissedShareId, setDismissedShareId] = useState<string | null>(null);
  const fetchedShare =
    createFetcher.data?.ok &&
    createFetcher.data.kind === "drawing_share_created"
      ? createFetcher.data.result
      : null;
  const createdShareCandidate = fetchedShare ?? createdShare;
  const visibleCreatedShare =
    createdShareCandidate?.shareId === dismissedShareId
      ? null
      : createdShareCandidate;

  useEffect(() => {
    if (!fetchedShare) return;
    createFormRef.current?.reset();
    setDismissedShareId(null);
    setCopyStatus(null);
  }, [fetchedShare?.shareId]);

  if (!canManageDrawingShares(capability, revisionStatus, snapshotReady))
    return null;

  const copyCreatedLink = async () => {
    if (!visibleCreatedShare) return;
    try {
      await navigator.clipboard.writeText(
        new URL(visibleCreatedShare.sharePath, window.location.origin).href,
      );
      setCopyStatus("링크를 복사했습니다.");
    } catch {
      setCopyStatus("주소를 직접 복사해 주세요.");
    }
  };

  return (
    <details className="relative">
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center rounded-md border border-white/15 px-3 text-sm text-slate-200 hover:bg-white/10">
        공유
      </summary>
      <section className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-1rem))] rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <h2 className="font-semibold text-white">도면 개정 공유</h2>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          현재 고정된 개정만 7일 동안 보기 전용으로 공유합니다.
        </p>
        <createFetcher.Form
          className="mt-3"
          method="post"
          onSubmit={prepareRequestId}
          ref={createFormRef}
        >
          <input name="intent" type="hidden" value="create_drawing_share" />
          <input name="request_id" type="hidden" />
          <button
            className="min-h-9 rounded-md bg-cyan-600 px-3 text-sm font-semibold text-white hover:bg-cyan-500"
            disabled={shareMutationPending}
            type="submit"
          >
            {createFetcher.state === "idle"
              ? "7일 보기 링크 만들기"
              : "링크 만드는 중…"}
          </button>
        </createFetcher.Form>

        {createFetcher.data && !createFetcher.data.ok ? (
          <p className="mt-2 text-xs text-red-300" role="alert">
            {createFetcher.data.error}
          </p>
        ) : null}

        {visibleCreatedShare ? (
          <div className="mt-4 rounded-lg border border-emerald-700/60 bg-emerald-950/40 p-3">
            <p className="text-sm font-semibold text-emerald-200">
              새 공유 링크
            </p>
            <p className="mt-1 text-xs text-emerald-100/80">
              보안을 위해 이 주소는 지금 한 번만 표시됩니다.
            </p>
            <a
              className="mt-2 block break-all text-xs text-cyan-300 underline"
              href={visibleCreatedShare.sharePath}
              rel="noreferrer"
              target="_blank"
            >
              {visibleCreatedShare.sharePath}
            </a>
            <div className="mt-2 flex gap-2">
              <button
                className="min-h-8 rounded-md border border-emerald-600 px-2 text-xs text-emerald-100"
                onClick={() => void copyCreatedLink()}
                type="button"
              >
                링크 복사
              </button>
              <button
                className="min-h-8 rounded-md border border-slate-600 px-2 text-xs text-slate-200"
                onClick={() => {
                  setDismissedShareId(visibleCreatedShare.shareId);
                  setCopyStatus(null);
                  createFetcher.reset();
                }}
                type="button"
              >
                닫기
              </button>
            </div>
            {copyStatus ? (
              <p className="mt-1 text-xs text-slate-300" role="status">
                {copyStatus}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 border-t border-slate-700 pt-3">
          <h3 className="text-sm font-medium text-slate-200">
            활성 링크 {shares.length}개
          </h3>
          {shares.length ? (
            <ul className="mt-2 grid max-h-52 gap-2 overflow-auto">
              {shares.map((share) => (
                <li
                  className="rounded-lg border border-slate-700 p-2"
                  key={share.shareId}
                >
                  <p className="text-xs text-slate-300">
                    버전 {share.revisionVersion} ·{" "}
                    {new Date(share.expiresAt).toLocaleString("ko-KR")} 만료
                  </p>
                  <revokeFetcher.Form
                    className="mt-2"
                    method="post"
                    onSubmit={prepareRequestId}
                  >
                    <input
                      name="intent"
                      type="hidden"
                      value="revoke_drawing_share"
                    />
                    <input name="request_id" type="hidden" />
                    <input
                      name="share_id"
                      type="hidden"
                      value={share.shareId}
                    />
                    <input
                      name="reason"
                      type="hidden"
                      value="관리자가 공유 링크를 취소함"
                    />
                    <button
                      className="min-h-8 rounded-md border border-red-700 px-2 text-xs text-red-200"
                      disabled={shareMutationPending}
                      type="submit"
                    >
                      {revokeFetcher.state === "idle"
                        ? "공유 링크 취소"
                        : "취소 중…"}
                    </button>
                  </revokeFetcher.Form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              현재 활성 링크가 없습니다.
            </p>
          )}
        </div>
      </section>
    </details>
  );
}
