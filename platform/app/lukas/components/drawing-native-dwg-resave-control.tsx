import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "~/core/components/ui/button";
import {
  NativeDrawingDwgResaveAcceptanceSchema,
  NativeDrawingDwgResaveReceiptSchema,
  NativeDrawingDwgResaveScopeSchema,
  NativeDrawingDwgResaveStatusSchema,
  type NativeDrawingDwgResaveScope,
} from "~/lukas/lib/drawing-native-dwg-resave-contract";
import {
  drawingNativeDwgResavePath,
  drawingNativeDwgResaveDownloadPath,
} from "~/lukas/lib/drawing-workspace-paths";

const Uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const Envelope = z
  .object({
    job: NativeDrawingDwgResaveStatusSchema.nullable(),
    receipt: NativeDrawingDwgResaveReceiptSchema.nullable(),
  })
  .strict()
  .refine(
    ({ job, receipt }) =>
      (job?.status === "completed") === (receipt !== null) &&
      (receipt === null || receipt.jobId === job?.jobId),
  );
type EnvelopeValue = z.infer<typeof Envelope>;
const terminal = new Set(["completed", "failed", "cancelled", "no_changes"]);
const cancellable = new Set(["queued", "processing", "retry_wait"]);
const labels = {
  queued: "대기 중",
  processing: "재저장 중",
  retry_wait: "재시도 대기",
  cancel_requested: "취소 처리 중",
  cancelled: "취소됨",
  no_changes: "지원되는 변경이 없습니다",
  failed: "재저장 실패",
  completed: "재저장 완료",
};

function search(scope: NativeDrawingDwgResaveScope, jobId?: string) {
  return new URLSearchParams({
    revisionId: scope.revisionId,
    revisionVersion: String(scope.revisionVersion),
    canvasId: scope.canvasId,
    snapshotSha256: scope.snapshotSha256,
    ...(jobId ? { jobId } : {}),
  });
}
function parseEnvelope(
  value: unknown,
  scope: NativeDrawingDwgResaveScope,
  jobId?: string,
) {
  const parsed = Envelope.parse(value);
  if (jobId && parsed.job?.jobId !== jobId) throw new Error("identity");
  if (
    parsed.receipt &&
    Object.entries(scope).some(
      ([key, value]) =>
        parsed.receipt!.scope[key as keyof NativeDrawingDwgResaveScope] !==
        value,
    )
  )
    throw new Error("scope");
  return parsed;
}

