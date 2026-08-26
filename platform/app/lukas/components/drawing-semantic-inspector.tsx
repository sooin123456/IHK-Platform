import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type {
  DrawingCommand,
  DrawingDocumentState,
} from "~/lukas/lib/drawing-commands";
import {
  formatDrawingMeasurement,
  measureDrawingObject,
} from "~/lukas/lib/drawing-measurements";
import {
  drawingMeasurementEvidenceCurrent,
  resolveDrawingServerEvidenceStatus,
  type DrawingMeasurementEvidenceError,
  type DrawingMeasurementEvidenceLineage,
  type DrawingServerMeasurementEvidence,
} from "~/lukas/lib/drawing-semantic-schedules";
import {
  DrawingGeometrySchema,
  type DrawingObject,
  type DrawingSemanticGeometry,
} from "~/lukas/lib/drawing-workspace.types";

type Props = {
  actorId: string;
  canEdit: boolean;
  object: DrawingObject & { geometry: DrawingSemanticGeometry };
  onCommand: (command: DrawingCommand) => void;
  state: Pick<DrawingDocumentState, "revisionId" | "objects">;
  evidence?: DrawingServerMeasurementEvidence | null;
  evidenceError?: DrawingMeasurementEvidenceError | null;
  lineage?: DrawingMeasurementEvidenceLineage | null;
  hasUnconfirmedChanges?: boolean;
};

const inputClass =
  "min-h-10 rounded-md border border-white/15 bg-slate-950 px-2 text-sm disabled:opacity-60";

function number(data: FormData, name: string) {
  return Number(data.get(name));
}

function optionalText(data: FormData, name: string) {
  const value = String(data.get(name) ?? "").trim();
  return value || null;
}

type DrawingSemanticInspectorDraftBaseline = {
  objectId: string;
  objectVersion: number;
  fields: Record<string, unknown>;
};

function drawingSemanticInspectorFieldValue(
  object: DrawingObject & { geometry: DrawingSemanticGeometry },
  field: string,
) {
  if (
    object.geometry.type === "space" &&
    ["floor", "wall", "ceiling"].includes(field)
  )
    return object.geometry.finishes[
      field as keyof typeof object.geometry.finishes
    ];
  return (object.geometry as unknown as Record<string, unknown>)[field];
}

function sameDrawingSemanticInspectorValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Classifies a dirty form against a newly projected canonical object. */
export function drawingSemanticInspectorDraftStatus(
  baseline: DrawingSemanticInspectorDraftBaseline,
  object: (DrawingObject & { geometry: DrawingSemanticGeometry }) | null,
) {
  if (!object || object.id !== baseline.objectId)
    return { kind: "clear" as const, conflictedFields: [] as string[] };
  if (object.version === baseline.objectVersion)
    return { kind: "preserve" as const, conflictedFields: [] as string[] };
  return {
    kind: "preserve" as const,
    conflictedFields: Object.entries(baseline.fields)
      .filter(
        ([field, value]) =>
          !sameDrawingSemanticInspectorValue(
            value,
            drawingSemanticInspectorFieldValue(object, field),
          ),
      )
      .map(([field]) => field),
  };
}

const semanticDraftConflictMessage =
  "편집 중인 건축 속성이 다른 변경에서 수정되었습니다. 취소한 뒤 최신 값을 확인하세요.";

