import { useState, type FormEvent } from "react";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/core/components/ui/table";
import { applicableDrawingPropertySchemas } from "~/lukas/lib/drawing-properties";
import {
  createDrawingTableCommand,
  deleteDrawingTableCommand,
  resolveDrawingTable,
  updateDrawingTableCommand,
} from "~/lukas/lib/drawing-tables";
import type {
  DrawingCommand,
  DrawingDocumentState,
} from "~/lukas/lib/drawing-commands";
import type { DrawingTable } from "~/lukas/lib/drawing-workspace.types";
import type {
  DrawingMeasurementEvidenceError,
  DrawingMeasurementEvidenceLineage,
  DrawingServerMeasurementEvidence,
} from "~/lukas/lib/drawing-semantic-schedules";
import { DrawingSemanticSchedulesPanel } from "./drawing-semantic-schedules-panel";

type Props = {
  actorId: string;
  canEdit: boolean;
  onCommand: (command: DrawingCommand) => void;
  selectedIds: string[];
  state: DrawingDocumentState;
  evidence?: DrawingServerMeasurementEvidence | null;
  evidenceError?: DrawingMeasurementEvidenceError | null;
  hasUnconfirmedChanges?: boolean;
  lineage?: DrawingMeasurementEvidenceLineage | null;
};

function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "일람표를 변경하지 못했습니다.";
}

function targetRows(
  state: DrawingDocumentState,
  selectedIds: readonly string[],
  createId: () => string,
) {
  return [...new Set(selectedIds)]
    .sort()
    .filter((id) => state.objects[id] || state.structure?.blockInstances[id])
    .map((id) => ({
      id: createId(),
      objectId: state.objects[id] ? id : null,
      blockInstanceId: state.structure?.blockInstances[id] ? id : null,
      cells: {},
    }));
}

