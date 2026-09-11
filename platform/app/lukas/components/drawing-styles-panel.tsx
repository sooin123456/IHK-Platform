import { useEffect, useState, type FormEvent } from "react";

import {
  createDrawingStyleCommand,
  deleteDrawingStyleCommand,
  updateDrawingStyleCommand,
  type DrawingCommand,
  type DrawingDocumentState,
} from "~/lukas/lib/drawing-commands";
import {
  DrawingStyleSchema,
  type DrawingStyle,
  type DrawingStyleDefinition,
} from "~/lukas/lib/drawing-workspace.types";

export type DrawingStylePersistenceStatus =
  | "pending"
  | "settled"
  | "conflicted"
  | "failed";

type Props = {
  actorId: string;
  canEdit: boolean;
  onCommand: (command: DrawingCommand) => boolean | void;
  persistenceStatus?: DrawingStylePersistenceStatus;
  state: Pick<
    DrawingDocumentState,
    "revisionId" | "layers" | "objects" | "structure"
  >;
};

const defaultValue: DrawingStyle = {
  stroke: "#2563eb",
  strokeWidth: 2,
  fill: null,
};
const defaultFillColor = "#ffffff";
const strokeColorPattern = /^#[0-9a-f]{6}$/i;
const fillColorPattern = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

type DrawingStyleDraftValues = {
  name: string;
  stroke: string;
  strokeWidth: string;
  fill: string;
  fillNone: boolean;
  fontSize: string;
};

export type DrawingStyleDraftField =
  | "name"
  | "stroke"
  | "strokeWidth"
  | "fill"
  | "fontSize";

type DrawingStyleDraftSubmission = {
  baseVersion: number | null;
  patch: { name: string; value: DrawingStyle };
  sawPending: boolean;
  targetStyleId: string;
};

export type DrawingStyleDraft = {
  baselineValues: DrawingStyleDraftValues;
  conflictedFields: DrawingStyleDraftField[];
  dirtyFields: DrawingStyleDraftField[];
  nativeColors: { stroke: string; fill: string };
  styleId: string | null;
  styleVersion: number | null;
  submission: DrawingStyleDraftSubmission | null;
  submissionRejected: boolean;
  values: DrawingStyleDraftValues;
};

function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "스타일을 변경하지 못했습니다.";
}

function valuesForStyle(
  style: DrawingStyleDefinition | undefined,
): DrawingStyleDraftValues {
  const value = style?.value ?? defaultValue;
  return {
    name: style?.name ?? "",
    stroke: value.stroke,
    strokeWidth: String(value.strokeWidth),
    fill: value.fill ?? defaultFillColor,
    fillNone: value.fill === null,
    fontSize: value.fontSize === undefined ? "" : String(value.fontSize),
  };
}

function nativeColorsForValues(values: DrawingStyleDraftValues) {
  return {
    stroke: strokeColorPattern.test(values.stroke)
      ? values.stroke
      : defaultValue.stroke,
    fill: fillColorPattern.test(values.fill)
      ? values.fill.slice(0, 7)
      : defaultFillColor,
  };
}

function sameDraftField(
  left: DrawingStyleDraftValues,
  right: DrawingStyleDraftValues,
  field: DrawingStyleDraftField,
) {
  return field === "fill"
    ? left.fill === right.fill && left.fillNone === right.fillNone
    : left[field] === right[field];
}

function copyDraftField(
  target: DrawingStyleDraftValues,
  source: DrawingStyleDraftValues,
  field: DrawingStyleDraftField,
) {
  if (field === "fill") {
    target.fill = source.fill;
    target.fillNone = source.fillNone;
  } else {
    target[field] = source[field];
  }
}

/** Creates a controlled local draft for a definition or the create form. */
export function createDrawingStyleDraft(
  style?: DrawingStyleDefinition,
): DrawingStyleDraft {
  const values = valuesForStyle(style);
  return {
    baselineValues: { ...values },
    conflictedFields: [],
    dirtyFields: [],
    nativeColors: nativeColorsForValues(values),
    styleId: style?.id ?? null,
    styleVersion: style?.version ?? null,
    submission: null,
    submissionRejected: false,
    values,
  };
}

