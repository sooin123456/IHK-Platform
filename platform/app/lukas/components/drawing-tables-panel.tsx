import { useEffect, useState, type FormEvent } from "react";

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
  addDrawingTableDraftColumn,
  buildDrawingTableDraftSubmission,
  createDrawingTableCommand,
  createDrawingTableCreateDraft,
  createDrawingTableDraft,
  deleteDrawingTableDraftColumn,
  deleteDrawingTableCommand,
  editDrawingTableDraft,
  editDrawingTableDraftCell,
  markDrawingTableDraftSubmitted,
  markDrawingTableCreateDraftSubmitted,
  moveDrawingTableDraftColumn,
  reconcileDrawingTableDraft,
  resolveDrawingTable,
  settleDrawingTableDraft,
  settleDrawingTableCreateDraft,
  updateDrawingTableDraftColumn,
  updateDrawingTableCommand,
  type DrawingTablePersistenceStatus,
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
  onCommand: (command: DrawingCommand) => boolean;
  persistenceStatus?: DrawingTablePersistenceStatus;
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
  persistenceStatus = "settled",
  selectedIds,
  state,
  table,
}: Props & { table: DrawingTable }) {
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => createDrawingTableDraft(table));
  const activeDraft = settleDrawingTableDraft(draft, table, persistenceStatus);
  useEffect(() => {
    setDraft((current) =>
      settleDrawingTableDraft(current, table, persistenceStatus),
    );
  }, [persistenceStatus, table.id, table.version]);
  const resolved = resolveDrawingTable(table, state);
  const allPropertySchemas = Object.values(
    state.structure?.propertySchemas ?? {},
  ).sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
  const tableTargetIds = table.rows.map(
    (row) => row.objectId ?? row.blockInstanceId!,
  );
  const propertySchemas =
    tableTargetIds.length === 0
      ? allPropertySchemas
      : applicableDrawingPropertySchemas(state, tableTargetIds);
  const applicablePropertySchemaIds = new Set(
    propertySchemas.map((schema) => schema.id),
  );
  const invalidPropertyColumns = activeDraft.columns.filter(
    (column) =>
      column.kind === "property" &&
      (!column.propertySchemaId ||
        !applicablePropertySchemaIds.has(column.propertySchemaId)),
  );
  const propertyConflict = invalidPropertyColumns.length > 0;
  const columns = canEdit ? activeDraft.columns : table.columns;
  const tableName = canEdit ? activeDraft.name || table.name : table.name;
  const content = (
    <Table aria-label={tableName} className="text-slate-700">
      <TableCaption className="text-slate-600">{tableName}</TableCaption>
      <TableHeader>
        <TableRow className="border-slate-200">
          {columns.map((column) => (
            <TableHead className="text-slate-900" key={column.id} scope="col">
              {column.name}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {table.rows.map((row, rowIndex) => (
          <TableRow className="border-slate-200 hover:bg-slate-50" key={row.id}>
            {columns.map((column) => {
              const fieldId = `schedule-${table.id}-${row.id}-${column.id}`;
              const manual = column.kind === "text" || column.kind === "number";
              const previous = table.columns.find(
                (candidate) => candidate.id === column.id,
              );
              const reusable =
                previous?.kind === column.kind &&
                previous.propertySchemaId === column.propertySchemaId;
              return (
                <TableCell key={column.id}>
                  {canEdit && manual ? (
                    <label className="grid gap-1 text-xs" htmlFor={fieldId}>
                      <span className="sr-only">{column.name}</span>
                      <input
                        aria-label={`${tableName} ${rowIndex + 1} ${column.name}`}
                        className="min-h-9 min-w-28 rounded border border-slate-300 bg-white px-2 text-sm text-slate-900"
                        disabled={Boolean(activeDraft.submission)}
                        id={fieldId}
                        name={`${row.id}:${column.id}`}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setDraft((current) =>
                            editDrawingTableDraftCell(
                              settleDrawingTableDraft(
                                current,
                                table,
                                persistenceStatus,
                              ),
                              row.id,
                              column.id,
                              value,
                            ),
                          );
                        }}
                        step={column.kind === "number" ? "any" : undefined}
                        type={column.kind}
                        value={
                          activeDraft.cellValues[row.id]?.[column.id] ?? ""
                        }
                      />
                    </label>
                  ) : reusable && previous ? (
                    resolved[rowIndex][previous.name]
                  ) : (
                    "저장 후 계산"
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

  function applyDraft(allowConflict = false) {
    if ((activeDraft.conflicted || propertyConflict) && !allowConflict) {
      setDraft(activeDraft);
      return;
    }
    if (propertyConflict) {
      setError("현재 모든 행에 적용할 수 있는 사용자 속성을 선택하세요.");
      return;
    }
    try {
      const patch = buildDrawingTableDraftSubmission(table, activeDraft);
      const accepted = onCommand(
        updateDrawingTableCommand(state, actorId, table.id, patch),
      );
      setDraft(markDrawingTableDraftSubmitted(activeDraft, patch, accepted));
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

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    applyDraft();
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
      if (
        !onCommand(
          updateDrawingTableCommand(state, actorId, table.id, { rows }),
        )
      ) {
        setError("행 추가 작업을 시작하지 못했습니다.");
        return;
      }
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  }

  return (
    <section
      aria-label={`${table.name} 일람표`}
      className="mt-4 rounded border border-slate-200 bg-white p-2 text-slate-700"
    >
      <form
        className="grid gap-3"
        data-drawing-shortcuts="ignore"
        onReset={() => {
          setDraft(createDrawingTableDraft(table));
          setError(null);
        }}
        onSubmit={save}
      >
        <label className="grid gap-1 text-xs">
          일람표 이름
          <input
            aria-label={`일람표 이름: ${table.name}`}
            className="min-h-10 rounded border border-slate-300 bg-white px-2 text-sm text-slate-900"
            disabled={Boolean(activeDraft.submission)}
            maxLength={255}
            onChange={(event) => {
              const name = event.currentTarget.value;
              setDraft((current) =>
                editDrawingTableDraft(
                  reconcileDrawingTableDraft(current, table),
                  { name },
                ),
              );
            }}
            required
            type="text"
            value={activeDraft.name}
          />
        </label>
        <fieldset
          className="grid gap-2"
          disabled={Boolean(activeDraft.submission)}
        >
          <legend className="text-xs font-semibold text-slate-700">
            열 구성
          </legend>
          {activeDraft.columns.map((column, index) => (
            <div
              className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-2"
              key={column.id}
            >
              <label className="grid gap-1 text-xs">
                열 이름
                <input
                  aria-label={`열 이름: ${column.name}`}
                  className="min-h-9 rounded border border-slate-300 bg-white px-2 text-sm text-slate-900"
                  maxLength={255}
                  onChange={(event) => {
                    const name = event.currentTarget.value;
                    setDraft((current) =>
                      updateDrawingTableDraftColumn(
                        reconcileDrawingTableDraft(current, table),
                        column.id,
                        { name },
                      ),
                    );
                  }}
                  required
                  type="text"
                  value={column.name}
                />
              </label>
              <label className="grid gap-1 text-xs">
                열 종류
                <select
                  aria-label={`열 종류: ${column.name}`}
                  className="min-h-9 rounded border border-slate-300 bg-white px-2 text-sm text-slate-900"
                  onChange={(event) => {
                    const kind = event.currentTarget
                      .value as DrawingTable["columns"][number]["kind"];
                    setDraft((current) =>
                      updateDrawingTableDraftColumn(
                        reconcileDrawingTableDraft(current, table),
                        column.id,
                        {
                          kind,
                          propertySchemaId: null,
                        },
                      ),
                    );
                  }}
                  value={column.kind}
                >
                  <option value="object_name">객체 이름</option>
                  <option value="object_type">객체 종류</option>
                  <option value="text">텍스트</option>
                  <option value="number">숫자</option>
                  <option
                    disabled={propertySchemas.length === 0}
                    value="property"
                  >
                    사용자 속성
                  </option>
                </select>
              </label>
              {column.kind === "property" ? (
                <label className="grid gap-1 text-xs">
                  사용자 속성
                  <select
                    aria-label={`사용자 속성: ${column.name}`}
                    className="min-h-9 rounded border border-slate-300 bg-white px-2 text-sm text-slate-900"
                    onChange={(event) => {
                      const propertySchemaId = event.currentTarget.value;
                      setDraft((current) =>
                        updateDrawingTableDraftColumn(
                          reconcileDrawingTableDraft(current, table),
                          column.id,
                          { propertySchemaId },
                        ),
                      );
                    }}
                    required
                    value={column.propertySchemaId ?? ""}
                  >
                    <option disabled value="">
                      속성 선택
                    </option>
                    {column.propertySchemaId &&
                    !applicablePropertySchemaIds.has(
                      column.propertySchemaId,
                    ) ? (
                      <option disabled value={column.propertySchemaId}>
                        {allPropertySchemas.find(
                          (schema) => schema.id === column.propertySchemaId,
                        )?.name ?? "선택한 속성"}{" "}
                        · 현재 행에 적용 불가
                      </option>
                    ) : null}
                    {propertySchemas.map((schema) => (
                      <option key={schema.id} value={schema.id}>
                        {schema.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="grid grid-cols-3 gap-1">
                <button
                  aria-label={`열 위로 이동: ${column.name}`}
                  className="min-h-9 rounded border border-slate-300 bg-white text-xs text-slate-700 disabled:opacity-40"
                  disabled={index === 0}
                  onClick={() =>
                    setDraft((current) =>
                      moveDrawingTableDraftColumn(
                        reconcileDrawingTableDraft(current, table),
                        column.id,
                        -1,
                      ),
                    )
                  }
                  type="button"
                >
                  위로
                </button>
                <button
                  aria-label={`열 아래로 이동: ${column.name}`}
                  className="min-h-9 rounded border border-slate-300 bg-white text-xs text-slate-700 disabled:opacity-40"
                  disabled={index === activeDraft.columns.length - 1}
                  onClick={() =>
                    setDraft((current) =>
                      moveDrawingTableDraftColumn(
                        reconcileDrawingTableDraft(current, table),
                        column.id,
                        1,
                      ),
                    )
                  }
                  type="button"
                >
                  아래로
                </button>
                <button
                  aria-label={`열 삭제: ${column.name}`}
                  className="min-h-9 rounded border border-slate-300 bg-white text-xs text-slate-700 disabled:opacity-40"
                  disabled={activeDraft.columns.length === 1}
                  onClick={() => {
                    try {
                      setDraft((current) =>
                        deleteDrawingTableDraftColumn(
                          reconcileDrawingTableDraft(current, table),
                          column.id,
                        ),
                      );
                      setError(null);
                    } catch (caught) {
                      setError(message(caught));
                    }
                  }}
                  type="button"
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
          <button
            aria-label={`열 추가: ${table.name}`}
            className="min-h-9 rounded border border-dashed border-slate-300 bg-white px-2 text-sm text-slate-700"
            onClick={() =>
              setDraft((current) =>
                addDrawingTableDraftColumn(
                  reconcileDrawingTableDraft(current, table),
                ),
              )
            }
            type="button"
          >
            열 추가
          </button>
        </fieldset>
        {content}
        {activeDraft.submission ? (
          <p className="text-xs text-amber-800" role="status">
            저장 결과를 확인하는 동안 입력을 보존하고 있습니다.
          </p>
        ) : null}
        {propertyConflict ? (
          <p className="text-xs text-red-700" role="alert">
            현재 모든 행에 적용할 수 없는 사용자 속성이 선택되어 저장할 수
            없습니다. 적용 가능한 속성을 다시 선택하세요.
          </p>
        ) : null}
        {activeDraft.conflicted ? (
          <p className="text-xs text-red-700" role="alert">
            {persistenceStatus === "failed"
              ? "로컬 저장에 실패했습니다. 입력을 보존했습니다."
              : persistenceStatus === "conflicted"
                ? "저장 충돌이 발생했습니다. 입력을 보존했습니다."
                : "원격에서 일람표 구조가 변경되었습니다."}{" "}
            최신값을 사용하거나 내 입력을 현재 버전에 다시 적용하세요.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          {activeDraft.submission ? (
            <button
              className="col-span-2 min-h-9 rounded border border-slate-300 bg-slate-50 px-2 text-sm text-slate-600 opacity-60"
              disabled
              type="button"
            >
              저장 결과 확인 중
            </button>
          ) : activeDraft.conflicted ||
            activeDraft.submissionRejected ||
            propertyConflict ? (
            <>
              <button
                className="min-h-9 rounded border border-slate-300 bg-white px-2 text-sm text-slate-700"
                onClick={() => {
                  setDraft(createDrawingTableDraft(table));
                  setError(null);
                }}
                type="button"
              >
                최신값 사용
              </button>
              <button
                className="min-h-9 rounded bg-amber-500 px-2 text-sm font-semibold text-slate-950"
                disabled={propertyConflict}
                onClick={() => applyDraft(true)}
                type="button"
              >
                {activeDraft.submissionRejected
                  ? "다시 시도"
                  : "내 입력 재적용"}
              </button>
            </>
          ) : (
            <>
              <button
                className="min-h-9 rounded border border-slate-300 bg-white px-2 text-sm text-slate-700"
                type="reset"
              >
                취소
              </button>
              <button
                className="min-h-9 rounded bg-indigo-600 px-2 text-sm font-semibold text-white"
                type="submit"
              >
                일람표 저장
              </button>
            </>
          )}
        </div>
      </form>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          aria-label={`선택 대상을 일람표로 추가: ${table.name}`}
          className="min-h-9 rounded border border-slate-300 bg-white px-2 text-sm text-slate-700 disabled:opacity-50"
          disabled={selectedIds.length === 0 || Boolean(activeDraft.submission)}
          onClick={addTargets}
          type="button"
        >
          선택 대상을 일람표로 추가
        </button>
        <button
          aria-label={`일람표 삭제: ${table.name}`}
          className="min-h-9 rounded border border-slate-300 bg-white px-2 text-sm text-slate-700 disabled:opacity-50"
          disabled={Boolean(activeDraft.submission)}
          onClick={() => {
            try {
              if (
                !onCommand(deleteDrawingTableCommand(state, actorId, table.id))
              ) {
                setError("일람표 삭제 작업을 시작하지 못했습니다.");
                return;
              }
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
        <p className="mt-2 text-xs text-red-700" role="alert">
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
    persistenceStatus = "settled",
    selectedIds,
    state,
  } = props;
  const [error, setError] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState(() =>
    createDrawingTableCreateDraft(),
  );
  const structure = state.structure;
  const submittedTableId = createDraft.submission?.targetTableId;
  const submittedTable =
    structure && submittedTableId
      ? structure.tables[submittedTableId]
      : undefined;
  const activeCreateDraft = settleDrawingTableCreateDraft(
    createDraft,
    submittedTable,
    persistenceStatus,
  );
  useEffect(() => {
    setCreateDraft((current) =>
      settleDrawingTableCreateDraft(
        current,
        submittedTable,
        persistenceStatus,
      ),
    );
  }, [persistenceStatus, submittedTable]);
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
  const mutationAllowed = canEdit && persistenceStatus !== "conflicted";

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const createId = () => crypto.randomUUID();
      const propertySchemas = applicableDrawingPropertySchemas(
        state,
        selectedIds,
      );
      const columns: DrawingTable["columns"] = [
        {
          id: createId(),
          name: "객체 이름",
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
          name: "메모",
          kind: "text" as const,
          propertySchemaId: null,
        },
      ];
      const command = createDrawingTableCommand(
        state,
        actorId,
        {
          name: activeCreateDraft.name,
          columns,
          rows: targetRows(state, selectedIds, createId),
        },
        createId,
      );
      const action = command.actions[0];
      const targetTableId = "entity" in action ? action.entity.id : "";
      const accepted = onCommand(command);
      setCreateDraft(
        markDrawingTableCreateDraftSubmitted(
          activeCreateDraft,
          targetTableId,
          accepted,
        ),
      );
      if (!accepted) {
        setError("일람표 만들기 작업을 시작하지 못했습니다.");
        return;
      }
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  }

  return (
    <section
      aria-labelledby="drawing-tables-title"
      className="mt-6 border-t border-slate-200 pt-6 text-slate-700"
    >
      <div className="[&_.text-amber-200]:text-amber-800 [&_.text-emerald-200]:text-emerald-700 [&_.text-rose-200]:text-rose-700 [&_.text-slate-200]:text-slate-700 [&_.text-slate-400]:text-slate-600 [&_[data-slot=table-caption]]:text-slate-600 [&_[data-slot=table-footer]]:bg-slate-50 [&_[data-slot=table-head]]:text-slate-900 [&_[data-slot=table-row]]:border-slate-200 [&_section]:border-slate-200 [&>section>div]:bg-slate-50">
        <DrawingSemanticSchedulesPanel
          evidence={evidence}
          evidenceError={evidenceError}
          hasUnconfirmedChanges={hasUnconfirmedChanges}
          lineage={lineage}
          state={state}
        />
      </div>
      <h2
        className="mt-6 border-t border-slate-200 pt-6 text-sm font-bold text-slate-900"
        id="drawing-tables-title"
      >
        사용자 정의 일람표
      </h2>
      {mutationAllowed ? (
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
              className="min-h-10 rounded border border-slate-300 bg-white px-2 text-sm text-slate-900"
              disabled={Boolean(activeCreateDraft.submission)}
              id="new-drawing-schedule-name"
              maxLength={255}
              name="name"
              onChange={(event) => {
                const name = event.currentTarget.value;
                setCreateDraft((current) => ({
                  ...settleDrawingTableCreateDraft(
                    current,
                    submittedTable,
                    persistenceStatus,
                  ),
                  name,
                  submission: null,
                  submissionRejected: false,
                }));
                setError(null);
              }}
              required
              type="text"
              value={activeCreateDraft.name}
            />
          </label>
          <button
            className="min-h-10 rounded bg-indigo-600 px-3 text-sm font-semibold text-white disabled:opacity-50"
            disabled={
              selectedIds.length === 0 ||
              Boolean(activeCreateDraft.submission)
            }
            type="submit"
          >
            {activeCreateDraft.submission
              ? "저장 결과 확인 중"
              : activeCreateDraft.submissionRejected
                ? "일람표 만들기 다시 시도"
                : "선택 대상을 일람표로 추가"}
          </button>
        </form>
      ) : (
        <p className="mt-2 text-xs text-slate-600">
          {persistenceStatus === "conflicted"
            ? "저장 충돌을 해결한 뒤 일람표를 편집할 수 있습니다."
            : "읽기 전용 일람표"}
        </p>
      )}
      {activeCreateDraft.submissionRejected ? (
        <p className="mt-2 text-xs text-amber-800" role="status">
          저장되지 않은 일람표 이름을 보존했습니다.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {tables.map((table) => (
        <ScheduleTable
          {...props}
          canEdit={mutationAllowed}
          key={table.id}
          persistenceStatus={persistenceStatus}
          table={table}
        />
      ))}
    </section>
  );
}
