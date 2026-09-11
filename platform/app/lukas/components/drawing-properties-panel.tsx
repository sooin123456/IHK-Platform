import { useRef, useState, type FormEvent } from "react";

import {
  applicableDrawingPropertySchemas,
  createDrawingPropertySchemaCommand,
  deleteDrawingPropertySchemaCommand,
  drawingPropertyValue,
  parseDrawingPropertyInput,
  setDrawingPropertySelectionValuesCommand,
  updateDrawingPropertySchemaCommand,
} from "~/lukas/lib/drawing-properties";
import type {
  DrawingCommand,
  DrawingDocumentState,
} from "~/lukas/lib/drawing-commands";
import type { DrawingPropertySchema } from "~/lukas/lib/drawing-workspace.types";

type Props = {
  actorId: string;
  canEdit: boolean;
  onCommand: (command: DrawingCommand) => void;
  state: DrawingDocumentState;
};

const targetTypes = [
  "line",
  "polyline",
  "rectangle",
  "circle",
  "text",
  "dimension",
  "wall",
  "opening",
  "space",
  "area",
  "grid",
  "arc",
  "block_instance",
] as const;

type DrawingPropertyInputValue = ReturnType<typeof parseDrawingPropertyInput>;

/** Validates assumptions and folds stale-reason cleanup into the caller's one batch. */
export function prepareDrawingEvidencePropertyValues(
  schemas: readonly Pick<DrawingPropertySchema, "id" | "name">[],
  changed: Readonly<Record<string, DrawingPropertyInputValue>>,
  current: Readonly<Record<string, DrawingPropertyInputValue>>,
): Record<string, DrawingPropertyInputValue> {
  const schema = (name: string) => {
    const matches = schemas.filter((candidate) => candidate.name === name);
    if (matches.length > 1)
      throw new Error(`${name} 속성 정의가 중복되었습니다.`);
    return matches[0];
  };
  const evidence = schema("근거 상태");
  const reason = schema("근거 사유");
  const values = { ...changed };
  if (!evidence || !reason) return values;
  const evidenceChanged = evidence.id in changed;
  const nextEvidence = evidenceChanged
    ? changed[evidence.id]
    : (current[evidence.id] ?? null);
  const nextReason =
    reason.id in changed ? changed[reason.id] : (current[reason.id] ?? null);
  if (nextEvidence === "가정값") {
    const trimmed = typeof nextReason === "string" ? nextReason.trim() : "";
    if (trimmed.length < 1 || trimmed.length > 500)
      throw new Error("가정값의 근거 사유는 1~500자로 입력해야 합니다.");
    if (reason.id in values) values[reason.id] = trimmed;
  } else if (evidenceChanged) {
    values[reason.id] = null;
  }
  return values;
}

function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "사용자 속성을 변경하지 못했습니다.";
}

function schemaInput(data: FormData) {
  const valueType = String(data.get("valueType"));
  return {
    name: String(data.get("name") ?? ""),
    valueType: valueType as DrawingPropertySchema["valueType"],
    enumOptions:
      valueType === "enum"
        ? String(data.get("enumOptions") ?? "")
            .split(",")
            .map((option) => option.trim())
            .filter(Boolean)
        : [],
    appliesTo: data.getAll("appliesTo") as DrawingPropertySchema["appliesTo"],
    required: data.get("required") === "on",
  };
}

