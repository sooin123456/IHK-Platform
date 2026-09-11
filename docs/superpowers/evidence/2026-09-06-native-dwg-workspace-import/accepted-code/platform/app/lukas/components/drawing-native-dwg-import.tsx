import { useEffect, useRef, useState } from "react";
import type { NativeDrawingDwgImportStatus } from "../lib/drawing-native-dwg-import-jobs.server";
import type { PreparedNativeDrawingDwgProjectImport } from "../lib/drawing-native-dwg-import-source.server";
import { prepareNativeDrawingDwgImportOverHttp } from "../lib/drawing-native-dwg-import-client";
import {
  beginNativeDwgSession,
  nativeDwgSessionKey,
  readNativeDwgSession,
  writeNativeDwgSession,
  type NativeDwgImportScope,
  type NativeDwgImportSession,
  type NativeDwgImportUnit,
} from "../lib/drawing-native-dwg-import-session";

export type DrawingNativeDwgImportProps = {
  action: string;
  scope: NativeDwgImportScope;
  sources: {
    id: string;
    sha256: string;
    originalFilename: string;
    byteSize: number;
  }[];
  initialSourceId?: string | null;
  canRequest: boolean;
  canApply: boolean;
  online: boolean;
  onPrepared(plan: PreparedNativeDrawingDwgProjectImport): Promise<void>;
};

export function DrawingNativeDwgImport(props: DrawingNativeDwgImportProps) {
  // A target change unmounts requests and local UI state, but never erases its durable pointer.
  return (
    <NativeDwgImportControl
      key={`${nativeDwgSessionKey(props.scope)}:${props.initialSourceId ?? ""}`}
      {...props}
    />
  );
}

