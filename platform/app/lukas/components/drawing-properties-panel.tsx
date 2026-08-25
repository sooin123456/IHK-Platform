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
  "block_instance",
] as const;

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
          className="min-h-9 rounded border border-white/15 bg-slate-950 px-2 text-sm"
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
          className="min-h-9 rounded border border-white/15 bg-slate-950 px-2 text-sm"
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
          className="min-h-9 rounded border border-white/15 bg-slate-950 px-2 text-sm"
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
          className="min-h-24 rounded border border-white/15 bg-slate-950 px-2 text-sm"
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
        className="mt-6 border-t border-white/10 pt-6"
      >
        <h2 className="text-sm font-bold" id="drawing-properties-title">
          사용자 속성
        </h2>
        <p className="mt-2 text-xs text-slate-400">읽기 전용 속성 정의</p>
        <ul aria-label="사용자 속성 정의" className="mt-3 space-y-2 text-sm">
          {schemas.map((schema) => (
            <li
              className="rounded border border-white/10 bg-white/5 p-2"
              key={schema.id}
            >
              <p className="font-medium">{schema.name}</p>
              <p className="mt-1 text-xs text-slate-400">
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
      className="mt-6 border-t border-white/10 pt-6"
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
          className="min-h-10 rounded bg-indigo-500 px-3 text-sm font-semibold"
          type="submit"
        >
          속성 추가
        </button>
      </form>
      {error ? (
        <p className="mt-3 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      <ul aria-label="사용자 속성 정의" className="mt-4 space-y-3">
        {schemas.map((schema) => {
          const used = referenced(schema.id);
          const reasonId = `property-delete-reason-${schema.id}`;
          return (
            <li
              className="rounded border border-white/10 bg-white/5 p-2"
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
                  className="min-h-9 rounded bg-indigo-500 px-2 text-sm"
                  type="submit"
                >
                  속성 정의 저장
                </button>
              </form>
              <button
                aria-describedby={used ? reasonId : undefined}
                aria-label={`속성 정의 삭제: ${schema.name}`}
                className="mt-2 min-h-9 rounded border border-white/20 px-2 text-sm disabled:opacity-50"
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
                  className="mt-2 block text-xs text-slate-400"
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

export function synchronizeDrawingPropertyDirtySelection(
  dirty: Set<string>,
  previous: { current: string | null },
  selectedIds: readonly string[],
) {
  const identity = selectedIds.join("|");
  if (previous.current !== identity) {
    dirty.clear();
    previous.current = identity;
  }
  return identity;
}

/** Inspector fields write every dirty schema/target pair in one structure command. */
export function DrawingPropertyFields({
  actorId,
  canEdit,
  onCommand,
  selectedIds,
  state,
}: FieldProps) {
  const dirty = useRef(new Set<string>());
  const selectionIdentityRef = useRef<string | null>(null);
  const selectionIdentity = synchronizeDrawingPropertyDirtySelection(
    dirty.current,
    selectionIdentityRef,
    selectedIds,
  );
  const [error, setError] = useState<string | null>(null);
  if (!state.structure?.propertySchemas || !state.structure.propertyValues)
    return null;
  const schemas = applicableDrawingPropertySchemas(state, selectedIds);
  if (schemas.length === 0) return null;

  const shared = (schemaId: string) => {
    const values = selectedIds.map((targetId) =>
      drawingPropertyValue(state, schemaId, targetId),
    );
    return values.every((value) => Object.is(value, values[0]))
      ? values[0]
      : null;
  };

  if (!canEdit)
    return (
      <section
        aria-labelledby="drawing-property-values-title"
        className="mt-5 border-t border-white/10 pt-4"
      >
        <h3 className="text-sm font-bold" id="drawing-property-values-title">
          사용자 속성
        </h3>
        <dl className="mt-3 grid gap-2 text-sm">
          {schemas.map((schema) => (
            <div key={schema.id}>
              <dt className="text-xs text-slate-400">{schema.name}</dt>
              <dd>{shown(shared(schema.id))}</dd>
            </div>
          ))}
        </dl>
      </section>
    );

  return (
    <section
      aria-labelledby="drawing-property-values-title"
      className="mt-5 border-t border-white/10 pt-4"
    >
      <h3 className="text-sm font-bold" id="drawing-property-values-title">
        사용자 속성
      </h3>
      <form
        className="mt-3 grid gap-3"
        data-drawing-shortcuts="ignore"
        key={`${selectionIdentity}:${schemas
          .map(
            (schema) =>
              `${schema.id}:${schema.version}:${shown(shared(schema.id))}`,
          )
          .join("|")}`}
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const form = event.currentTarget;
            const values: Record<
              string,
              ReturnType<typeof parseDrawingPropertyInput>
            > = {};
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
            if (Object.keys(values).length)
              onCommand(
                setDrawingPropertySelectionValuesCommand(
                  state,
                  actorId,
                  selectedIds,
                  values,
                ),
              );
            dirty.current.clear();
            setError(null);
          } catch (caught) {
            setError(message(caught));
          }
        }}
      >
        {schemas.map((schema) => {
          const id = `inspector-property-${schema.id}`;
          const value = shared(schema.id);
          const common = {
            id,
            name: `property-${schema.id}`,
            onChange: () => dirty.current.add(schema.id),
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
                <select {...common} defaultValue={shown(value)}>
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
                  step={schema.valueType === "number" ? "any" : undefined}
                  type={schema.valueType}
                />
              )}
            </label>
          );
        })}
        <button
          className="min-h-10 rounded bg-indigo-500 px-3 text-sm font-semibold"
          type="submit"
        >
          사용자 속성 적용
        </button>
      </form>
      {error ? (
        <p className="mt-3 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