export function DrawingSemanticInspector({
  actorId,
  canEdit,
  evidence,
  evidenceError,
  hasUnconfirmedChanges = false,
  lineage,
  object,
  onCommand,
  state,
}: Props) {
  const dirtyFields = useRef(new Set<string>());
  const draftBaseline = useRef<DrawingSemanticInspectorDraftBaseline | null>(
    null,
  );
  const selectedObjectId = useRef(object.id);
  const [error, setError] = useState<string | null>(null);
  const measurement = useMemo(() => {
    try {
      return measureDrawingObject(object, state.objects);
    } catch {
      return null;
    }
  }, [object, state.objects]);
  const serverStatus = resolveDrawingServerEvidenceStatus(
    evidence,
    drawingMeasurementEvidenceCurrent(lineage, state, hasUnconfirmedChanges),
  );
  const serverMeasurement =
    serverStatus.status === "confirmed"
      ? evidence?.measurements[object.id]?.measurement
      : null;

  useEffect(() => {
    if (selectedObjectId.current !== object.id) {
      selectedObjectId.current = object.id;
      dirtyFields.current.clear();
      draftBaseline.current = null;
      setError(null);
      return;
    }
    if (!draftBaseline.current) return;
    const status = drawingSemanticInspectorDraftStatus(
      draftBaseline.current,
      object,
    );
    if (status.kind === "clear") {
      dirtyFields.current.clear();
      draftBaseline.current = null;
      setError(null);
      return;
    }
    if (status.conflictedFields.length > 0)
      setError(semanticDraftConflictMessage);
    else
      setError((current) =>
        current === semanticDraftConflictMessage ? null : current,
      );
  }, [object]);

  function dirty(name: string) {
    draftBaseline.current ??= {
      objectId: object.id,
      objectVersion: object.version,
      fields: {},
    };
    if (!(name in draftBaseline.current.fields))
      draftBaseline.current.fields[name] = drawingSemanticInspectorFieldValue(
        object,
        name,
      );
    dirtyFields.current.add(name);
  }

  function clearDraft() {
    dirtyFields.current.clear();
    draftBaseline.current = null;
    setError(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || dirtyFields.current.size === 0) return;
    if (draftBaseline.current) {
      const status = drawingSemanticInspectorDraftStatus(
        draftBaseline.current,
        object,
      );
      if (status.kind === "clear") {
        clearDraft();
        return;
      }
      if (status.conflictedFields.length > 0) {
        setError(semanticDraftConflictMessage);
        return;
      }
    }
    const data = new FormData(event.currentTarget);
    const geometry = structuredClone(object.geometry);
    const changed = dirtyFields.current;
    if (geometry.type === "wall") {
      if (changed.has("thicknessMillimeters"))
        geometry.thicknessMillimeters = number(data, "thicknessMillimeters");
      if (changed.has("heightMillimeters"))
        geometry.heightMillimeters = number(data, "heightMillimeters");
    } else if (geometry.type === "opening") {
      if (changed.has("openingKind"))
        geometry.openingKind = String(data.get("openingKind")) as
          "door" | "window" | "void";
      for (const field of [
        "offsetMillimeters",
        "widthMillimeters",
        "heightMillimeters",
        "sillHeightMillimeters",
      ] as const) {
        if (changed.has(field)) geometry[field] = number(data, field);
      }
      if (geometry.openingKind === "door") geometry.sillHeightMillimeters = 0;
    } else if (geometry.type === "space") {
      if (changed.has("number"))
        geometry.number = String(data.get("number") ?? "").trim();
      for (const field of ["floor", "wall", "ceiling"] as const) {
        if (changed.has(field))
          geometry.finishes[field] = optionalText(data, field);
      }
    } else if (geometry.type === "arc") {
      if (changed.has("radius")) geometry.radius = number(data, "radius");
      if (changed.has("startAngleDegrees"))
        geometry.startAngleDegrees = number(data, "startAngleDegrees");
      if (changed.has("sweepAngleDegrees"))
        geometry.sweepAngleDegrees = number(data, "sweepAngleDegrees");
    }
    try {
      const parsed = DrawingGeometrySchema.parse(geometry);
      onCommand({
        type: "update_objects",
        actorId,
        updates: [
          {
            objectId: object.id,
            baseVersion: object.version,
            patch: { geometry: parsed },
          },
        ],
      });
      clearDraft();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "건축 객체 속성을 변경하지 못했습니다.",
      );
    }
  }

  const geometry = object.geometry;
  return (
    <section
      aria-labelledby="drawing-semantic-inspector-title"
      className="mt-5 border-t border-white/10 pt-4"
    >
      <h3 className="text-sm font-bold" id="drawing-semantic-inspector-title">
        건축 객체
      </h3>
      <dl className="mt-3 grid gap-2 rounded-md bg-white/5 p-3 text-xs">
        <div>
          <dt className="font-semibold text-slate-300">미리보기</dt>
          <dd className="mt-1 text-slate-100">
            {measurement
              ? [
                  formatDrawingMeasurement(measurement, "millimeters"),
                  formatDrawingMeasurement(measurement, "squareMeters"),
                  `수량 ${measurement.count}`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "계산할 수 없음"}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-300">서버 계산 · V1</dt>
          {evidenceError ? (
            <dd className="mt-1 text-rose-200" role="alert">
              계산 오류 · 미확정 · {evidenceError.message}
            </dd>
          ) : serverMeasurement && evidence ? (
            <dd className="mt-1 text-emerald-200">
              확정 ·{" "}
              {[
                formatDrawingMeasurement(serverMeasurement, "millimeters"),
                formatDrawingMeasurement(serverMeasurement, "squareMeters"),
                `수량 ${serverMeasurement.count}`,
              ]
                .filter(Boolean)
                .join(" · ")}
              <span className="mt-1 block text-[11px] text-slate-400">
                {evidence.ruleVersion} · 체크포인트{" "}
                {evidence.operationCheckpoint}
                {" · "}Postgres 권한 확인 로드 · revision {evidence.revisionId}
                {" · "}객체 {object.id}
              </span>
            </dd>
          ) : evidence ? (
            <dd className="mt-1 text-amber-200">
              서버 증거 오래됨 · 현재 revision/checkpoint/object lineage와
              일치하지 않아 미확정입니다.
              <span className="mt-1 block text-[11px] text-slate-400">
                {evidence.ruleVersion} · 체크포인트{" "}
                {evidence.operationCheckpoint}
                {" · "}Postgres 권한 확인 로드
              </span>
            </dd>
          ) : (
            <dd className="mt-1 text-amber-200">
              서버 증거를 불러오기 전이며 미리보기 값은 확정값이 아닙니다.
            </dd>
          )}
        </div>
      </dl>

      <form
        className="mt-3 grid gap-3"
        data-drawing-shortcuts="ignore"
        key={object.id}
        onReset={clearDraft}
        onSubmit={submit}
      >
        {geometry.type === "wall" ? (
          <>
            <SemanticNumber
              canEdit={canEdit}
              label="벽 두께"
              name="thicknessMillimeters"
              onDirty={dirty}
              value={geometry.thicknessMillimeters}
            />
            <SemanticNumber
              canEdit={canEdit}
              label="벽 높이"
              name="heightMillimeters"
              onDirty={dirty}
              value={geometry.heightMillimeters}
            />
          </>
        ) : null}
        {geometry.type === "opening" ? (
          <>
            <label
              className="grid gap-1 text-xs"
              htmlFor="semantic-opening-kind"
            >
              개구부 종류
              <select
                className={inputClass}
                defaultValue={geometry.openingKind}
                disabled={!canEdit}
                id="semantic-opening-kind"
                name="openingKind"
                onChange={() => dirty("openingKind")}
              >
                <option value="door">문</option>
                <option value="window">창</option>
                <option value="void">빈 개구부</option>
              </select>
            </label>
            <p className="text-xs text-slate-400">
              호스트 벽 · {geometry.hostWallId}
            </p>
            {[
              [
                "offsetMillimeters",
                "벽 기준 오프셋",
                geometry.offsetMillimeters,
              ],
              ["widthMillimeters", "개구부 너비", geometry.widthMillimeters],
              ["heightMillimeters", "개구부 높이", geometry.heightMillimeters],
              [
                "sillHeightMillimeters",
                "하부 높이",
                geometry.sillHeightMillimeters,
              ],
            ].map(([name, label, value]) => (
              <SemanticNumber
                canEdit={canEdit}
                key={String(name)}
                label={String(label)}
                min={String(name) === "sillHeightMillimeters" ? 0 : 0.000001}
                name={String(name)}
                onDirty={dirty}
                value={Number(value)}
              />
            ))}
          </>
        ) : null}
        {geometry.type === "space" ? (
          <>
            <SemanticText
              canEdit={canEdit}
              label="공간 번호"
              name="number"
              onDirty={dirty}
              value={geometry.number}
            />
            <SemanticText
              canEdit={canEdit}
              label="바닥 마감"
              name="floor"
              onDirty={dirty}
              value={geometry.finishes.floor ?? ""}
            />
            <SemanticText
              canEdit={canEdit}
              label="벽 마감"
              name="wall"
              onDirty={dirty}
              value={geometry.finishes.wall ?? ""}
            />
            <SemanticText
              canEdit={canEdit}
              label="천장 마감"
              name="ceiling"
              onDirty={dirty}
              value={geometry.finishes.ceiling ?? ""}
            />
          </>
        ) : null}
        {geometry.type === "arc" ? (
          <>
            <SemanticNumber
              canEdit={canEdit}
              label="호 반지름"
              name="radius"
              onDirty={dirty}
              value={geometry.radius}
            />
            <SemanticNumber
              canEdit={canEdit}
              label="시작 각도"
              min={-9_000_000_000}
              name="startAngleDegrees"
              onDirty={dirty}
              value={geometry.startAngleDegrees}
            />
            <SemanticNumber
              canEdit={canEdit}
              label="호 각도"
              min={-360}
              name="sweepAngleDegrees"
              onDirty={dirty}
              value={geometry.sweepAngleDegrees}
            />
          </>
        ) : null}
        {canEdit &&
        ["wall", "opening", "space", "arc"].includes(geometry.type) ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              className="min-h-10 rounded-md border border-white/15 px-3 text-sm font-semibold text-slate-200"
              type="reset"
            >
              건축 속성 취소
            </button>
            <button
              className="min-h-10 rounded-md bg-indigo-500 px-3 text-sm font-semibold text-white"
              type="submit"
            >
              건축 속성 적용
            </button>
          </div>
        ) : null}
      </form>
      {error ? (
        <p className="mt-3 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function SemanticNumber({
  canEdit,
  label,
  min = 0.000001,
  name,
  onDirty,
  value,
}: {
  canEdit: boolean;
  label: string;
  min?: number;
  name: string;
  onDirty: (name: string) => void;
  value: number;
}) {
  return (
    <label className="grid gap-1 text-xs" htmlFor={`semantic-${name}`}>
      {label}
      <input
        className={inputClass}
        defaultValue={value}
        disabled={!canEdit}
        id={`semantic-${name}`}
        min={min}
        name={name}
        onChange={() => onDirty(name)}
        step="0.000001"
        type="number"
      />
    </label>
  );
}

function SemanticText({
  canEdit,
  label,
  name,
  onDirty,
  value,
}: {
  canEdit: boolean;
  label: string;
  name: string;
  onDirty: (name: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-xs" htmlFor={`semantic-${name}`}>
      {label}
      <input
        className={inputClass}
        defaultValue={value}
        disabled={!canEdit}
        id={`semantic-${name}`}
        maxLength={255}
        name={name}
        onChange={() => onDirty(name)}
      />
    </label>
  );
}