function SchemaFields({ schema }: { schema?: DrawingPropertySchema }) {
  const suffix = schema?.id ?? "new";
  return (
    <>
      <label className="grid gap-1 text-xs" htmlFor={`property-name-${suffix}`}>
        {schema ? "속성 이름" : "새 속성 이름"}
        <input
          className="min-h-9 rounded border border-slate-200 bg-white px-2 text-sm text-slate-900"
          defaultValue={schema?.name}
          id={`property-name-${suffix}`}
          maxLength={255}
          name="name"
          required
          type="text"
        />
      </label>
      <label className="grid gap-1 text-xs" htmlFor={`property-type-${suffix}`}>
        값 형식
        <select
          className="min-h-9 rounded border border-slate-200 bg-white px-2 text-sm text-slate-900"
          defaultValue={schema?.valueType ?? "text"}
          id={`property-type-${suffix}`}
          name="valueType"
        >
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="boolean">Boolean</option>
          <option value="date">Date</option>
          <option value="enum">Enum</option>
        </select>
      </label>
      <label
        className="grid gap-1 text-xs"
        htmlFor={`property-options-${suffix}`}
      >
        Enum 옵션 (쉼표 구분)
        <input
          className="min-h-9 rounded border border-slate-200 bg-white px-2 text-sm text-slate-900"
          defaultValue={schema?.enumOptions.join(", ")}
          id={`property-options-${suffix}`}
          name="enumOptions"
          type="text"
        />
      </label>
      <label
        className="grid gap-1 text-xs"
        htmlFor={`property-target-${suffix}`}
      >
        적용 대상
        <select
          className="min-h-24 rounded border border-slate-200 bg-white px-2 text-sm text-slate-900"
          defaultValue={schema?.appliesTo ?? ["rectangle"]}
          id={`property-target-${suffix}`}
          multiple
          name="appliesTo"
          required
        >
          {targetTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-9 items-center gap-2 text-xs">
        <input
          defaultChecked={schema?.required}
          name="required"
          type="checkbox"
        />
        필수 속성
      </label>
    </>
  );
}

/** Property definitions remain readable while only draft editors receive forms. */
export function DrawingPropertiesPanel({
  actorId,
  canEdit,
  onCommand,
  state,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const structure = state.structure;
  if (!structure) return null;
  const schemas = Object.values(structure.propertySchemas).sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
  const referenced = (schemaId: string) =>
    Object.values(structure.propertyValues).some(
      (value) => value.schemaId === schemaId,
    ) ||
    Object.values(structure.tables).some((table) =>
      table.columns.some((column) => column.propertySchemaId === schemaId),
    );

  if (!canEdit)
    return (
      <section
        aria-labelledby="drawing-properties-title"
        className="mt-6 border-t border-slate-200 pt-6"
      >
        <h2 className="text-sm font-bold" id="drawing-properties-title">
          사용자 속성
        </h2>
        <p className="mt-2 text-xs text-slate-600">읽기 전용 속성 정의</p>
        <ul aria-label="사용자 속성 정의" className="mt-3 space-y-2 text-sm">
          {schemas.map((schema) => (
            <li
              className="rounded border border-slate-200 bg-slate-50 p-2"
              key={schema.id}
            >
              <p className="font-medium">{schema.name}</p>
              <p className="mt-1 text-xs text-slate-600">
                {schema.valueType} · {schema.appliesTo.join(", ")}
                {schema.required ? " · 필수" : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>
    );

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      onCommand(
        createDrawingPropertySchemaCommand(
          state,
          actorId,
          schemaInput(new FormData(event.currentTarget)),
        ),
      );
      setError(null);
      event.currentTarget.reset();
    } catch (caught) {
      setError(message(caught));
    }
  }

  function update(schemaId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      onCommand(
        updateDrawingPropertySchemaCommand(
          state,
          actorId,
          schemaId,
          schemaInput(new FormData(event.currentTarget)),
        ),
      );
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  }

  return (
    <section
      aria-labelledby="drawing-properties-title"
      className="mt-6 border-t border-slate-200 pt-6"
    >
      <h2 className="text-sm font-bold" id="drawing-properties-title">
        사용자 속성
      </h2>
      <form
        className="mt-3 grid gap-2"
        data-drawing-shortcuts="ignore"
        onSubmit={create}
      >
        <SchemaFields />
        <button
          className="min-h-10 rounded bg-indigo-600 px-3 text-sm font-semibold text-white"
          type="submit"
        >
          속성 추가
        </button>
      </form>
      {error ? (
        <p className="mt-3 text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <ul aria-label="사용자 속성 정의" className="mt-4 space-y-3">
        {schemas.map((schema) => {
          const used = referenced(schema.id);
          const reasonId = `property-delete-reason-${schema.id}`;
          return (
            <li
              className="rounded border border-slate-200 bg-slate-50 p-2"
              key={schema.id}
            >
              <form
                className="grid gap-2"
                data-drawing-shortcuts="ignore"
                key={`${schema.id}:${schema.version}`}
                onSubmit={(event) => update(schema.id, event)}
              >
                <SchemaFields schema={schema} />
                <button
                  className="min-h-9 rounded bg-indigo-600 px-2 text-sm text-white"
                  type="submit"
                >
                  속성 정의 저장
                </button>
              </form>
              <button
                aria-describedby={used ? reasonId : undefined}
                aria-label={`속성 정의 삭제: ${schema.name}`}
                className="mt-2 min-h-9 rounded border border-slate-300 px-2 text-sm text-slate-700 disabled:opacity-50"
                disabled={used}
                onClick={() => {
                  try {
                    onCommand(
                      deleteDrawingPropertySchemaCommand(
                        state,
                        actorId,
                        schema.id,
                      ),
                    );
                    setError(null);
                  } catch (caught) {
                    setError(message(caught));
                  }
                }}
                type="button"
              >
                속성 정의 삭제
              </button>
              {used ? (
                <span
                  className="mt-2 block text-xs text-slate-600"
                  id={reasonId}
                >
                  사용 중인 속성 정의는 삭제할 수 없습니다.
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type FieldProps = Props & { selectedIds: string[] };

function shown(value: ReturnType<typeof drawingPropertyValue>) {
  return value === null ? "" : String(value);
}

function DrawingPropertyFieldState({
  actorId,
  canEdit,
  onCommand,
  selectedIds,
  schemas,
  state,
}: FieldProps & { schemas: DrawingPropertySchema[] }) {
  const dirty = useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const [editedEvidenceKind, setEditedEvidenceKind] = useState<string | null>(
    null,
  );

  const shared = (schemaId: string) => {
    const values = selectedIds.map((targetId) =>
      drawingPropertyValue(state, schemaId, targetId),
    );
    return values.every((value) => Object.is(value, values[0]))
      ? values[0]
      : null;
  };
  const evidenceKindSchema = schemas.find(
    (schema) => schema.name === "근거 상태",
  );
  const evidenceKind =
    editedEvidenceKind ??
    (evidenceKindSchema ? shown(shared(evidenceKindSchema.id)) : "");
  const visibleSchemas = schemas.filter(
    (schema) => schema.name !== "근거 사유" || evidenceKind === "가정값",
  );

  if (!canEdit)
    return (
      <section
        aria-labelledby="drawing-property-values-title"
        className="mt-5 border-t border-slate-200 pt-4"
      >
        <h3 className="text-sm font-bold" id="drawing-property-values-title">
          사용자 속성
        </h3>
        <dl className="mt-3 grid gap-2 text-sm">
          {visibleSchemas.map((schema) => (
            <div key={schema.id}>
              <dt className="text-xs text-slate-600">{schema.name}</dt>
              <dd>{shown(shared(schema.id))}</dd>
            </div>
          ))}
        </dl>
      </section>
    );

  return (
    <section
      aria-labelledby="drawing-property-values-title"
      className="mt-5 border-t border-slate-200 pt-4"
    >
      <h3 className="text-sm font-bold" id="drawing-property-values-title">
        사용자 속성
      </h3>
      <form
        className="mt-3 grid gap-3"
        data-drawing-shortcuts="ignore"
        key={schemas
          .map(
            (schema) =>
              `${schema.id}:${schema.version}:${shown(shared(schema.id))}`,
          )
          .join("|")}
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const form = event.currentTarget;
            const values: Record<string, DrawingPropertyInputValue> = {};
            for (const schema of schemas) {
              if (!dirty.current.has(schema.id)) continue;
              const control = form.elements.namedItem(`property-${schema.id}`);
              if (
                !(
                  control instanceof HTMLInputElement ||
                  control instanceof HTMLSelectElement
                )
              )
                continue;
              values[schema.id] = parseDrawingPropertyInput(
                schema,
                schema.valueType === "boolean" &&
                  control instanceof HTMLInputElement
                  ? control.checked
                  : control.value,
              );
            }
            const prepared = prepareDrawingEvidencePropertyValues(
              schemas,
              values,
              Object.fromEntries(
                schemas.map((schema) => [schema.id, shared(schema.id)]),
              ),
            );
            if (Object.keys(prepared).length)
              onCommand(
                setDrawingPropertySelectionValuesCommand(
                  state,
                  actorId,
                  selectedIds,
                  prepared,
                ),
              );
            dirty.current.clear();
            setError(null);
          } catch (caught) {
            setError(message(caught));
          }
        }}
      >
        {visibleSchemas.map((schema) => {
          const id = `inspector-property-${schema.id}`;
          const value = shared(schema.id);
          const common = {
            id,
            name: `property-${schema.id}`,
            onChange: (
              event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
            ) => {
              dirty.current.add(schema.id);
              if (schema.name === "근거 상태")
                setEditedEvidenceKind(event.currentTarget.value);
            },
          };
          return (
            <label className="grid gap-1 text-xs" htmlFor={id} key={schema.id}>
              {schema.name}
              {schema.required ? " *" : ""}
              {schema.valueType === "boolean" ? (
                <input
                  {...common}
                  defaultChecked={value === true}
                  type="checkbox"
                />
              ) : schema.valueType === "enum" ? (
                <select
                  {...common}
                  defaultValue={shown(value)}
                  required={schema.required}
                >
                  <option value="">값 없음</option>
                  {schema.enumOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  {...common}
                  defaultValue={shown(value)}
                  maxLength={schema.name === "근거 사유" ? 500 : undefined}
                  required={schema.required || schema.name === "근거 사유"}
                  step={schema.valueType === "number" ? "any" : undefined}
                  type={schema.valueType}
                />
              )}
            </label>
          );
        })}
        <button
          className="min-h-10 rounded bg-indigo-600 px-3 text-sm font-semibold text-white"
          type="submit"
        >
          사용자 속성 적용
        </button>
      </form>
      {error ? (
        <p className="mt-3 text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Inspector fields write every dirty schema/target pair in one structure command. */
export function DrawingPropertyFields(props: FieldProps) {
  if (
    !props.state.structure?.propertySchemas ||
    !props.state.structure.propertyValues
  )
    return null;
  const schemas = applicableDrawingPropertySchemas(
    props.state,
    props.selectedIds,
  );
  if (schemas.length === 0) return null;
  const selectionIdentity = props.selectedIds.join("|");
  return (
    <DrawingPropertyFieldState
      {...props}
      key={selectionIdentity}
      schemas={schemas}
    />
  );
}