function ScheduleTable({
  actorId,
  canEdit,
  onCommand,
  selectedIds,
  state,
  table,
}: Props & { table: DrawingTable }) {
  const [error, setError] = useState<string | null>(null);
  const resolved = resolveDrawingTable(table, state);
  const content = (
    <Table aria-label={table.name}>
      <TableCaption>{table.name}</TableCaption>
      <TableHeader>
        <TableRow>
          {table.columns.map((column) => (
            <TableHead key={column.id} scope="col">
              {column.name}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {table.rows.map((row, rowIndex) => (
          <TableRow key={row.id}>
            {table.columns.map((column) => {
              const fieldId = `schedule-${table.id}-${row.id}-${column.id}`;
              const manual = column.kind === "text" || column.kind === "number";
              return (
                <TableCell key={column.id}>
                  {canEdit && manual ? (
                    <label className="grid gap-1 text-xs" htmlFor={fieldId}>
                      <span className="sr-only">{column.name}</span>
                      <input
                        aria-label={`${table.name} ${rowIndex + 1} ${column.name}`}
                        className="min-h-9 min-w-28 rounded border border-white/15 bg-slate-950 px-2 text-sm"
                        defaultValue={row.cells[column.id] ?? ""}
                        id={fieldId}
                        name={`${row.id}:${column.id}`}
                        step={column.kind === "number" ? "any" : undefined}
                        type={column.kind}
                      />
                    </label>
                  ) : (
                    resolved[rowIndex][column.name]
                  )}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  if (!canEdit)
    return <section aria-label={`${table.name} 일람표`}>{content}</section>;

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const data = new FormData(event.currentTarget);
      const rows = table.rows.map((row) => ({
        ...row,
        cells: Object.fromEntries(
          table.columns.flatMap((column) => {
            if (column.kind !== "text" && column.kind !== "number") return [];
            const raw = String(data.get(`${row.id}:${column.id}`) ?? "");
            return [
              [
                column.id,
                raw === ""
                  ? null
                  : column.kind === "number"
                    ? Number(raw)
                    : raw,
              ],
            ];
          }),
        ),
      }));
      onCommand(updateDrawingTableCommand(state, actorId, table.id, { rows }));
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  }

  function addTargets() {
    try {
      const existing = new Set(
        table.rows.map((row) => row.objectId ?? row.blockInstanceId),
      );
      const rows = [
        ...table.rows,
        ...targetRows(
          state,
          selectedIds.filter((id) => !existing.has(id)),
          () => crypto.randomUUID(),
        ),
      ];
      onCommand(updateDrawingTableCommand(state, actorId, table.id, { rows }));
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  }

  return (
    <section
      aria-label={`${table.name} 일람표`}
      className="mt-4 rounded border border-white/10 p-2"
    >
      <form data-drawing-shortcuts="ignore" onSubmit={save}>
        {content}
        <button
          className="mt-2 min-h-9 rounded bg-indigo-500 px-2 text-sm"
          type="submit"
        >
          일람표 저장
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          aria-label={`선택 대상을 일람표로 추가: ${table.name}`}
          className="min-h-9 rounded border border-white/20 px-2 text-sm disabled:opacity-50"
          disabled={selectedIds.length === 0}
          onClick={addTargets}
          type="button"
        >
          선택 대상을 일람표로 추가
        </button>
        <button
          aria-label={`일람표 삭제: ${table.name}`}
          className="min-h-9 rounded border border-white/20 px-2 text-sm"
          onClick={() => {
            try {
              onCommand(deleteDrawingTableCommand(state, actorId, table.id));
              setError(null);
            } catch (caught) {
              setError(message(caught));
            }
          }}
          type="button"
        >
          일람표 삭제
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Simple schedules resolve canonical maps directly into semantic DOM tables. */
export function DrawingTablesPanel(props: Props) {
  const {
    actorId,
    canEdit,
    evidence,
    evidenceError,
    hasUnconfirmedChanges = false,
    lineage,
    onCommand,
    selectedIds,
    state,
  } = props;
  const [error, setError] = useState<string | null>(null);
  const structure = state.structure;
  if (
    !structure?.tables ||
    !structure.propertySchemas ||
    !structure.propertyValues
  )
    return null;
  const tables = Object.values(structure.tables).sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const form = event.currentTarget;
      const createId = () => crypto.randomUUID();
      const propertySchemas = applicableDrawingPropertySchemas(
        state,
        selectedIds,
      );
      const columns: DrawingTable["columns"] = [
        {
          id: createId(),
          name: "Object name",
          kind: "object_name",
          propertySchemaId: null,
        },
        ...propertySchemas.map((schema) => ({
          id: createId(),
          name: schema.name,
          kind: "property" as const,
          propertySchemaId: schema.id,
        })),
        {
          id: createId(),
          name: "Note",
          kind: "text" as const,
          propertySchemaId: null,
        },
      ];
      onCommand(
        createDrawingTableCommand(
          state,
          actorId,
          {
            name: String(new FormData(form).get("name") ?? ""),
            columns,
            rows: targetRows(state, selectedIds, createId),
          },
          createId,
        ),
      );
      setError(null);
      form.reset();
    } catch (caught) {
      setError(message(caught));
    }
  }

  return (
    <section
      aria-labelledby="drawing-tables-title"
      className="mt-6 border-t border-white/10 pt-6"
    >
      <DrawingSemanticSchedulesPanel
        evidence={evidence}
        evidenceError={evidenceError}
        hasUnconfirmedChanges={hasUnconfirmedChanges}
        lineage={lineage}
        state={state}
      />
      <h2
        className="mt-6 border-t border-white/10 pt-6 text-sm font-bold"
        id="drawing-tables-title"
      >
        사용자 정의 일람표
      </h2>
      {canEdit ? (
        <form
          className="mt-3 grid gap-2"
          data-drawing-shortcuts="ignore"
          onSubmit={create}
        >
          <label
            className="grid gap-1 text-xs"
            htmlFor="new-drawing-schedule-name"
          >
            새 일람표 이름
            <input
              className="min-h-10 rounded border border-white/15 bg-slate-950 px-2 text-sm"
              id="new-drawing-schedule-name"
              maxLength={255}
              name="name"
              required
              type="text"
            />
          </label>
          <button
            className="min-h-10 rounded bg-indigo-500 px-3 text-sm font-semibold disabled:opacity-50"
            disabled={selectedIds.length === 0}
            type="submit"
          >
            선택 대상을 일람표로 추가
          </button>
        </form>
      ) : (
        <p className="mt-2 text-xs text-slate-400">읽기 전용 일람표</p>
      )}
      {error ? (
        <p className="mt-2 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {tables.map((table) => (
        <ScheduleTable {...props} key={table.id} table={table} />
      ))}
    </section>
  );
}
