import { useCallback, useEffect, useState } from "react";

import {
  calibrateDrawingCanvasCommand,
  type DrawingCommand,
  type DrawingDocumentState,
} from "~/lukas/lib/drawing-commands";
import type { DrawingCanvas, Point } from "~/lukas/lib/drawing-workspace.types";
import type { DrawingCalibrationCapture } from "./drawing-canvas.client";

type Props = {
  actorId: string;
  canEdit: boolean;
  canvas: DrawingCanvas;
  onCalibrationCaptureChange: (
    capture: DrawingCalibrationCapture | null,
  ) => void;
  onCommand: (command: DrawingCommand) => void;
  state: DrawingDocumentState;
};

export function DrawingScaleControl({
  actorId,
  canEdit,
  canvas,
  onCalibrationCaptureChange,
  onCommand,
  state,
}: Props) {
  const [capturing, setCapturing] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pdf =
    canvas.spaceKind === "paper" &&
    canvas.background !== null &&
    canvas.background.pdfPageNumber !== null;
  const calibration = pdf ? canvas.background!.calibration : null;
  const onPoint = useCallback((point: Point) => {
    setPoints((current) => {
      if (current.length !== 1) return current.length === 0 ? [point] : current;
      setCapturing(false);
      return [current[0], point];
    });
  }, []);
  const cancelCapture = useCallback(() => {
    setCapturing(false);
    setPoints([]);
  }, []);

  useEffect(() => {
    onCalibrationCaptureChange(
      capturing ? { active: true, onCancel: cancelCapture, onPoint } : null,
    );
    return () => onCalibrationCaptureChange(null);
  }, [cancelCapture, capturing, onCalibrationCaptureChange, onPoint]);
  useEffect(() => {
    setCapturing(false);
    setPoints([]);
    setError(null);
  }, [canvas.id]);
  useEffect(() => {
    if (canEdit && pdf) return;
    setCapturing(false);
    setPoints([]);
  }, [canEdit, pdf]);
  useEffect(() => {
    if (!capturing) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      cancelCapture();
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [cancelCapture, capturing]);

  if (!pdf)
    return (
      <section aria-label="도면 축척" className="mb-4 text-xs text-slate-300">
        기준 좌표 · 1 도면 단위 = 1 mm
      </section>
    );

  const status = calibration
    ? `보정 길이 ${calibration.realLengthMillimeters} mm`
    : "축척 미확정";
  if (!canEdit)
    return (
      <section aria-label="도면 축척" className="mb-4 text-xs text-slate-300">
        <p>{status}</p>
        <p className="mt-1 text-slate-400">
          조회 전용 · 축척을 변경할 수 없습니다.
        </p>
      </section>
    );

  const choosePoints = () => {
    setPoints([]);
    setCapturing(true);
    setError(null);
  };
  return (
    <section aria-label="도면 축척" className="mb-4 text-xs text-slate-300">
      <p className="font-semibold text-white">{status}</p>
      {calibration ? (
        <p className="mt-1 text-amber-200">
          다시 보정하면 현재 초안 수량이 변경될 수 있습니다.
        </p>
      ) : null}
      <button
        className="mt-2 min-h-9 rounded border border-white/20 px-2 font-semibold text-white"
        onClick={choosePoints}
        type="button"
      >
        {calibration ? "다시 보정" : "두 점 선택"}
      </button>
      {!calibration || capturing || points.length > 0 ? (
        <form
          className="mt-2 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (points.length !== 2) return;
            try {
              const data = new FormData(event.currentTarget);
              onCommand(
                calibrateDrawingCanvasCommand(state, actorId, canvas.id, {
                  normalizedStart: points[0],
                  normalizedEnd: points[1],
                  knownLength: String(data.get("knownLength") ?? ""),
                  unit: String(data.get("unit")) as "mm" | "cm" | "m",
                }),
              );
              setPoints([]);
              setError(null);
            } catch (caught) {
              setError(
                caught instanceof Error
                  ? caught.message
                  : "PDF 축척을 보정하지 못했습니다.",
              );
            }
          }}
        >
          <p>
            {capturing
              ? `${points.length + 1}번째 점을 선택하세요.`
              : points.length === 2
                ? "2점 선택 완료"
                : "두 점 선택"}
          </p>
          <div className="flex gap-2">
            <label className="grid flex-1 gap-1">
              실제 길이
              <input
                className="min-h-9 rounded border border-white/15 bg-slate-950 px-2"
                inputMode="decimal"
                name="knownLength"
                required
              />
            </label>
            <label className="grid gap-1">
              단위
              <select
                className="min-h-9 rounded border border-white/15 bg-slate-950 px-2"
                defaultValue="mm"
                name="unit"
              >
                <option value="mm">mm</option>
                <option value="cm">cm</option>
                <option value="m">m</option>
              </select>
            </label>
          </div>
          <button
            className="min-h-9 rounded bg-indigo-500 px-3 font-semibold text-white disabled:opacity-50"
            disabled={points.length !== 2}
            type="submit"
          >
            축척 저장
          </button>
          {error ? (
            <p className="text-red-200" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
