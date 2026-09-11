import { useEffect, useState, type FormEvent } from "react";

import type {
  DrawingCommand,
  DrawingDocumentState,
} from "~/lukas/lib/drawing-commands";
import { createDrawingPreciseGeometryUpdate } from "~/lukas/lib/drawing-geometry";
import type {
  DrawingGeometry,
  DrawingObject,
} from "~/lukas/lib/drawing-workspace.types";

type PreciseDrawingObject = DrawingObject & {
  geometry: Extract<DrawingGeometry, { type: "wall" | "dimension" }>;
};

type Props = {
  actorId: string;
  canEdit: boolean;
  object: PreciseDrawingObject;
  onCommand: (command: DrawingCommand) => void;
  state: Pick<DrawingDocumentState, "layers" | "objects">;
};

const fields = [
  ["startXMillimeters", "시작 X", "start", "x"],
  ["startYMillimeters", "시작 Y", "start", "y"],
  ["endXMillimeters", "끝 X", "end", "x"],
  ["endYMillimeters", "끝 Y", "end", "y"],
] as const;

type DrawingGeometryInspectorField =
  | (typeof fields)[number][0]
  | "offsetMillimeters";

type DrawingGeometryInspectorDraft = {
  baselineValues: Partial<Record<DrawingGeometryInspectorField, number>>;
  conflictedFields: DrawingGeometryInspectorField[];
  dirtyFields: DrawingGeometryInspectorField[];
  geometryType: PreciseDrawingObject["geometry"]["type"];
  objectId: string;
  objectVersion: number;
  values: Record<DrawingGeometryInspectorField, string>;
};

const fieldLabels: Record<DrawingGeometryInspectorField, string> = {
  startXMillimeters: "시작 X",
  startYMillimeters: "시작 Y",
  endXMillimeters: "끝 X",
  endYMillimeters: "끝 Y",
  offsetMillimeters: "치수 오프셋",
};

function geometryInspectorFieldValue(
  object: PreciseDrawingObject,
  field: DrawingGeometryInspectorField,
) {
  if (field === "offsetMillimeters")
    return object.geometry.type === "dimension" ? object.geometry.offset : 0;
  const point = field.startsWith("start") ? "start" : "end";
  const axis = field.includes("X") ? "x" : "y";
  return object.geometry[point][axis];
}

function geometryInspectorValues(object: PreciseDrawingObject) {
  return {
    startXMillimeters: String(object.geometry.start.x),
    startYMillimeters: String(object.geometry.start.y),
    endXMillimeters: String(object.geometry.end.x),
    endYMillimeters: String(object.geometry.end.y),
    offsetMillimeters:
      object.geometry.type === "dimension"
        ? String(object.geometry.offset)
        : "",
  };
}

/** Creates the local authored draft that survives advisory lock transitions. */
export function createDrawingGeometryInspectorDraft(
  object: PreciseDrawingObject,
): DrawingGeometryInspectorDraft {
  return {
    baselineValues: {},
    conflictedFields: [],
    dirtyFields: [],
    geometryType: object.geometry.type,
    objectId: object.id,
    objectVersion: object.version,
    values: geometryInspectorValues(object),
  };
}

/** Records the first canonical baseline for each locally edited field. */
export function editDrawingGeometryInspectorDraft(
  draft: DrawingGeometryInspectorDraft,
  object: PreciseDrawingObject,
  field: DrawingGeometryInspectorField,
  value: string,
): DrawingGeometryInspectorDraft {
  const current =
    draft.objectId === object.id && draft.geometryType === object.geometry.type
      ? reconcileDrawingGeometryInspectorDraft(draft, object)
      : createDrawingGeometryInspectorDraft(object);
  if (field === "offsetMillimeters" && object.geometry.type !== "dimension")
    throw new TypeError("벽에는 치수 오프셋을 입력할 수 없습니다.");
  const dirtyFields = current.dirtyFields.includes(field)
    ? current.dirtyFields
    : [...current.dirtyFields, field];
  return {
    ...current,
    baselineValues:
      field in current.baselineValues
        ? current.baselineValues
        : {
            ...current.baselineValues,
            [field]: geometryInspectorFieldValue(object, field),
          },
    dirtyFields,
    values: { ...current.values, [field]: value },
  };
}