/** Edits one field without discarding invalid intermediate controlled text. */
export function editDrawingStyleDraft(
  draft: DrawingStyleDraft,
  field: DrawingStyleDraftField,
  value: string,
): DrawingStyleDraft {
  const values = { ...draft.values, [field]: value };
  const dirty = !sameDraftField(values, draft.baselineValues, field);
  const dirtyFields = dirty
    ? draft.dirtyFields.includes(field)
      ? draft.dirtyFields
      : [...draft.dirtyFields, field]
    : draft.dirtyFields.filter((candidate) => candidate !== field);
  const nativeColors = { ...draft.nativeColors };
  if (field === "stroke" && strokeColorPattern.test(value))
    nativeColors.stroke = value;
  if (field === "fill" && fillColorPattern.test(value))
    nativeColors.fill = value.slice(0, 7);
  return {
    ...draft,
    conflictedFields: dirty
      ? draft.conflictedFields
      : draft.conflictedFields.filter((candidate) => candidate !== field),
    dirtyFields,
    nativeColors,
    submission: null,
    submissionRejected: false,
    values,
  };
}

/** Uses the native RGB picker while retaining an authored fill alpha suffix. */
export function applyDrawingStyleDraftNativeColor(
  draft: DrawingStyleDraft,
  field: "stroke" | "fill",
  color: string,
): DrawingStyleDraft {
  if (!strokeColorPattern.test(color))
    throw new TypeError("Native drawing colors require six-digit HEX values.");
  if (field === "stroke") return editDrawingStyleDraft(draft, field, color);
  const alpha = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(draft.values.fill)?.[1];
  return editDrawingStyleDraft(draft, field, `${color}${alpha ?? ""}`);
}

/** Toggles canonical null fill without erasing the last authored fill color. */
export function setDrawingStyleDraftFillNone(
  draft: DrawingStyleDraft,
  fillNone: boolean,
): DrawingStyleDraft {
  const values = { ...draft.values, fillNone };
  const field: DrawingStyleDraftField = "fill";
  const dirty = !sameDraftField(values, draft.baselineValues, field);
  return {
    ...draft,
    conflictedFields: dirty
      ? draft.conflictedFields
      : draft.conflictedFields.filter((candidate) => candidate !== field),
    dirtyFields: dirty
      ? draft.dirtyFields.includes(field)
        ? draft.dirtyFields
        : [...draft.dirtyFields, field]
      : draft.dirtyFields.filter((candidate) => candidate !== field),
    submission: null,
    submissionRejected: false,
    values,
  };
}

/** Rebases clean fields and reports only remotely changed dirty fields. */
export function reconcileDrawingStyleDraft(
  draft: DrawingStyleDraft,
  style: DrawingStyleDefinition,
): DrawingStyleDraft {
  if (draft.styleId !== style.id) return createDrawingStyleDraft(style);
  if (draft.styleVersion === style.version) return draft;
  if (draft.submission) return { ...draft, styleVersion: style.version };
  if (draft.dirtyFields.length === 0) return createDrawingStyleDraft(style);

  const canonicalValues = valuesForStyle(style);
  const values = { ...canonicalValues };
  const baselineValues = { ...canonicalValues };
  const nativeColors = nativeColorsForValues(canonicalValues);
  const dirtyFields = draft.dirtyFields.filter(
    (field) => !sameDraftField(draft.values, canonicalValues, field),
  );
  for (const field of dirtyFields) {
    copyDraftField(values, draft.values, field);
    if (field === "stroke") nativeColors.stroke = draft.nativeColors.stroke;
    if (field === "fill") nativeColors.fill = draft.nativeColors.fill;
  }
  return {
    ...draft,
    baselineValues,
    conflictedFields: dirtyFields.filter(
      (field) =>
        draft.conflictedFields.includes(field) ||
        !sameDraftField(draft.baselineValues, canonicalValues, field),
    ),
    dirtyFields,
    nativeColors,
    submissionRejected: dirtyFields.length
      ? draft.submissionRejected
      : false,
    styleVersion: style.version,
    values,
  };
}

