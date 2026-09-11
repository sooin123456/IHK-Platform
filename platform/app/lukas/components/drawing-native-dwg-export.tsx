import { useEffect, useRef, useState } from "react";

import { Button } from "~/core/components/ui/button";
import {
  drawingNativeDwgDownloadPath,
  drawingNativeDwgExportPath,
} from "~/lukas/lib/drawing-workspace-paths";

export type NativeDrawingDwgScope = {
  projectId: string;
  documentId: string;
  revisionId: string;
  revisionVersion: number;
  canvasId: string;
  snapshotSha256: string;
};
type ArtifactKind = "dwg" | "source_manifest" | "authority" | "report";
type NativeDrawingDwgJob = {
  jobId?: string;
  status: "queued" | "processing" | "retry_wait" | "completed" | "failed";
  attemptCount: number;
  lastErrorCode: string | null;
  qualification?: "experimental-unqualified";
  receipt?: null | { artifacts: Array<{ kind: ArtifactKind }> };
};
export type NativeDrawingDwgViewStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "job"; job: NativeDrawingDwgJob };

type RequestIdentity = { key: string; requestId: string };
type RequestGate = { current: object | null };

export function nativeDrawingDwgScopeKey(scope: NativeDrawingDwgScope) {
  return JSON.stringify([
    scope.projectId,
    scope.documentId,
    scope.revisionId,
    scope.revisionVersion,
    scope.canvasId,
    scope.snapshotSha256,
  ]);
}

export function nativeDrawingDwgRequestIdentity(
  current: RequestIdentity | null,
  scope: NativeDrawingDwgScope,
  createRequestId: () => string = () => crypto.randomUUID(),
): RequestIdentity {
  const key = nativeDrawingDwgScopeKey(scope);
  return current?.key === key ? current : { key, requestId: createRequestId() };
}

type RequestIdentityStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function nativeDrawingDwgPersistentRequestIdentity(
  current: RequestIdentity | null,
  scope: NativeDrawingDwgScope,
  storage: RequestIdentityStorage | null,
  createRequestId: () => string = () => crypto.randomUUID(),
  fresh = false,
) {
  const key = nativeDrawingDwgScopeKey(scope);
  const storageKey = `native-dwg-request-v1:${key}`;
  if (!fresh && current?.key === key) return current;
  try {
    if (fresh) storage?.removeItem(storageKey);
    else {
      const stored = storage?.getItem(storageKey);
      if (stored && UUID_PATTERN.test(stored))
        return { key, requestId: stored };
    }
  } catch {
    // A privacy-restricted browser can still keep the identity for this mount.
  }
  const identity = nativeDrawingDwgRequestIdentity(
    null,
    scope,
    createRequestId,
  );
  try {
    storage?.setItem(storageKey, identity.requestId);
  } catch {
    // The in-memory ref remains the bounded fallback.
  }
  return identity;
}

export async function runNativeDrawingDwgRequest<T>({
  gate,
  request,
  scopeKey,
}: {
  gate: RequestGate;
  request: () => Promise<T>;
  scopeKey: string;
}): Promise<{ scopeKey: string; value: T } | null> {
  if (gate.current) return null;
  const token = {};
  gate.current = token;
  try {
    return { scopeKey, value: await request() };
  } finally {
    if (gate.current === token) gate.current = null;
  }
}

export function nativeDrawingDwgFreshResult<T>(
  requestedScopeKey: string,
  currentScopeKey: string,
  value: T,
): T | null {
  return requestedScopeKey === currentScopeKey ? value : null;
}

export function nativeDrawingDwgShouldPoll(
  open: boolean,
  job: Pick<NativeDrawingDwgJob, "status"> | null,
) {
  return (
    open &&
    Boolean(job && ["queued", "processing", "retry_wait"].includes(job.status))
  );
}

export function abortNativeDrawingDwgPolling(controller: AbortController) {
  controller.abort();
}

export function replaceNativeDrawingDwgAbortController(
  ref: { current: AbortController | null },
  active: boolean,
) {
  ref.current?.abort();
  const next = active ? new AbortController() : null;
  ref.current = next;
  return next;
}

function statusSearch(scope: NativeDrawingDwgScope, jobId?: string | null) {
  const search = new URLSearchParams({
    revisionId: scope.revisionId,
    revisionVersion: String(scope.revisionVersion),
    canvasId: scope.canvasId,
    snapshotSha256: scope.snapshotSha256,
  });
  if (jobId) search.set("jobId", jobId);
  return search;
}

function downloadHref(
  scope: NativeDrawingDwgScope,
  jobId: string,
  kind: ArtifactKind,
) {
  return `${drawingNativeDwgDownloadPath(scope.projectId, scope.documentId, jobId, kind)}?${statusSearch(scope)}`;
}

