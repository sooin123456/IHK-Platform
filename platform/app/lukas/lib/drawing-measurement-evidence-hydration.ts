import { useEffect, useRef, useState } from "react";

import { decodeDrawingServerMeasurementEvidence } from "./drawing-workspace-loader-payload.ts";

type MeasurementEvidenceWire = Parameters<
  typeof decodeDrawingServerMeasurementEvidence
>[0];
type MeasurementBootstrap = Parameters<
  typeof decodeDrawingServerMeasurementEvidence
>[1];
type MeasurementEvidenceResult = ReturnType<
  typeof decodeDrawingServerMeasurementEvidence
>;

type MeasurementEvidenceFetcher = (
  input: string,
  init: {
    credentials: "same-origin";
    headers: { accept: "application/json" };
    keepalive: true;
    signal?: AbortSignal;
  },
) => Promise<Response>;

type DrawingMeasurementHydrationScheduler = {
  requestIdleCallback?: (
    callback: () => void,
    options: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
};

const PENDING_MEASUREMENT_EVIDENCE: MeasurementEvidenceResult = {
  evidence: null,
  error: null,
};

const FAILED_MEASUREMENT_EVIDENCE: MeasurementEvidenceResult = {
  evidence: null,
  error: {
    code: "measurement_derivation_failed",
    message: "서버 측정 증거를 계산하지 못했습니다.",
  },
};

export function drawingMeasurementEvidenceResourceReady({
  checkpointReady,
  consumerVisible,
  saved,
}: {
  checkpointReady: boolean;
  consumerVisible: boolean;
  saved: boolean;
}) {
  return checkpointReady && consumerVisible && saved;
}

export async function fetchDrawingMeasurementEvidenceResource({
  url,
  bootstrap,
  signal,
  onCheckpointStale,
  fetcher = fetch,
}: {
  url: string;
  bootstrap: MeasurementBootstrap;
  signal?: AbortSignal;
  onCheckpointStale?: () => void;
  fetcher?: MeasurementEvidenceFetcher;
}): Promise<MeasurementEvidenceResult> {
  try {
    const response = await fetcher(url, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      keepalive: true,
      signal,
    });
    if (response.status === 409) {
      if (!signal?.aborted) onCheckpointStale?.();
      return PENDING_MEASUREMENT_EVIDENCE;
    }
    if (!response.ok) return FAILED_MEASUREMENT_EVIDENCE;
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      return FAILED_MEASUREMENT_EVIDENCE;
    const resource = payload as {
      measurementEvidence?: MeasurementEvidenceWire;
      measurementEvidenceError?: unknown;
    };
    if (resource.measurementEvidence)
      return decodeDrawingServerMeasurementEvidence(
        resource.measurementEvidence,
        bootstrap,
      );
    if (
      resource.measurementEvidenceError &&
      typeof resource.measurementEvidenceError === "object" &&
      !Array.isArray(resource.measurementEvidenceError) &&
      (resource.measurementEvidenceError as { code?: unknown }).code ===
        "measurement_derivation_failed" &&
      (resource.measurementEvidenceError as { message?: unknown }).message ===
        "서버 측정 증거를 계산하지 못했습니다."
    )
      return {
        evidence: null,
        error: resource.measurementEvidenceError as NonNullable<
          MeasurementEvidenceResult["error"]
        >,
      };
    return PENDING_MEASUREMENT_EVIDENCE;
  } catch {
    return FAILED_MEASUREMENT_EVIDENCE;
  }
}

/** Keeps O(n) evidence reconstruction behind the first interactive paint. */
export function scheduleDrawingMeasurementEvidenceHydration({
  hydrate,
  scheduler = window,
}: {
  hydrate: () => void;
  scheduler?: DrawingMeasurementHydrationScheduler;
}) {
  let active = true;
  let idleHandle: number | null = null;
  let timerHandle: number | null = null;
  const run = () => {
    if (!active) return;
    active = false;
    hydrate();
  };
  if (typeof scheduler.requestIdleCallback === "function")
    idleHandle = scheduler.requestIdleCallback(run, { timeout: 750 });
  else timerHandle = scheduler.setTimeout(run, 0);
  return () => {
    if (!active) return;
    active = false;
    if (idleHandle !== null) scheduler.cancelIdleCallback?.(idleHandle);
    if (timerHandle !== null) scheduler.clearTimeout(timerHandle);
  };
}

export function useDeferredDrawingMeasurementEvidence(
  wire: MeasurementEvidenceWire,
  bootstrap: MeasurementBootstrap,
): MeasurementEvidenceResult {
  const [hydrated, setHydrated] = useState<{
    wire: MeasurementEvidenceWire;
    bootstrap: MeasurementBootstrap;
    result: MeasurementEvidenceResult;
  } | null>(null);
  useEffect(() => {
    if (!wire || !bootstrap) return;
    return scheduleDrawingMeasurementEvidenceHydration({
      hydrate: () =>
        setHydrated({
          wire,
          bootstrap,
          result: decodeDrawingServerMeasurementEvidence(wire, bootstrap),
        }),
    });
  }, [bootstrap, wire]);
  return hydrated && hydrated.wire === wire && hydrated.bootstrap === bootstrap
    ? hydrated.result
    : PENDING_MEASUREMENT_EVIDENCE;
}

export function useDeferredDrawingMeasurementEvidenceResource({
  enabled,
  url,
  bootstrap,
  onCheckpointStale,
}: {
  enabled: boolean;
  url?: string | null;
  bootstrap: MeasurementBootstrap;
  onCheckpointStale?: () => void;
}): MeasurementEvidenceResult {
  const onCheckpointStaleRef = useRef(onCheckpointStale);
  onCheckpointStaleRef.current = onCheckpointStale;
  const lastStaleUrlRef = useRef<string | null>(null);
  const [loaded, setLoaded] = useState<{
    url: string;
    bootstrap: MeasurementBootstrap;
    result: MeasurementEvidenceResult;
  } | null>(null);
  useEffect(() => {
    if (!enabled || !url || !bootstrap) return;
    let active = true;
    const cancel = scheduleDrawingMeasurementEvidenceHydration({
      hydrate: () => {
        void fetchDrawingMeasurementEvidenceResource({
          url,
          bootstrap,
          onCheckpointStale: () => {
            if (!active) return;
            if (lastStaleUrlRef.current === url) return;
            lastStaleUrlRef.current = url;
            onCheckpointStaleRef.current?.();
          },
        }).then((result) => {
          if (!active) return;
          if (result.evidence || result.error) lastStaleUrlRef.current = null;
          setLoaded({ url, bootstrap, result });
        });
      },
    });
    return () => {
      active = false;
      cancel();
    };
  }, [bootstrap, enabled, url]);
  return loaded && loaded.url === url && loaded.bootstrap === bootstrap
    ? loaded.result
    : PENDING_MEASUREMENT_EVIDENCE;
}