/** Parses only the four style fields supported by the canonical model. */
export function buildDrawingStyleDraftSubmission(draft: DrawingStyleDraft): {
  name: string;
  value: DrawingStyle;
} {
  const fontSize = draft.values.fontSize.trim();
  return {
    name: draft.values.name.trim(),
    value: DrawingStyleSchema.parse({
      stroke: draft.values.stroke.trim(),
      strokeWidth: Number(draft.values.strokeWidth),
      fill: draft.values.fillNone ? null : draft.values.fill.trim(),
      ...(fontSize ? { fontSize: Number(fontSize) } : {}),
    }),
  };
}

/** Records synchronous command admission without claiming persistence success. */
export function markDrawingStyleDraftSubmitted(
  draft: DrawingStyleDraft,
  patch: { name: string; value: DrawingStyle },
  accepted: boolean,
  targetStyleId = draft.styleId ?? "",
): DrawingStyleDraft {
  return {
    ...draft,
    conflictedFields: accepted ? [] : draft.conflictedFields,
    submission: accepted
      ? {
          baseVersion: draft.styleVersion,
          patch,
          sawPending: false,
          targetStyleId,
        }
      : null,
    submissionRejected: !accepted,
  };
}

function styleReflectsSubmission(
  style: DrawingStyleDefinition,
  submission: DrawingStyleDraftSubmission,
) {
  const value = style.value;
  const submitted = submission.patch.value;
  return (
    style.id === submission.targetStyleId &&
    style.name === submission.patch.name &&
    value.stroke === submitted.stroke &&
    value.strokeWidth === submitted.strokeWidth &&
    value.fill === submitted.fill &&
    value.fontSize === submitted.fontSize
  );
}

/** Cleans a draft only after the canonical projection reflects a settled save. */
export function settleDrawingStyleDraft(
  draft: DrawingStyleDraft,
  style: DrawingStyleDefinition | undefined,
  status: DrawingStylePersistenceStatus,
): DrawingStyleDraft {
  const current =
    draft.styleId && style ? reconcileDrawingStyleDraft(draft, style) : draft;
  if (!current.submission) return current;
  if (status === "pending")
    return {
      ...current,
      submission: { ...current.submission, sawPending: true },
    };
  if (
    status === "settled" &&
    style &&
    styleReflectsSubmission(style, current.submission)
  )
    return current.styleId
      ? createDrawingStyleDraft(style)
      : createDrawingStyleDraft();
  if (
    status === "settled" &&
    !current.submission.sawPending &&
    (!style || style.version === current.submission.baseVersion)
  )
    return current;
  return {
    ...current,
    conflictedFields: [...current.dirtyFields],
    submission: null,
    submissionRejected: true,
  };
}

function hasLocalDraft(draft: DrawingStyleDraft) {
  return (
    draft.dirtyFields.length > 0 ||
    draft.submission !== null ||
    draft.submissionRejected
  );
}

const fieldLabels: Record<DrawingStyleDraftField, string> = {
  name: "스타일 이름",
  stroke: "선 색상",
  strokeWidth: "선 두께",
  fill: "채우기 / 텍스트 색상",
  fontSize: "글꼴 크기",
};