const ARTIFACTS = [
  ["dwg", "DWG"],
  ["source_manifest", "도면 데이터"],
  ["authority", "승인·원본 근거"],
  ["report", "검증 보고서"],
] as const;
const ERROR_LABELS: Record<string, string> = {
  source_unavailable: "승인된 원본을 다시 확인할 수 없음",
  lease_expired: "변환 작업 시간 만료",
  conversion_failed: "DWG 변환 실패",
  verification_failed: "결과 검증 실패",
  upload_failed: "검증 파일 저장 실패",
  publication_failed: "완료 기록 실패",
  budget_exceeded: "변환 시간 또는 크기 제한 초과",
};

export function NativeDrawingDwgStatusView({
  onRequest,
  requesting,
  scope,
  status,
}: {
  onRequest: (fresh?: boolean) => void;
  requesting: boolean;
  scope: NativeDrawingDwgScope;
  status: NativeDrawingDwgViewStatus;
}) {
  if (status.kind === "loading")
    return (
      <p aria-live="polite" className="text-sm" role="status">
        DWG 내보내기 상태를 확인하는 중입니다.
      </p>
    );
  if (status.kind === "error")
    return (
      <div className="grid gap-2">
        <p className="text-sm text-destructive" role="alert">
          {status.message}
        </p>
        <Button
          disabled={requesting}
          onClick={() => onRequest(false)}
          type="button"
        >
          같은 요청 다시 확인
        </Button>
      </div>
    );
  if (status.kind === "idle")
    return (
      <Button
        disabled={requesting}
        onClick={() => onRequest(false)}
        type="button"
      >
        {requesting ? "요청 중…" : "시험용 DWG 만들기"}
      </Button>
    );

  const labels = {
    queued: "대기열에서 변환을 기다리고 있습니다.",
    processing: "DWG 파일을 생성하고 있습니다.",
    retry_wait: "재시도를 기다리고 있습니다.",
    failed: "DWG 내보내기에 실패했습니다.",
    completed: "시험용 DWG 파일이 준비되었습니다.",
  } as const;
  const job = status.job;
  const completedKinds = new Set(
    job.receipt?.artifacts.map(({ kind }) => kind) ?? [],
  );
  const completeReceipt =
    job.status === "completed" &&
    Boolean(job.jobId) &&
    ARTIFACTS.every(([kind]) => completedKinds.has(kind));
  return (
    <div className="grid gap-2">
      <p aria-live="polite" className="text-sm" role="status">
        {labels[job.status]} 시도 {job.attemptCount}/3
        {job.lastErrorCode ? ` · ${ERROR_LABELS[job.lastErrorCode]}` : ""}
      </p>
      {job.status === "failed" ? (
        <Button
          disabled={requesting}
          onClick={() => onRequest(true)}
          type="button"
        >
          새 요청으로 다시 요청
        </Button>
      ) : null}
      {completeReceipt ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            {ARTIFACTS.map(([kind, label]) => (
              <a
                className="text-sm underline"
                href={downloadHref(scope, job.jobId!, kind)}
                key={kind}
                rel="noreferrer"
              >
                {label}
              </a>
            ))}
          </div>
          <p className="text-xs text-amber-700">
            내부 시험용 experimental-unqualified 결과입니다. 독립 CAD 제품에서의
            호환성 검증과 납품 자격 확인은 아직 필요합니다.
          </p>
        </div>
      ) : null}
    </div>
  );
}

type NativeDrawingDwgDocument = {
  activeCanvasId: string | null;
  structure?: {
    pages: Record<string, unknown>;
    canvases: Record<
      string,
      { id: string; background: unknown; outputProfile?: unknown }
    >;
    sources?: Record<string, { sourceKind?: string }>;
    tombstones?: Record<string, unknown>;
  };
};