function NativeDwgImportControl({
  action,
  scope,
  sources,
  initialSourceId,
  canRequest,
  canApply,
  online,
  onPrepared,
}: DrawingNativeDwgImportProps) {
  const [sourceId, setSourceId] = useState(
    initialSourceId ?? sources[0]?.id ?? "",
  );
  const [unit, setUnit] = useState<NativeDwgImportUnit>("");
  const [pointer, setPointer] = useState<NativeDwgImportSession | null>(null);
  const [status, setStatus] = useState<NativeDrawingDwgImportStatus | null>(
    null,
  );
  const [summary, setSummary] =
    useState<PreparedNativeDrawingDwgProjectImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [applied, setApplied] = useState(false);
  const [check, setCheck] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const source = sources.find((item) => item.id === sourceId);
  const sourceMatches =
    !!source &&
    (!pointer ||
      (pointer.sourceFileId === source.id &&
        pointer.sourceSha256 === source.sha256 &&
        pointer.unitCode === unit));
  const allowed = canRequest && online && sourceMatches;
  const latest = useRef({ allowed, canApply, onPrepared });
  latest.current = { allowed, canApply, onPrepared };

  useEffect(() => {
    try {
      const stored = readNativeDwgSession(localStorage, scope);
      if (
        stored &&
        (!initialSourceId || initialSourceId === stored.sourceFileId) &&
        sources.some(
          (item) =>
            item.id === stored.sourceFileId &&
            item.sha256 === stored.sourceSha256,
        )
      ) {
        setPointer(stored);
        setSourceId(stored.sourceFileId);
        setUnit(stored.unitCode);
      }
    } catch (cause) {
      setError(message(cause));
    }
    setLoaded(true);
    return () => {
      requestRef.current?.abort();
    };
    // Scope is the component key; restore once, not on parent render/source-array allocation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!allowed) {
      requestRef.current?.abort();
      setBusy(false);
    }
  }, [allowed]);

  useEffect(() => {
    if (pointer && !sourceMatches) {
      setPointer(null);
      setStatus(null);
      setSummary(null);
      setApplied(false);
      setError(
        "DWG 원본 식별자가 변경되었습니다. 원본과 단위를 확인한 뒤 새 분석을 시작하세요.",
      );
    }
  }, [pointer, sourceMatches]);

  async function post(
    intent: string,
    fields: Record<string, string>,
    signal: AbortSignal,
  ) {
    const body = new URLSearchParams({
      intent,
      revision_id: scope.revisionId,
      canvas_id: scope.canvasId,
      ...fields,
    });
    const response = await fetch(action, { method: "POST", body, signal });
    const data = await response.json();
    if (!response.ok || data?.ok !== true)
      throw new Error(
        typeof data?.error === "string"
          ? data.error
          : "DWG 분석 요청을 확인하지 못했습니다. 같은 요청을 다시 확인하세요.",
      );
    return data;
  }

  useEffect(() => {
    if (!loaded || !allowed || !pointer?.jobId || applied) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const data = await post(
          "native_dwg_import_status",
          { job_id: pointer.jobId! },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const next = data.result as NativeDrawingDwgImportStatus;
        if (
          data.kind !== "native_dwg_import_status" ||
          next?.jobId !== pointer.jobId ||
          ![
            "queued",
            "processing",
            "retry_wait",
            "failed",
            "analyzed",
          ].includes(next.status) ||
          (next.status === "analyzed" &&
            (next.receipt?.jobId !== pointer.jobId ||
              next.receipt.source.fileId !== pointer.sourceFileId ||
              next.receipt.source.sha256 !== pointer.sourceSha256))
        )
          throw new Error("DWG 분석 응답의 원본 식별자가 일치하지 않습니다.");
        setStatus(next);
        setError(null);
        if (["queued", "processing", "retry_wait"].includes(next.status))
          timer = setTimeout(poll, 2000);
      } catch (cause) {
        if (!controller.signal.aborted) setError(message(cause));
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // Poll lifecycle is identity/authority based; status updates must not restart terminal jobs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, allowed, pointer?.jobId, check, applied, action]);

  function changeSelection(id: string, nextUnit: NativeDwgImportUnit) {
    requestRef.current?.abort();
    setBusy(false);
    setSourceId(id);
    setUnit(nextUnit);
    setPointer(null);
    setStatus(null);
    setSummary(null);
    setApplied(false);
    setError(null);
  }

  async function requestAnalysis(newRequest = false) {
    if (!allowed || !source || busy) return;
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    setBusy(true);
    setError(null);
    setStatus(null);
    setSummary(null);
    setApplied(false);
    try {
      const saved = beginNativeDwgSession(
        localStorage,
        scope,
        source,
        unit,
        undefined,
        newRequest,
      );
      setPointer(saved);
      if (saved.jobId) {
        setCheck((value) => value + 1);
        return;
      }
      const data = await post(
        "request_native_dwg_import",
        {
          source_file_id: source.id,
          request_id: saved.requestId,
          unit_code: unit,
        },
        controller.signal,
      );
      if (controller.signal.aborted || !latest.current.allowed) return;
      if (
        data.kind !== "native_dwg_import_requested" ||
        typeof data.result?.jobId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(data.result.jobId)
      )
        throw new Error("DWG 분석 요청 응답이 올바르지 않습니다.");
      const accepted = { ...saved, jobId: data.result.jobId };
      writeNativeDwgSession(localStorage, accepted);
      setPointer(accepted);
    } catch (cause) {
      if (!controller.signal.aborted) setError(message(cause));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function apply() {
    if (
      !allowed ||
      !canApply ||
      !pointer?.jobId ||
      status?.status !== "analyzed" ||
      busy ||
      applied
    )
      return;
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const plan = await prepareNativeDrawingDwgImportOverHttp({
        action,
        request: {
          revisionId: scope.revisionId,
          canvasId: scope.canvasId,
          jobId: pointer.jobId,
          sourceSha256: pointer.sourceSha256,
        },
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        !latest.current.allowed ||
        !latest.current.canApply
      )
        return;
      setSummary(plan);
      await latest.current.onPrepared(plan);
      if (!controller.signal.aborted) setApplied(true);
    } catch (cause) {
      if (!controller.signal.aborted) setError(message(cause));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const statusLabels = {
    queued: "분석 대기",
    processing: "분석 중",
    retry_wait: "분석 재시도 대기",
    failed: "분석 실패",
    analyzed: "분석 완료 · 편집 객체는 아직 추가하지 않았습니다.",
  };
  return (
    <section aria-label="DWG 편집 가져오기" className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <label>
          DWG 원본{" "}
          <select
            aria-label="DWG 원본"
            value={sourceId}
            disabled={busy || !canRequest}
            onChange={(event) => changeSelection(event.target.value, unit)}
            className="max-w-40 rounded border bg-background p-1"
          >
            {!sources.length && <option value="">검증된 DWG 없음</option>}
            {sources.map((item) => (
              <option key={item.id} value={item.id}>
                {item.originalFilename}
              </option>
            ))}
          </select>
        </label>
        <label>
          단위{" "}
          <select
            aria-label="DWG 단위"
            value={unit}
            disabled={busy || !canRequest}
            onChange={(event) =>
              changeSelection(
                sourceId,
                event.target.value as NativeDwgImportUnit,
              )
            }
            className="rounded border bg-background p-1"
          >
            <option value="">파일 선언 단위</option>
            <option value="1">in</option>
            <option value="2">ft</option>
            <option value="4">mm</option>
            <option value="5">cm</option>
            <option value="6">m</option>
          </select>
        </label>
        {!pointer && (
          <button
            type="button"
            disabled={!loaded || !allowed || busy}
            onClick={() => void requestAnalysis()}
            className="rounded border px-2 py-1"
          >
            DWG 분석 시작
          </button>
        )}
        {pointer && !pointer.jobId && (
          <button
            type="button"
            disabled={!allowed || busy}
            onClick={() => void requestAnalysis()}
            className="rounded border px-2 py-1"
          >
            같은 요청 다시 확인
          </button>
        )}
        {pointer?.jobId && !applied && (
          <button
            type="button"
            disabled={!allowed || busy}
            onClick={() => {
              setError(null);
              setCheck((value) => value + 1);
            }}
            className="rounded border px-2 py-1"
          >
            분석 상태 확인
          </button>
        )}
        {status?.status === "failed" && (
          <button
            type="button"
            disabled={!allowed || busy}
            onClick={() => void requestAnalysis(true)}
            className="rounded border px-2 py-1"
          >
            새 분석 요청
          </button>
        )}
        {status?.status === "analyzed" && !applied && (
          <button
            type="button"
            disabled={!allowed || !canApply || busy}
            onClick={() => void apply()}
            className="rounded border px-2 py-1"
          >
            편집 객체로 가져오기
          </button>
        )}
      </div>
      <p role="status">
        {!canRequest
          ? "편집 권한과 초안 상태가 필요합니다."
          : !online
            ? "오프라인 · 분석 확인을 일시 중지했습니다."
            : applied
              ? "가져오기 처리 완료 · 저장 대기열과 상단 저장 상태를 확인하세요."
              : busy
                ? "DWG 요청 확인 중…"
                : status
                  ? `${statusLabels[status.status]}${status.failureCode ? ` (${status.failureCode})` : ""}`
                  : pointer
                    ? "저장된 분석 요청을 확인하세요."
                    : "원본과 단위를 선택한 뒤 명시적으로 분석을 시작하세요."}
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {status?.status === "analyzed" && !canApply && (
        <p>
          현재 작업의 저장과 체크포인트 동기화가 완료되면 가져올 수 있습니다.
        </p>
      )}
      {summary && (
        <p>
          지원 객체 {summary.coverage.importedEntities}개 · 미지원{" "}
          {summary.coverage.unsupportedEntities}개
        </p>
      )}
      <details className="text-muted-foreground">
        <summary>DWG 편집 가져오기 · 실험 기능</summary>
        <p>
          LINE / LWPOLYLINE / CIRCLE / ARC / TEXT 지원. 원본 DWG는 변경하지
          않습니다. DWG 재저장·납품 호환성 미검증. 분석 완료는 저장 권한이나
          납품 검증을 의미하지 않습니다.
        </p>
        {summary?.warnings.map((warning, index) => <p key={`${warning.code}:${index}`}>{warning.detail}</p>)}
      </details>
    </section>
  );
}

function message(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : "DWG 요청을 확인하지 못했습니다. 같은 요청을 다시 확인하세요.";
}