export function NativeDrawingDwgResaveControl({
  scope: rawScope,
  currentUserId,
  open,
  readiness,
  transport = fetch,
}: {
  scope: NativeDrawingDwgResaveScope | null;
  currentUserId?: string | null;
  open: boolean;
  readiness: boolean;
  transport?: typeof fetch;
}) {
  const parsedScope = NativeDrawingDwgResaveScopeSchema.safeParse(rawScope);
  const actor = Uuid.safeParse(currentUserId);
  const scope = parsedScope.success ? parsedScope.data : null;
  const scopeKey = scope ? JSON.stringify(scope) : "";
  const key =
    scope && actor.success
      ? `native-dwg-resave:v1:${actor.data}:${scopeKey}`
      : "";
  const lifecycle = `${open}:${readiness}:${key}`;
  const generation = useRef({ lifecycle, token: {} });
  const watchJob = useRef<string | undefined>(undefined);
  if (generation.current.lifecycle !== lifecycle) {
    generation.current = { lifecycle, token: {} };
    watchJob.current = undefined;
  }
  const token = generation.current.token;
  const localIds = useRef(new Map<string, string>());
  const flight = useRef<{ token: object; controller: AbortController } | null>(
    null,
  );
  const [view, setView] = useState<{
    token: object;
    value: EnvelopeValue | null;
    error: boolean;
  }>({ token, value: null, error: false });
  const [busy, setBusy] = useState<object | null>(null);
  const [refresh, setRefresh] = useState(0);
  const visible = view.token === token ? view : null;
  const value = visible?.value;
  const job = value?.job;

  useEffect(() => {
    try {
      if (key && !localIds.current.has(key)) {
        const stored = Uuid.safeParse(localStorage.getItem(key));
        if (stored.success) localIds.current.set(key, stored.data);
      }
    } catch {
      /* Storage may be unavailable; the mounted identity still survives retry. */
    }
    return () => {
      if (flight.current?.token === token) flight.current.controller.abort();
    };
  }, [key, token]);

  useEffect(() => {
    if (!open || !readiness || !key) return;
    const exactScope = NativeDrawingDwgResaveScopeSchema.parse(
      JSON.parse(scopeKey),
    );
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fresh = () =>
      !controller.signal.aborted && generation.current.token === token;
    const poll = async () => {
      let finished = false;
      try {
        const jobId = watchJob.current;
        const response = await transport(
          `${drawingNativeDwgResavePath(exactScope.projectId, exactScope.documentId)}?${search(exactScope, jobId)}`,
          { credentials: "same-origin", signal: controller.signal },
        );
        if (!response.ok) throw new Error("status");
        const parsed = parseEnvelope(await response.json(), exactScope, jobId);
        if (!fresh()) return;
        setView({ token, value: parsed, error: false });
        finished = parsed.job !== null && terminal.has(parsed.job.status);
      } catch {
        if (fresh()) setView({ token, value: null, error: true });
      }
      if (fresh() && !finished) timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, scopeKey, open, readiness, refresh, token, transport]);

  const send = async (intent: "request" | "cancel") => {
    if (
      !scope ||
      !key ||
      !open ||
      !readiness ||
      flight.current?.token === token
    )
      return;
    const controller = new AbortController();
    const operation = { token, controller };
    flight.current = operation;
    setBusy(token);
    try {
      let body;
      if (intent === "cancel") {
        if (
          !job ||
          !cancellable.has(job.status) ||
          localIds.current.get(key) !== job.requestId
        )
          return;
        body = { intent, ...scope, jobId: job.jobId };
      } else {
        let requestId = localIds.current.get(key);
        if (
          !requestId ||
          job?.status === "failed" ||
          job?.status === "cancelled"
        ) {
          requestId = crypto.randomUUID();
          localIds.current.set(key, requestId);
          try {
            localStorage.setItem(key, requestId);
          } catch {
            /* Retain the in-memory ID. */
          }
        }
        body = { intent, ...scope, requestId };
      }
      const response = await transport(
        drawingNativeDwgResavePath(scope.projectId, scope.documentId),
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error("request");
      const raw: unknown = await response.json();
      if (controller.signal.aborted || generation.current.token !== token)
        return;
      if (body.intent === "request") {
        const accepted = NativeDrawingDwgResaveAcceptanceSchema.parse(raw);
        if (accepted.requestId !== body.requestId)
          throw new Error("request identity");
        watchJob.current = accepted.jobId;
      } else {
        setView({
          token,
          value: parseEnvelope(raw, scope, body.jobId),
          error: false,
        });
      }
      setRefresh((n) => n + 1);
    } catch {
      if (!controller.signal.aborted && generation.current.token === token)
        setView({ token, value: null, error: true });
    } finally {
      if (flight.current === operation) flight.current = null;
      if (generation.current.token === token) setBusy(null);
    }
  };

  if (!key) return null;
  const canRequest =
    !job || job.status === "failed" || job.status === "cancelled";
  return (
    <div className="space-y-3" data-native-dwg-resave-control="">
      <p className="text-sm text-amber-700">
        실험적 DWG 재저장 · 독립 CAD 검증 미수행 · 영구 저장 권한 미발급
      </p>
      {!readiness ? (
        <p role="status" className="text-sm">
          실제 서버에서 승인된 개정과 저장 체크포인트를 준비해 주세요.
        </p>
      ) : null}
      {job ? (
        <p role="status" className="text-sm">
          {labels[job.status]}
        </p>
      ) : null}
      {visible?.error ? (
        <p role="alert" className="text-sm text-destructive">
          요청 상태를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.
        </p>
      ) : null}
      {canRequest ? (
        <Button
          type="button"
          disabled={!open || !readiness || busy === token}
          onClick={() => void send("request")}
        >
          DWG 재저장 요청
        </Button>
      ) : null}
      {job &&
      cancellable.has(job.status) &&
      localIds.current.get(key) === job.requestId ? (
        <Button
          type="button"
          variant="secondary"
          disabled={busy === token || !open || !readiness}
          onClick={() => void send("cancel")}
        >
          요청 취소
        </Button>
      ) : null}
      {value?.receipt ? (
        <div className="flex flex-wrap gap-3">
          {value.receipt.artifacts.map(({ kind }) => (
            <a
              key={kind}
              className="text-sm underline"
              href={`${drawingNativeDwgResaveDownloadPath(scope!.projectId, scope!.documentId, value.receipt!.jobId, kind)}?${search(scope!)}`}
            >
              {
                {
                  dwg: "DWG 다운로드",
                  edit_request: "편집 요청 다운로드",
                  authority: "권한 증거 다운로드",
                  report: "네이티브 보고서 다운로드",
                }[kind]
              }
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