export function nativeDrawingDwgEligibility({
  backendAvailable,
  documentState,
  outboxReady,
  revisionStatus,
  saveStatus,
  snapshotSha256,
}: {
  backendAvailable: boolean;
  documentState: NativeDrawingDwgDocument;
  outboxReady: boolean;
  revisionStatus: string;
  saveStatus: string;
  snapshotSha256: string | null;
}): { ready: true; canvasId: string } | { ready: false; message: string } {
  if (!backendAvailable)
    return {
      ready: false,
      message: "로컬 미리보기에서는 실제 DWG 변환 작업을 요청할 수 없습니다.",
    };
  if (revisionStatus !== "approved" && revisionStatus !== "superseded")
    return {
      ready: false,
      message: "승인되었거나 대체된 개정만 DWG로 내보낼 수 있습니다.",
    };
  if (!outboxReady || saveStatus !== "저장됨" || !snapshotSha256)
    return {
      ready: false,
      message: "현재 도면을 모두 저장한 뒤 DWG 내보내기를 요청해 주세요.",
    };
  const structure = documentState.structure;
  const canvases = Object.values(structure?.canvases ?? {});
  if (canvases.length !== 1 || Object.keys(structure?.pages ?? {}).length !== 1)
    return {
      ready: false,
      message:
        "DWG 시험 내보내기는 페이지와 캔버스가 각각 하나인 도면만 지원합니다. 캔버스를 하나로 정리해 주세요.",
    };
  const canvas = canvases[0];
  if (
    !documentState.activeCanvasId ||
    documentState.activeCanvasId !== canvas.id
  )
    return { ready: false, message: "내보낼 단일 캔버스를 선택해 주세요." };
  if (
    canvas.background !== null ||
    Object.keys(structure?.sources ?? {}).length > 0
  )
    return {
      ready: false,
      message:
        "PDF·IFC·DXF에서 가져온 근거가 있는 도면은 이 시험 내보내기의 대상이 아닙니다. 원본 없는 네이티브 단일 캔버스를 사용해 주세요.",
    };
  if (
    Object.keys(structure?.tombstones ?? {}).length > 0 ||
    !canvas.outputProfile
  )
    return {
      ready: false,
      message:
        "이 도면은 네이티브 CAD 출력 조건을 충족하지 않습니다. 출력 용지와 축척을 다시 확인해 주세요.",
    };
  return { ready: true, canvasId: canvas.id };
}

export function isNativeDrawingDwgJob(
  value: unknown,
): value is NativeDrawingDwgJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Record<string, unknown>;
  if (
    typeof job.jobId !== "string" ||
    !UUID_PATTERN.test(job.jobId) ||
    !["queued", "processing", "retry_wait", "completed", "failed"].includes(
      String(job.status),
    ) ||
    !Number.isInteger(job.attemptCount) ||
    Number(job.attemptCount) < 0 ||
    Number(job.attemptCount) > 3 ||
    job.qualification !== "experimental-unqualified" ||
    !(
      job.lastErrorCode === null ||
      (typeof job.lastErrorCode === "string" &&
        job.lastErrorCode in ERROR_LABELS)
    )
  )
    return false;
  if (job.status !== "completed") return job.receipt === null;
  if (!job.receipt || typeof job.receipt !== "object") return false;
  const artifacts = (job.receipt as Record<string, unknown>).artifacts;
  if (!Array.isArray(artifacts) || artifacts.length !== 4) return false;
  const kinds = new Set(
    artifacts.map((artifact) =>
      artifact && typeof artifact === "object" && "kind" in artifact
        ? String(artifact.kind)
        : "",
    ),
  );
  return ARTIFACTS.every(([kind]) => kinds.has(kind));
}