function DrawingStyleFields({
  disabled,
  draft,
  idPrefix,
  nameLabel,
  onChange,
  onFillNoneChange,
  onNativeColorChange,
}: {
  disabled: boolean;
  draft: DrawingStyleDraft;
  idPrefix: string;
  nameLabel: string;
  onChange: (field: DrawingStyleDraftField, value: string) => void;
  onFillNoneChange: (fillNone: boolean) => void;
  onNativeColorChange: (field: "stroke" | "fill", color: string) => void;
}) {
  const invalidStroke = !strokeColorPattern.test(draft.values.stroke);
  const invalidFill =
    !draft.values.fillNone && !fillColorPattern.test(draft.values.fill);
  const strokeErrorId = `${idPrefix}-stroke-error`;
  const fillErrorId = `${idPrefix}-fill-error`;
  return (
    <fieldset className="grid gap-3" disabled={disabled}>
      <legend className="sr-only">{nameLabel} 값</legend>
      <label className="grid gap-1 text-xs" htmlFor={`${idPrefix}-name`}>
        {nameLabel}
        <input
          className="min-h-10 rounded border border-slate-200 bg-white px-2 text-sm"
          id={`${idPrefix}-name`}
          maxLength={255}
          name="name"
          onChange={(event) => onChange("name", event.currentTarget.value)}
          required
          value={draft.values.name}
        />
      </label>

      <fieldset className="grid gap-2 rounded border border-slate-200 p-2">
        <legend className="px-1 text-xs">선 색상</legend>
        <div className="grid grid-cols-[3rem_1fr] items-end gap-2">
          <label
            className="grid gap-1 text-[11px]"
            htmlFor={`${idPrefix}-stroke-picker`}
          >
            선택
            <input
              aria-label={`${nameLabel} 선 색상 선택`}
              className="h-10 w-12 cursor-pointer rounded border border-slate-200 bg-white p-1"
              id={`${idPrefix}-stroke-picker`}
              onChange={(event) =>
                onNativeColorChange("stroke", event.currentTarget.value)
              }
              type="color"
              value={draft.nativeColors.stroke}
            />
          </label>
          <label
            className="grid gap-1 text-[11px]"
            htmlFor={`${idPrefix}-stroke`}
          >
            선 색상 HEX
            <input
              aria-describedby={invalidStroke ? strokeErrorId : undefined}
              aria-invalid={invalidStroke || undefined}
              className="min-h-10 rounded border border-slate-200 bg-white px-2 font-mono text-sm"
              id={`${idPrefix}-stroke`}
              name="stroke"
              onChange={(event) =>
                onChange("stroke", event.currentTarget.value)
              }
              pattern="#[0-9a-fA-F]{6}"
              placeholder="#000000"
              required
              value={draft.values.stroke}
            />
          </label>
        </div>
        {invalidStroke ? (
          <p className="text-xs text-red-700" id={strokeErrorId} role="alert">
            선 색상은 6자리 HEX여야 합니다.
          </p>
        ) : null}
      </fieldset>

      <label
        className="grid gap-1 text-xs"
        htmlFor={`${idPrefix}-stroke-width`}
      >
        선 두께
        <input
          className="min-h-10 rounded border border-slate-200 bg-white px-2 text-sm"
          id={`${idPrefix}-stroke-width`}
          max={1000}
          name="strokeWidth"
          onChange={(event) =>
            onChange("strokeWidth", event.currentTarget.value)
          }
          required
          step="any"
          type="number"
          value={draft.values.strokeWidth}
        />
      </label>

      <fieldset className="grid gap-2 rounded border border-slate-200 p-2">
        <legend className="px-1 text-xs">채우기 / 텍스트 색상</legend>
        <label className="flex min-h-10 items-center gap-2 text-xs">
          <input
            checked={draft.values.fillNone}
            name="fillNone"
            onChange={(event) => onFillNoneChange(event.currentTarget.checked)}
            type="checkbox"
          />
          채우기 없음
        </label>
        <div className="grid grid-cols-[3rem_1fr] items-end gap-2">
          <label
            className="grid gap-1 text-[11px]"
            htmlFor={`${idPrefix}-fill-picker`}
          >
            선택
            <input
              aria-label={`${nameLabel} 채우기 / 텍스트 색상 선택`}
              className="h-10 w-12 cursor-pointer rounded border border-slate-200 bg-white p-1 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={draft.values.fillNone}
              id={`${idPrefix}-fill-picker`}
              onChange={(event) =>
                onNativeColorChange("fill", event.currentTarget.value)
              }
              type="color"
              value={draft.nativeColors.fill}
            />
          </label>
          <label
            className="grid gap-1 text-[11px]"
            htmlFor={`${idPrefix}-fill`}
          >
            채우기 / 텍스트 색상 HEX
            <input
              aria-describedby={invalidFill ? fillErrorId : undefined}
              aria-invalid={invalidFill || undefined}
              className="min-h-10 rounded border border-slate-200 bg-white px-2 font-mono text-sm disabled:opacity-50"
              disabled={draft.values.fillNone}
              id={`${idPrefix}-fill`}
              name="fill"
              onChange={(event) => onChange("fill", event.currentTarget.value)}
              pattern="#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?"
              placeholder="#ffffff 또는 #ffffff80"
              required={!draft.values.fillNone}
              value={draft.values.fill}
            />
          </label>
        </div>
        <p className="text-[11px] leading-4 text-slate-500">
          자유 텍스트는 이 색상을 사용하고, 없음이면 선 색상을 사용합니다.
          투명도는 HEX 끝 두 자리로 입력합니다.
        </p>
        {invalidFill ? (
          <p className="text-xs text-red-700" id={fillErrorId} role="alert">
            채우기 색상은 6자리 또는 alpha를 포함한 8자리 HEX여야 합니다.
          </p>
        ) : null}
      </fieldset>

      <label className="grid gap-1 text-xs" htmlFor={`${idPrefix}-font-size`}>
        글꼴 크기
        <input
          className="min-h-10 rounded border border-slate-200 bg-white px-2 text-sm"
          id={`${idPrefix}-font-size`}
          max={10000}
          name="fontSize"
          onChange={(event) => onChange("fontSize", event.currentTarget.value)}
          step="any"
          type="number"
          value={draft.values.fontSize}
        />
        <span className="text-[11px] text-slate-500">
          자유 텍스트만 · 비우면 기본 14
        </span>
      </label>
    </fieldset>
  );
}