/** Preserves dirty values while rebasing clean fields onto a remote projection. */
export function reconcileDrawingGeometryInspectorDraft(
  draft: DrawingGeometryInspectorDraft,
  object: PreciseDrawingObject,
): DrawingGeometryInspectorDraft {
  if (
    draft.objectId !== object.id ||
    draft.geometryType !== object.geometry.type
  )
    return createDrawingGeometryInspectorDraft(object);
  if (draft.objectVersion === object.version) return draft;
  if (draft.dirtyFields.length === 0)
    return createDrawingGeometryInspectorDraft(object);

  const canonicalValues = geometryInspectorValues(object);
  for (const field of draft.dirtyFields)
    canonicalValues[field] = draft.values[field];
  return {
    ...draft,
    conflictedFields: draft.dirtyFields.filter(
      (field) =>
        draft.baselineValues[field] !==
        geometryInspectorFieldValue(object, field),
    ),
    objectVersion: object.version,
    values: canonicalValues,
  };
}

function displayMillimeters(value: number) {
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 6 });
}

function geometryInspectorError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "정밀 위치를 변경하지 못했습니다.";
}

/** Precise authored geometry editor; canonical state/outbox remain authoritative. */
export function DrawingGeometryInspector({
  actorId,
  canEdit,
  object,
  onCommand,
  state,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(() =>
    createDrawingGeometryInspectorDraft(object),
  );
  const geometry = object.geometry;
  const activeDraft = reconcileDrawingGeometryInspectorDraft(draft, object);
  useEffect(() => {
    setDraft((current) =>
      reconcileDrawingGeometryInspectorDraft(current, object),
    );
    setError(null);
  }, [object.id, object.version]);

  const conflictMessage = activeDraft.conflictedFields.length
    ? `원격 변경과 충돌: ${activeDraft.conflictedFields
        .map((field) => fieldLabels[field])
        .join(
          ", ",
        )}. 최신값을 사용하거나 내 입력을 현재 버전에 다시 적용하세요.`
    : null;

  if (!canEdit) {
    return (
      <section
        aria-labelledby="drawing-geometry-inspector-title"
        className="mt-5 border-t border-slate-200 pt-4"
      >
        <h3 className="text-sm font-bold" id="drawing-geometry-inspector-title">
          정밀 위치
        </h3>
        <p className="mt-1 text-xs text-slate-600">단위 · mm</p>
        {activeDraft.dirtyFields.length > 0 ? (
          <p className="mt-2 text-xs text-amber-800" role="status">
            편집 잠금 또는 권한 변경으로 입력을 멈췄습니다. 로컬 초안은 보존되며
            편집 가능해지면 다시 적용하거나 취소할 수 있습니다.
          </p>
        ) : null}
        {conflictMessage ? (
          <p className="mt-2 text-xs text-red-700" role="alert">
            {conflictMessage}
          </p>
        ) : null}
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          {fields.map(([_name, label, point, axis]) => (
            <div
              className="rounded-md border border-slate-200 bg-slate-50 p-2"
              key={`${point}-${axis}`}
            >
              <dt className="text-slate-600">{label}</dt>
              <dd className="mt-1 text-slate-900">
                {displayMillimeters(geometry[point][axis])}
              </dd>
            </div>
          ))}
          {geometry.type === "dimension" ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
              <dt className="text-slate-600">치수 오프셋</dt>
              <dd className="mt-1 text-slate-900">
                {displayMillimeters(geometry.offset)}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>
    );
  }

  function clearDraft() {
    setDraft(createDrawingGeometryInspectorDraft(object));
    setError(null);
  }

  function applyDraft(allowConflict = false) {
    if (activeDraft.conflictedFields.length > 0 && !allowConflict) {
      setDraft(activeDraft);
      return;
    }
    try {
      const update = createDrawingPreciseGeometryUpdate(
        object,
        {
          startXMillimeters: activeDraft.values.startXMillimeters,
          startYMillimeters: activeDraft.values.startYMillimeters,
          endXMillimeters: activeDraft.values.endXMillimeters,
          endYMillimeters: activeDraft.values.endYMillimeters,
          ...(geometry.type === "dimension"
            ? { offsetMillimeters: activeDraft.values.offsetMillimeters }
            : {}),
        },
        state,
      );
      onCommand({ type: "update_objects", actorId, updates: [update] });
      setDraft((current) => ({
        ...current,
        baselineValues: {},
        conflictedFields: [],
        dirtyFields: [],
        objectVersion: object.version,
      }));
      setError(null);
    } catch (caught) {
      setError(geometryInspectorError(caught));
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    applyDraft();
  }

  return (
    <section
      aria-labelledby="drawing-geometry-inspector-title"
      className="mt-5 border-t border-slate-200 pt-4"
    >
      <h3 className="text-sm font-bold" id="drawing-geometry-inspector-title">
        정밀 위치
      </h3>
      <p className="mt-1 text-xs text-slate-600">단위 · mm</p>
      <form
        className="mt-3 grid gap-3"
        data-drawing-shortcuts="ignore"
        onReset={clearDraft}
        onSubmit={submit}
      >
        <div className="grid grid-cols-2 gap-2">
          {fields.map(([name, label, point, axis]) => (
            <label
              className="grid gap-1 text-xs"
              htmlFor={`geometry-${object.id}-${name}`}
              key={name}
            >
              {label}
              <input
                className="min-h-10 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900"
                id={`geometry-${object.id}-${name}`}
                max={9_000_000_000}
                min={-9_000_000_000}
                name={name}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDraft((current) =>
                    editDrawingGeometryInspectorDraft(
                      current,
                      object,
                      name,
                      value,
                    ),
                  );
                }}
                required
                step="0.000001"
                type="number"
                value={activeDraft.values[name]}
              />
            </label>
          ))}
        </div>
        {geometry.type === "dimension" ? (
          <label
            className="grid gap-1 text-xs"
            htmlFor={`geometry-${object.id}-offsetMillimeters`}
          >
            치수 오프셋
            <input
              className="min-h-10 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900"
              id={`geometry-${object.id}-offsetMillimeters`}
              max={9_000_000_000}
              min={-9_000_000_000}
              name="offsetMillimeters"
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDraft((current) =>
                  editDrawingGeometryInspectorDraft(
                    current,
                    object,
                    "offsetMillimeters",
                    value,
                  ),
                );
              }}
              required
              step="0.000001"
              type="number"
              value={activeDraft.values.offsetMillimeters}
            />
          </label>
        ) : null}
        {conflictMessage ? (
          <p className="text-xs text-red-700" role="alert">
            {conflictMessage}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          {conflictMessage ? (
            <>
              <button
                className="min-h-10 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700"
                onClick={clearDraft}
                type="button"
              >
                최신값 사용
              </button>
              <button
                className="min-h-10 rounded-md bg-amber-500 px-3 text-sm font-semibold text-slate-950"
                onClick={() => applyDraft(true)}
                type="button"
              >
                내 입력 재적용
              </button>
            </>
          ) : (
            <>
              <button
                className="min-h-10 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700"
                type="reset"
              >
                취소
              </button>
              <button
                className="min-h-10 rounded-md bg-indigo-600 px-3 text-sm font-semibold text-white"
                type="submit"
              >
                정밀 위치 적용
              </button>
            </>
          )}
        </div>
      </form>
      {error ? (
        <p className="mt-3 text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