export function NativeDrawingDwgExportControl({
  backendAvailable,
  documentState,
  open,
  outboxReady,
  projectId,
  revisionId,
  revisionStatus,
  revisionVersion,
  saveStatus,
  snapshotSha256,
  transport = fetch,
  workspaceId,
}: {
  backendAvailable: boolean;
  documentState: NativeDrawingDwgDocument;
  open: boolean;
  outboxReady: boolean;
  projectId: string;
  revisionId: string;
  revisionStatus: string;
  revisionVersion: number;
  saveStatus: string;
  snapshotSha256: string | null;
  transport?: typeof fetch;
  workspaceId: string;
}) {
  const eligibility = nativeDrawingDwgEligibility({
    backendAvailable,
    documentState,
    outboxReady,
    revisionStatus,
    saveStatus,
    snapshotSha256,
  });
  const scope: NativeDrawingDwgScope | null = eligibility.ready
    ? {
        projectId,
        documentId: workspaceId,
        revisionId,
        revisionVersion,
        canvasId: eligibility.canvasId,
        snapshotSha256: snapshotSha256!,
      }
    : null;
  const scopeKey = scope ? nativeDrawingDwgScopeKey(scope) : "unavailable";
  const currentScopeKeyRef = useRef(scopeKey);
  currentScopeKeyRef.current = scopeKey;
  const requestIdentityRef = useRef<RequestIdentity | null>(null);
  const requestGateRef = useRef<object | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const openRef = useRef(open);
  openRef.current = open;
  const [requesting, setRequesting] = useState(false);
  const [watchJobId, setWatchJobId] = useState<string | null>(null);
  const [statusRefresh, setStatusRefresh] = useState(0);
  const [status, setStatus] = useState<NativeDrawingDwgViewStatus>({
    kind: "idle",
  });

  useEffect(() => {
    setWatchJobId(null);
    setStatus({ kind: "idle" });
  }, [scopeKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      replaceNativeDrawingDwgAbortController(requestControllerRef, false);
    };
  }, []);

  useEffect(() => {
    if (!open)
      replaceNativeDrawingDwgAbortController(requestControllerRef, false);
    return () => {
      replaceNativeDrawingDwgAbortController(requestControllerRef, false);
    };
  }, [open, scopeKey]);

  useEffect(() => {
    if (!open || !scope) return;
    const requestedScopeKey = scopeKey;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let first = true;
    const poll = async () => {
      if (first) setStatus({ kind: "loading" });
      first = false;
      try {
        const search = statusSearch(scope, watchJobId);
        const response = await transport(
          `${drawingNativeDwgExportPath(projectId, workspaceId)}?${search}`,
          { credentials: "same-origin", signal: controller.signal },
        );
        if (!response.ok) throw new Error("status");
        const value: unknown = await response.json();
        if (controller.signal.aborted) return;
        const fresh = nativeDrawingDwgFreshResult(
          requestedScopeKey,
          currentScopeKeyRef.current,
          value,
        );
        if (fresh === null && value !== null) return;
        if (currentScopeKeyRef.current !== requestedScopeKey) return;
        if (value === null) setStatus({ kind: "idle" });
        else if (isNativeDrawingDwgJob(value)) {
          setStatus({ kind: "job", job: value });
          if (nativeDrawingDwgShouldPoll(open, value))
            timer = setTimeout(poll, 2_000);
        } else throw new Error("status");
      } catch {
        if (
          !controller.signal.aborted &&
          currentScopeKeyRef.current === requestedScopeKey
        )
          setStatus({
            kind: "error",
            message: "DWG 내보내기 상태를 확인하지 못했습니다.",
          });
      }
    };
    void poll();
    return () => {
      if (timer) clearTimeout(timer);
      abortNativeDrawingDwgPolling(controller);
    };
  }, [
    open,
    projectId,
    scopeKey,
    statusRefresh,
    transport,
    watchJobId,
    workspaceId,
  ]);

  if (!eligibility.ready)
    return (
      <div className="grid gap-2">
        <p className="text-sm text-amber-700" role="status">
          {eligibility.message}
        </p>
        <p className="text-xs text-muted-foreground">
          이 기능은 승인된 네이티브 단일 캔버스만 변환하며, 가짜 완료 파일을
          만들지 않습니다.
        </p>
      </div>
    );
  if (!scope) return null;

  const requestExport = async (fresh = false) => {
    let controller: AbortController | null = null;
    try {
      const result = await runNativeDrawingDwgRequest({
        gate: requestGateRef,
        scopeKey,
        request: async () => {
          let storage: Storage | null = null;
          try {
            storage =
              typeof window === "undefined" ? null : window.sessionStorage;
          } catch {
            // Session storage can be blocked by browser privacy settings.
          }
          const identity = nativeDrawingDwgPersistentRequestIdentity(
            requestIdentityRef.current,
            scope,
            storage,
            () => crypto.randomUUID(),
            fresh,
          );
          requestIdentityRef.current = identity;
          controller = replaceNativeDrawingDwgAbortController(
            requestControllerRef,
            true,
          )!;
          setRequesting(true);
          setStatus({ kind: "loading" });
          const response = await transport(
            drawingNativeDwgExportPath(projectId, workspaceId),
            {
              body: JSON.stringify({ ...scope, requestId: identity.requestId }),
              credentials: "same-origin",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              method: "POST",
              signal: controller.signal,
            },
          );
          if (!response.ok) throw new Error("request");
          const value = (await response.json()) as Record<string, unknown>;
          if (
            value.accepted !== true ||
            typeof value.jobId !== "string" ||
            value.requestId !== identity.requestId
          )
            throw new Error("request");
          return { jobId: value.jobId };
        },
      });
      const freshResult = result
        ? nativeDrawingDwgFreshResult(
            result.scopeKey,
            currentScopeKeyRef.current,
            result.value,
          )
        : null;
      if (!freshResult || !mountedRef.current || !openRef.current) return;
      setWatchJobId(freshResult.jobId);
      setStatusRefresh((value) => value + 1);
    } catch {
      if (
        mountedRef.current &&
        openRef.current &&
        currentScopeKeyRef.current === scopeKey
      )
        setStatus({
          kind: "error",
          message:
            "DWG 요청 결과를 확인하지 못했습니다. 같은 요청 ID로 다시 확인할 수 있습니다.",
        });
    } finally {
      if (controller) {
        if (requestControllerRef.current === controller)
          requestControllerRef.current = null;
        if (mountedRef.current) setRequesting(false);
      }
    }
  };

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        승인된 네이티브 단일 캔버스를 서버에서 비동기로 변환합니다. 창을 닫아도
        서버 작업 취소를 의미하지 않으며, 다시 열면 저장된 상태를 확인합니다.
      </p>
      <NativeDrawingDwgStatusView
        onRequest={(fresh) => void requestExport(fresh)}
        requesting={requesting}
        scope={scope}
        status={status}
      />
    </div>
  );
}