function DrawingStyleReader({
  draft,
  persistenceStatus,
  style,
}: {
  draft?: DrawingStyleDraft;
  persistenceStatus: DrawingStylePersistenceStatus;
  style: DrawingStyleDefinition;
}) {
  const fill = style.value.fill;
  return (
    <li className="rounded-md border border-slate-200 bg-slate-50 p-2">
      <p className="font-medium">{style.name}</p>
      {draft && hasLocalDraft(draft) ? (
        <p className="mt-2 text-xs text-amber-700" role="status">
          {persistenceStatus === "failed"
            ? "저장에 실패한 로컬 초안을 보존했습니다."
            : "편집 권한이 돌아오면 다시 적용할 수 있도록 로컬 초안을 보존했습니다."}
        </p>
      ) : null}
      {draft?.conflictedFields.length ? (
        <p className="mt-2 text-xs text-red-700" role="alert">
          원격 변경과 충돌한 입력도 보존했습니다.
        </p>
      ) : null}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-slate-500">선 색상</dt>
          <dd className="mt-1 flex items-center gap-2 font-mono">
            <span
              aria-hidden="true"
              className="inline-block h-4 w-4 rounded-sm border border-slate-300"
              style={{ backgroundColor: style.value.stroke }}
            />
            {style.value.stroke}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">선 두께</dt>
          <dd className="mt-1">{style.value.strokeWidth}</dd>
        </div>
        <div>
          <dt className="text-slate-500">채우기 / 텍스트 색상</dt>
          <dd className="mt-1 flex items-center gap-2 font-mono">
            {fill ? (
              <span
                aria-hidden="true"
                className="inline-block h-4 w-4 rounded-sm border border-slate-300"
                style={{ backgroundColor: fill }}
              />
            ) : null}
            {fill ?? "없음 · 텍스트는 선 색상 사용"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">글꼴 크기</dt>
          <dd className="mt-1">
            {style.value.fontSize ?? "기본 14"} · 자유 텍스트만
          </dd>
        </div>
      </dl>
    </li>
  );
}

function DrawingStyleEditor({
  actorId,
  canEdit,
  onCommand,
  persistenceStatus,
  referenced,
  state,
  style,
}: Props & {
  persistenceStatus: DrawingStylePersistenceStatus;
  referenced: boolean;
  style: DrawingStyleDefinition;
}) {
  const [draft, setDraft] = useState(() => createDrawingStyleDraft(style));
  const [error, setError] = useState<string | null>(null);
  const activeDraft = settleDrawingStyleDraft(draft, style, persistenceStatus);
  useEffect(() => {
    setDraft((current) =>
      settleDrawingStyleDraft(current, style, persistenceStatus),
    );
  }, [persistenceStatus, style]);

  if (!canEdit)
    return (
      <DrawingStyleReader
        draft={activeDraft}
        persistenceStatus={persistenceStatus}
        style={style}
      />
    );

  const updateDraft = (
    update: (current: DrawingStyleDraft) => DrawingStyleDraft,
  ) => {
    setDraft((current) =>
      update(settleDrawingStyleDraft(current, style, persistenceStatus)),
    );
    setError(null);
  };

  function applyDraft(allowConflict = false) {
    if (activeDraft.conflictedFields.length > 0 && !allowConflict) {
      setDraft(activeDraft);
      return;
    }
    try {
      const patch = buildDrawingStyleDraftSubmission(activeDraft);
      const accepted =
        onCommand(
          updateDrawingStyleCommand(state, actorId, style.id, patch),
        ) !== false;
      setDraft(
        markDrawingStyleDraftSubmitted(activeDraft, patch, accepted, style.id),
      );
      setError(
        accepted
          ? null
          : "저장 작업을 시작하지 못했습니다. 입력은 보존되었습니다.",
      );
    } catch (caught) {
      setDraft({
        ...activeDraft,
        submission: null,
        submissionRejected: true,
      });
      setError(message(caught));
    }
  }

  const conflictMessage = activeDraft.conflictedFields.length
    ? `${activeDraft.conflictedFields
        .map((field) => fieldLabels[field])
        .join(
          ", ",
        )}에 원격 변경이 있습니다. 최신값을 사용하거나 내 입력을 현재 버전에 다시 적용하세요.`
    : null;
  const deleteReasonId = `style-delete-reason-${style.id}`;
  return (
    <li className="rounded-md border border-slate-200 bg-slate-50 p-2">
      <form
        className="grid gap-3"
        data-drawing-shortcuts="ignore"
        onReset={() => {
          setDraft(createDrawingStyleDraft(style));
          setError(null);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          applyDraft();
        }}
      >
        <DrawingStyleFields
          disabled={Boolean(activeDraft.submission)}
          draft={activeDraft}
          idPrefix={`style-${style.id}`}
          nameLabel={`스타일 이름: ${style.name}`}
          onChange={(field, value) =>
            updateDraft((current) =>
              editDrawingStyleDraft(current, field, value),
            )
          }
          onFillNoneChange={(fillNone) =>
            updateDraft((current) =>
              setDrawingStyleDraftFillNone(current, fillNone),
            )
          }
          onNativeColorChange={(field, color) =>
            updateDraft((current) =>
              applyDrawingStyleDraftNativeColor(current, field, color),
            )
          }
        />
        {activeDraft.submission ? (
          <p className="text-xs text-amber-700" role="status">
            저장 결과를 확인하는 동안 입력을 보존하고 있습니다.
          </p>
        ) : null}
        {conflictMessage ? (
          <p className="text-xs text-red-700" role="alert">
            {conflictMessage}
          </p>
        ) : null}
        {activeDraft.submissionRejected && !conflictMessage ? (
          <p className="text-xs text-amber-700" role="status">
            저장되지 않은 입력을 보존했습니다.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          {activeDraft.submission ? (
            <button
              className="col-span-2 min-h-10 rounded border border-slate-300 px-2 text-sm opacity-60"
              disabled
              type="button"
            >
              저장 결과 확인 중
            </button>
          ) : conflictMessage || activeDraft.submissionRejected ? (
            <>
              <button
                className="min-h-10 rounded border border-slate-300 px-2 text-sm"
                onClick={() => {
                  setDraft(createDrawingStyleDraft(style));
                  setError(null);
                }}
                type="button"
              >
                최신값 사용
              </button>
              <button
                className="min-h-10 rounded bg-amber-500 px-2 text-sm font-semibold text-slate-900"
                onClick={() => applyDraft(true)}
                type="button"
              >
                {conflictMessage ? "내 입력 재적용" : "다시 시도"}
              </button>
            </>
          ) : (
            <>
              <button
                className="min-h-10 rounded border border-slate-300 px-2 text-sm"
                type="reset"
              >
                취소
              </button>
              <button
                className="min-h-10 rounded bg-indigo-600 px-2 text-sm font-semibold text-white"
                type="submit"
              >
                스타일 저장
              </button>
            </>
          )}
        </div>
      </form>
      <button
        aria-describedby={referenced ? deleteReasonId : undefined}
        aria-label={`스타일 삭제: ${style.name}`}
        className="mt-2 min-h-10 rounded border border-slate-300 px-2 text-sm disabled:opacity-50"
        disabled={referenced || Boolean(activeDraft.submission)}
        onClick={() => {
          try {
            const accepted =
              onCommand(deleteDrawingStyleCommand(state, actorId, style.id)) !==
              false;
            setError(
              accepted
                ? null
                : "삭제 작업을 시작하지 못했습니다. 다시 시도하세요.",
            );
          } catch (caught) {
            setError(message(caught));
          }
        }}
        type="button"
      >
        스타일 삭제
      </button>
      {referenced ? (
        <span className="mt-2 block text-xs text-slate-500" id={deleteReasonId}>
          사용 중인 스타일은 삭제할 수 없습니다.
        </span>
      ) : null}
      {error ? (
        <p className="mt-3 text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** Canonical reusable style definition controls with a mutation-free reader view. */
export function DrawingStylesPanel({
  actorId,
  canEdit,
  onCommand,
  persistenceStatus = "settled",
  state,
}: Props) {
  const [createDraft, setCreateDraft] = useState(() =>
    createDrawingStyleDraft(),
  );
  const [error, setError] = useState<string | null>(null);
  const structure = state.structure;
  const submittedStyleId = createDraft.submission?.targetStyleId;
  const submittedStyle =
    structure && submittedStyleId
      ? structure.styles[submittedStyleId]
      : undefined;
  const activeCreateDraft = settleDrawingStyleDraft(
    createDraft,
    submittedStyle,
    persistenceStatus,
  );
  useEffect(() => {
    setCreateDraft((current) =>
      settleDrawingStyleDraft(current, submittedStyle, persistenceStatus),
    );
  }, [persistenceStatus, submittedStyle]);

  if (!structure) return null;
  const mutationAllowed = canEdit && persistenceStatus !== "conflicted";
  const styles = Object.values(structure.styles).sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
  const referenced = (styleId: string) =>
    Object.values(state.objects).some((object) => object.styleId === styleId) ||
    Object.values(structure.blocks).some((block) =>
      block.primitives.some((primitive) => primitive.styleId === styleId),
    );

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const patch = buildDrawingStyleDraftSubmission(activeCreateDraft);
      const command = createDrawingStyleCommand(
        state,
        actorId,
        patch.name,
        patch.value,
      );
      const action = command.actions[0];
      const targetStyleId = "entity" in action ? action.entity.id : "";
      const accepted = onCommand(command) !== false;
      setCreateDraft(
        markDrawingStyleDraftSubmitted(
          activeCreateDraft,
          patch,
          accepted,
          targetStyleId,
        ),
      );
      setError(
        accepted
          ? null
          : "저장 작업을 시작하지 못했습니다. 입력은 보존되었습니다.",
      );
    } catch (caught) {
      setCreateDraft({
        ...activeCreateDraft,
        submission: null,
        submissionRejected: true,
      });
      setError(message(caught));
    }
  }

  return (
    <section
      aria-labelledby="drawing-styles-title"
      className="mt-6 border-t border-slate-200 pt-6"
    >
      <h2 className="text-sm font-bold" id="drawing-styles-title">
        스타일 라이브러리
      </h2>
      {!mutationAllowed ? (
        <>
          <p className="mt-2 text-xs text-slate-500">
            {persistenceStatus === "conflicted"
              ? "저장 충돌을 해결한 뒤 스타일을 편집할 수 있습니다."
              : "읽기 전용 스타일 목록"}
          </p>
          {hasLocalDraft(activeCreateDraft) ? (
            <p className="mt-2 text-xs text-amber-700" role="status">
              편집 권한이 돌아오면 다시 적용할 수 있도록 새 스타일 초안을
              보존했습니다.
            </p>
          ) : null}
        </>
      ) : (
        <form
          className="mt-3 grid gap-3 rounded-md border border-slate-200 p-2"
          data-drawing-shortcuts="ignore"
          onReset={() => {
            setCreateDraft(createDrawingStyleDraft());
            setError(null);
          }}
          onSubmit={create}
        >
          <DrawingStyleFields
            disabled={Boolean(activeCreateDraft.submission)}
            draft={activeCreateDraft}
            idPrefix="new-drawing-style"
            nameLabel="새 스타일 이름"
            onChange={(field, value) => {
              setCreateDraft((current) =>
                editDrawingStyleDraft(
                  settleDrawingStyleDraft(
                    current,
                    submittedStyle,
                    persistenceStatus,
                  ),
                  field,
                  value,
                ),
              );
              setError(null);
            }}
            onFillNoneChange={(fillNone) => {
              setCreateDraft((current) =>
                setDrawingStyleDraftFillNone(current, fillNone),
              );
              setError(null);
            }}
            onNativeColorChange={(field, color) => {
              setCreateDraft((current) =>
                applyDrawingStyleDraftNativeColor(current, field, color),
              );
              setError(null);
            }}
          />
          {activeCreateDraft.submission ? (
            <p className="text-xs text-amber-700" role="status">
              저장 결과를 확인하는 동안 입력을 보존하고 있습니다.
            </p>
          ) : null}
          {activeCreateDraft.submissionRejected ? (
            <p className="text-xs text-amber-700" role="status">
              저장되지 않은 새 스타일 입력을 보존했습니다.
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button
              className="min-h-10 rounded border border-slate-300 px-3 text-sm"
              disabled={Boolean(activeCreateDraft.submission)}
              type="reset"
            >
              취소
            </button>
            <button
              className="min-h-10 rounded bg-indigo-600 px-3 text-sm font-semibold text-white disabled:opacity-50"
              disabled={Boolean(activeCreateDraft.submission)}
              type="submit"
            >
              {activeCreateDraft.submissionRejected
                ? "스타일 추가 다시 시도"
                : "스타일 추가"}
            </button>
          </div>
        </form>
      )}
      {error ? (
        <p className="mt-3 text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <ul
        aria-label="도면 스타일"
        className={`mt-4 ${mutationAllowed ? "space-y-3" : "space-y-2 text-sm"}`}
      >
        {styles.map((style) => (
          <DrawingStyleEditor
            actorId={actorId}
            canEdit={mutationAllowed}
            key={style.id}
            onCommand={onCommand}
            persistenceStatus={persistenceStatus}
            referenced={referenced(style.id)}
            state={state}
            style={style}
          />
        ))}
      </ul>
    </section>
  );
}
