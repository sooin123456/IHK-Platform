type PerformanceTargets = {
  maxP95Milliseconds: number;
  minFramesPerSecond: number;
};

type InteractionPerformance = {
  calculatedFps: number;
  p50FrameMilliseconds: number;
  p95FrameMilliseconds: number;
  sampleCount: number;
  status: "PASS" | "NOT MET";
};

export function nearestRankPercentile(values: number[], fraction: number) {
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1)
    throw new Error("M1 percentile fraction must be a finite number in (0, 1]");
  if (!values.length) throw new Error("M1 performance sample is empty");
  if (!values.every((value) => Number.isFinite(value) && value > 0))
    throw new Error("M1 performance samples must be positive finite numbers");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  ];
}

export function calculateFramesPerSecond(frameTimesMilliseconds: number[]) {
  nearestRankPercentile(frameTimesMilliseconds, 0.5);
  return (
    (frameTimesMilliseconds.length * 1000) /
    frameTimesMilliseconds.reduce(
      (total, milliseconds) => total + milliseconds,
      0,
    )
  );
}

export function summarizeInteractionFrameTimes(
  interactionFrameTimesMilliseconds: Record<string, number[]>,
  targets: PerformanceTargets,
) {
  const entries = Object.entries(interactionFrameTimesMilliseconds);
  if (!entries.length) throw new Error("M1 interaction samples are empty");
  const interactions = Object.fromEntries(
    entries.map(([name, frameTimes]) => {
      const p50FrameMilliseconds = nearestRankPercentile(frameTimes, 0.5);
      const p95FrameMilliseconds = nearestRankPercentile(frameTimes, 0.95);
      const calculatedFps = calculateFramesPerSecond(frameTimes);
      const status =
        p95FrameMilliseconds <= targets.maxP95Milliseconds &&
        calculatedFps >= targets.minFramesPerSecond
          ? "PASS"
          : "NOT MET";
      return [
        name,
        {
          calculatedFps,
          p50FrameMilliseconds,
          p95FrameMilliseconds,
          sampleCount: frameTimes.length,
          status,
        } satisfies InteractionPerformance,
      ];
    }),
  ) as Record<string, InteractionPerformance>;
  const metrics = Object.values(interactions);
  return {
    calculatedFps: Math.min(...metrics.map((metric) => metric.calculatedFps)),
    interactions,
    p50FrameMilliseconds: Math.max(
      ...metrics.map((metric) => metric.p50FrameMilliseconds),
    ),
    p95FrameMilliseconds: Math.max(
      ...metrics.map((metric) => metric.p95FrameMilliseconds),
    ),
    sampleCount: metrics.reduce(
      (total, metric) => total + metric.sampleCount,
      0,
    ),
    status: metrics.every((metric) => metric.status === "PASS")
      ? ("PASS" as const)
      : ("NOT MET" as const),
  };
}
