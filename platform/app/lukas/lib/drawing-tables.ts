import {
  DrawingTableSchema,
  type DrawingPropertySchema,
  type DrawingTable,
} from "./drawing-workspace.types.ts";
import {
  applyDrawingStructureActions,
  DrawingStructureError,
} from "./drawing-structure.ts";
import type {
  DrawingCommand,
  DrawingDocumentState,
} from "./drawing-commands.ts";

type TableState = Pick<
  DrawingDocumentState,
  "revisionId" | "objects" | "structure"
> & {
  structure: NonNullable<DrawingDocumentState["structure"]>;
};

type DrawingTableColumn = DrawingTable["columns"][number];

export type DrawingTableDraft = {
  baselineCellValues: Record<string, Record<string, string>>;
  baselineColumns: DrawingTable["columns"];
  baselineName: string;
  cellValues: Record<string, Record<string, string>>;
  columns: DrawingTable["columns"];
  conflicted: boolean;
  name: string;
  rowSnapshots: Record<string, DrawingTable["rows"][number]>;
  submission: {
    baseVersion: number;
    patch: Pick<DrawingTable, "name" | "columns" | "rows">;
    sawPending: boolean;
    touchedCellKeys: string[];
  } | null;
  submissionRejected: boolean;
  tableId: string;
  tableVersion: number;
  touchedCellKeys: string[];
};

export type DrawingTableCreateDraft = {
  name: string;
  submission: { sawPending: boolean; targetTableId: string } | null;
  submissionRejected: boolean;
};

export type DrawingTablePersistenceStatus =
  | "pending"
  | "settled"
  | "conflicted"
  | "failed";

function drawingTableCellKey(rowId: string, columnId: string) {
  return `${rowId}:${columnId}`;
}

function drawingTableCellValues(
  table: DrawingTable,
  columns: readonly DrawingTableColumn[],
) {
  const canonicalColumns = new Map(
    table.columns.map((column) => [column.id, column]),
  );
  return Object.fromEntries(
    table.rows.map((row) => [
      row.id,
      Object.fromEntries(
        columns.flatMap((column) => {
          if (column.kind !== "text" && column.kind !== "number") return [];
          const canonical = canonicalColumns.get(column.id);
          const value =
            canonical?.kind === column.kind ? row.cells[column.id] : undefined;
          return [[column.id, value == null ? "" : String(value)]];
        }),
      ),
    ]),
  );
}

function drawingTableRowSnapshots(table: DrawingTable) {
  return Object.fromEntries(
    table.rows.map((row) => [row.id, { ...row, cells: { ...row.cells } }]),
  );
}

function reconcileDrawingTableDraftCells(
  draft: DrawingTableDraft,
  table: DrawingTable,
) {
  const canonical = drawingTableCellValues(table, draft.columns);
  const rows = new Set(table.rows.map((row) => row.id));
  const canonicalColumns = new Map(
    table.columns.map((column) => [column.id, column]),
  );
  const baselineColumns = new Map(
    draft.baselineColumns.map((column) => [column.id, column]),
  );
  const manualColumns = new Set(
    draft.columns
      .filter((column) => column.kind === "text" || column.kind === "number")
      .map((column) => column.id),
  );
  let conflicted = false;
  const touchedCellKeys = draft.touchedCellKeys.filter((key) => {
    const [rowId, columnId] = key.split(":");
    if (!manualColumns.has(columnId)) return false;
    const localValue = draft.cellValues[rowId]?.[columnId] ?? "";
    const canonicalValue = canonical[rowId]?.[columnId] ?? "";
    if (!rows.has(rowId)) {
      conflicted = true;
      canonical[rowId] = {
        ...(draft.cellValues[rowId] ?? {}),
        [columnId]: localValue,
      };
      return true;
    }
    const baselineColumn = baselineColumns.get(columnId);
    const canonicalColumn = canonicalColumns.get(columnId);
    if (
      baselineColumn &&
      (!canonicalColumn || canonicalColumn.kind !== baselineColumn.kind)
    )
      conflicted = true;
    if (localValue === canonicalValue) return false;
    if (
      (draft.baselineCellValues[rowId]?.[columnId] ?? "") !== canonicalValue
    )
      conflicted = true;
    return true;
  });
  for (const key of touchedCellKeys) {
    const [rowId, columnId] = key.split(":");
    canonical[rowId][columnId] = draft.cellValues[rowId]?.[columnId] ?? "";
  }
  return {
    baselineCellValues: drawingTableCellValues(table, draft.columns),
    cellValues: canonical,
    conflicted,
    touchedCellKeys,
  };
}

function drawingTableDraftCellsForColumns(
  draft: DrawingTableDraft,
  previousColumns: readonly DrawingTableColumn[],
  columns: readonly DrawingTableColumn[],
) {
  const previous = new Map(
    previousColumns.map((column) => [column.id, column]),
  );
  const next = new Map(columns.map((column) => [column.id, column]));
  const changed = new Set(
    columns
      .filter((column) => previous.get(column.id)?.kind !== column.kind)
      .map((column) => column.id),
  );
  const cellValues = Object.fromEntries(
    Object.entries(draft.cellValues).map(([rowId, values]) => [
      rowId,
      Object.fromEntries(
        columns.flatMap((column) => {
          if (column.kind !== "text" && column.kind !== "number") return [];
          return [
            [
              column.id,
              changed.has(column.id) ? "" : (values[column.id] ?? ""),
            ],
          ];
        }),
      ),
    ]),
  );
  const touchedCellKeys = draft.touchedCellKeys.filter((key) => {
    const columnId = key.split(":")[1];
    const column = next.get(columnId);
    return (
      !changed.has(columnId) &&
      (column?.kind === "text" || column?.kind === "number")
    );
  });
  return { cellValues, touchedCellKeys };
}

function sameDrawingTableColumns(
  left: readonly DrawingTableColumn[],
  right: readonly DrawingTableColumn[],
) {
  return (
    left.length === right.length &&
    left.every((column, index) => {
      const candidate = right[index];
      return (
        column.id === candidate.id &&
        column.name === candidate.name &&
        column.kind === candidate.kind &&
        column.propertySchemaId === candidate.propertySchemaId
      );
    })
  );
}

function sameDrawingTableStructure(
  name: string,
  columns: readonly DrawingTableColumn[],
  candidateName: string,
  candidateColumns: readonly DrawingTableColumn[],
) {
  return (
    name === candidateName && sameDrawingTableColumns(columns, candidateColumns)
  );
}

/** Creates the local table-structure draft kept across realtime projections. */
export function createDrawingTableDraft(
  table: DrawingTable,
): DrawingTableDraft {
  const cellValues = drawingTableCellValues(table, table.columns);
  return {
    baselineCellValues: cellValues,
    baselineColumns: [...table.columns],
    baselineName: table.name,
    cellValues,
    columns: [...table.columns],
    conflicted: false,
    name: table.name,
    rowSnapshots: drawingTableRowSnapshots(table),
    submission: null,
    submissionRejected: false,
    tableId: table.id,
    tableVersion: table.version,
    touchedCellKeys: [],
  };
}

export function createDrawingTableCreateDraft(): DrawingTableCreateDraft {
  return { name: "", submission: null, submissionRejected: false };
}

export function markDrawingTableCreateDraftSubmitted(
  draft: DrawingTableCreateDraft,
  targetTableId: string,
  accepted: boolean,
): DrawingTableCreateDraft {
  return {
    ...draft,
    submission: accepted ? { sawPending: false, targetTableId } : null,
    submissionRejected: !accepted,
  };
}

export function settleDrawingTableCreateDraft(
  draft: DrawingTableCreateDraft,
  table: DrawingTable | undefined,
  status: DrawingTablePersistenceStatus,
): DrawingTableCreateDraft {
  if (!draft.submission) return draft;
  if (status === "pending")
    return {
      ...draft,
      submission: { ...draft.submission, sawPending: true },
    };
  if (status === "settled" && table?.id === draft.submission.targetTableId)
    return createDrawingTableCreateDraft();
  if (status === "settled" && !draft.submission.sawPending) return draft;
  return { ...draft, submission: null, submissionRejected: true };
}

export function editDrawingTableDraft(
  draft: DrawingTableDraft,
  patch: Partial<Pick<DrawingTableDraft, "name" | "columns">>,
): DrawingTableDraft {
  const columns = patch.columns ? [...patch.columns] : draft.columns;
  return {
    ...draft,
    ...(patch.columns
      ? drawingTableDraftCellsForColumns(draft, draft.columns, columns)
      : {}),
    ...patch,
    columns,
    submission: null,
    submissionRejected: false,
  };
}

/** Preserves local structure edits while clean drafts adopt canonical updates. */
export function reconcileDrawingTableDraft(
  draft: DrawingTableDraft,
  table: DrawingTable,
): DrawingTableDraft {
  if (draft.tableId !== table.id) return createDrawingTableDraft(table);
  if (draft.tableVersion === table.version) return draft;
  const cells = reconcileDrawingTableDraftCells(draft, table);
  const rowSnapshots = {
    ...draft.rowSnapshots,
    ...drawingTableRowSnapshots(table),
  };
  if (draft.submission)
    return {
      ...draft,
      ...cells,
      conflicted: draft.conflicted || cells.conflicted,
      rowSnapshots,
      tableVersion: table.version,
    };
  if (
    sameDrawingTableStructure(
      draft.name,
      draft.columns,
      table.name,
      table.columns,
    ) &&
    cells.touchedCellKeys.length === 0
  )
    return createDrawingTableDraft(table);
  const dirty = !sameDrawingTableStructure(
    draft.name,
    draft.columns,
    draft.baselineName,
    draft.baselineColumns,
  );
  if (!dirty && cells.touchedCellKeys.length === 0)
    return createDrawingTableDraft(table);
  const remoteStructureChanged = !sameDrawingTableStructure(
    table.name,
    table.columns,
    draft.baselineName,
    draft.baselineColumns,
  );
  return {
    ...draft,
    ...cells,
    conflicted: draft.conflicted || remoteStructureChanged || cells.conflicted,
    rowSnapshots,
    tableVersion: table.version,
  };
}

export function editDrawingTableDraftCell(
  draft: DrawingTableDraft,
  rowId: string,
  columnId: string,
  value: string,
): DrawingTableDraft {
  const column = draft.columns.find((candidate) => candidate.id === columnId);
  if (!column || (column.kind !== "text" && column.kind !== "number"))
    throw new DrawingStructureError(
      "Only manual drawing schedule cells can be edited.",
    );
  if (!(rowId in draft.cellValues))
    throw new DrawingStructureError("Drawing schedule row does not exist.");
  const key = drawingTableCellKey(rowId, columnId);
  return {
    ...draft,
    cellValues: {
      ...draft.cellValues,
      [rowId]: { ...draft.cellValues[rowId], [columnId]: value },
    },
    submission: null,
    submissionRejected: false,
    touchedCellKeys: draft.touchedCellKeys.includes(key)
      ? draft.touchedCellKeys
      : [...draft.touchedCellKeys, key],
  };
}

export function updateDrawingTableDraftColumn(
  draft: DrawingTableDraft,
  columnId: string,
  patch: Partial<Omit<DrawingTableColumn, "id">>,
): DrawingTableDraft {
  const columns = draft.columns.map((column) => {
    if (column.id !== columnId) return column;
    const updated = { ...column, ...patch };
    return updated.kind === "property"
      ? updated
      : { ...updated, propertySchemaId: null };
  });
  return {
    ...draft,
    ...drawingTableDraftCellsForColumns(draft, draft.columns, columns),
    columns,
    submission: null,
    submissionRejected: false,
  };
}

export function moveDrawingTableDraftColumn(
  draft: DrawingTableDraft,
  columnId: string,
  direction: -1 | 1,
): DrawingTableDraft {
  const from = draft.columns.findIndex((column) => column.id === columnId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= draft.columns.length) return draft;
  const columns = [...draft.columns];
  [columns[from], columns[to]] = [columns[to], columns[from]];
  return {
    ...draft,
    columns,
    submission: null,
    submissionRejected: false,
  };
}

export function deleteDrawingTableDraftColumn(
  draft: DrawingTableDraft,
  columnId: string,
): DrawingTableDraft {
  if (draft.columns.length === 1)
    throw new DrawingStructureError(
      "Drawing schedules require at least one column.",
    );
  const columns = draft.columns.filter((column) => column.id !== columnId);
  return {
    ...draft,
    ...drawingTableDraftCellsForColumns(draft, draft.columns, columns),
    columns,
    submission: null,
    submissionRejected: false,
  };
}

export function addDrawingTableDraftColumn(
  draft: DrawingTableDraft,
  createId: () => string = () => crypto.randomUUID(),
): DrawingTableDraft {
  let suffix = 1;
  let name = "새 열";
  const names = new Set(draft.columns.map((column) => column.name));
  while (names.has(name)) name = `새 열 ${++suffix}`;
  const columns: DrawingTable["columns"] = [
    ...draft.columns,
    {
      id: createId(),
      name,
      kind: "text",
      propertySchemaId: null,
    },
  ];
  return {
    ...draft,
    ...drawingTableDraftCellsForColumns(draft, draft.columns, columns),
    columns,
    submission: null,
    submissionRejected: false,
  };
}

/** Builds one table patch and drops stale cells for deleted or retagged columns. */
export function buildDrawingTableDraftPatch(
  table: DrawingTable,
  name: string,
  columns: DrawingTable["columns"],
  manualCells: Readonly<
    Record<string, Readonly<Record<string, string | number | null | undefined>>>
  > = {},
): Pick<DrawingTable, "name" | "columns" | "rows"> {
  const previousColumns = new Map(
    table.columns.map((column) => [column.id, column]),
  );
  const rows = table.rows.map((row) => {
    const cells: DrawingTable["rows"][number]["cells"] = {};
    for (const column of columns) {
      if (column.kind !== "text" && column.kind !== "number") continue;
      const previous = previousColumns.get(column.id);
      const reusable = previous?.kind === column.kind;
      const inputs = manualCells[row.id];
      const hasInput = Boolean(
        inputs && Object.prototype.hasOwnProperty.call(inputs, column.id),
      );
      const value = hasInput
        ? inputs[column.id]
        : reusable
          ? row.cells[column.id]
          : undefined;
      if (value !== undefined && (reusable || (value !== null && value !== "")))
        cells[column.id] = value;
    }
    return { ...row, cells };
  });
  return { name, columns, rows };
}

/** Parses controlled manual inputs into the one canonical put-table patch. */
export function buildDrawingTableDraftSubmission(
  table: DrawingTable,
  draft: DrawingTableDraft,
) {
  const rows = [...table.rows];
  const rowIds = new Set(rows.map((row) => row.id));
  for (const key of draft.touchedCellKeys) {
    const rowId = key.split(":")[0];
    const snapshot = draft.rowSnapshots[rowId];
    if (!rowIds.has(rowId) && snapshot) {
      rows.push({ ...snapshot, cells: { ...snapshot.cells } });
      rowIds.add(rowId);
    }
  }
  const source = { ...table, rows };
  const manualCells = Object.fromEntries(
    rows.map((row) => [
      row.id,
      Object.fromEntries(
        draft.columns.flatMap((column) => {
          if (column.kind !== "text" && column.kind !== "number") return [];
          const raw = draft.cellValues[row.id]?.[column.id] ?? "";
          return [
            [
              column.id,
              raw === "" ? null : column.kind === "number" ? Number(raw) : raw,
            ],
          ];
        }),
      ),
    ]),
  );
  return buildDrawingTableDraftPatch(
    source,
    draft.name,
    draft.columns,
    manualCells,
  );
}

/** Records command admission without treating asynchronous persistence as success. */
export function markDrawingTableDraftSubmitted(
  draft: DrawingTableDraft,
  patch: Pick<DrawingTable, "name" | "columns" | "rows">,
  accepted: boolean,
): DrawingTableDraft {
  return {
    ...draft,
    conflicted: false,
    submission: accepted
      ? {
          baseVersion: draft.tableVersion,
          patch,
          sawPending: false,
          touchedCellKeys: [...draft.touchedCellKeys],
        }
      : null,
    submissionRejected: !accepted,
  };
}

function drawingTableReflectsSubmission(
  table: DrawingTable,
  submission: NonNullable<DrawingTableDraft["submission"]>,
) {
  if (
    !sameDrawingTableStructure(
      table.name,
      table.columns,
      submission.patch.name,
      submission.patch.columns,
    )
  )
    return false;
  const rows = new Map(table.rows.map((row) => [row.id, row]));
  const submittedRows = new Map(
    submission.patch.rows.map((row) => [row.id, row]),
  );
  return submission.touchedCellKeys.every((key) => {
    const [rowId, columnId] = key.split(":");
    const row = rows.get(rowId);
    const submittedRow = submittedRows.get(rowId);
    return (
      Boolean(row && submittedRow) &&
      Object.is(row?.cells[columnId], submittedRow?.cells[columnId])
    );
  });
}

/** Cleans only an acknowledged projection that contains the submitted draft. */
export function settleDrawingTableDraft(
  draft: DrawingTableDraft,
  table: DrawingTable,
  status: DrawingTablePersistenceStatus,
): DrawingTableDraft {
  const current = reconcileDrawingTableDraft(draft, table);
  if (!current.submission) return current;
  if (status === "pending")
    return {
      ...current,
      submission: { ...current.submission, sawPending: true },
    };
  if (
    status === "settled" &&
    drawingTableReflectsSubmission(table, current.submission)
  )
    return createDrawingTableDraft(table);
  if (
    status === "settled" &&
    !current.submission.sawPending &&
    table.version === current.submission.baseVersion
  )
    return current;
  return {
    ...current,
    conflicted: true,
    submission: null,
    submissionRejected: true,
  };
}

export const DRAWING_TABLE_MISSING_TARGET = "[missing target]";

function canonicalState(state: DrawingDocumentState): TableState {
  if (!state.structure)
    throw new DrawingStructureError("Drawing schedule state is unavailable.");
  return state as TableState;
}

function command(
  state: TableState,
  actorId: string,
  table: DrawingTable,
  baseVersion: number | null,
): Extract<DrawingCommand, { type: "mutate_structure" }> {
  const actions = [{ kind: "put_table" as const, entity: table, baseVersion }];
  applyDrawingStructureActions(
    { revisionId: state.revisionId, ...state.structure },
    actions,
  );
  return { type: "mutate_structure", actorId, actions };
}

export function formatDrawingTablePropertyValue(
  schema: DrawingPropertySchema,
  value: string | number | boolean | null,
): string | number {
  if (value === null) return "";
  if (schema.valueType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new DrawingStructureError(
        `Drawing property ${schema.name} is not numeric.`,
      );
    return value;
  }
  if (schema.valueType === "boolean") {
    if (typeof value !== "boolean")
      throw new DrawingStructureError(
        `Drawing property ${schema.name} is not boolean.`,
      );
    return String(value);
  }
  if (typeof value !== "string")
    throw new DrawingStructureError(
      `Drawing property ${schema.name} is not text.`,
    );
  if (schema.valueType === "enum" && !schema.enumOptions.includes(value))
    throw new DrawingStructureError(
      `Drawing property ${schema.name} has an unknown option.`,
    );
  return value;
}

/** Resolves stored rows and columns without formulas, sorting, or mutable caches. */
export function resolveDrawingTable(
  inputTable: DrawingTable,
  inputState: DrawingDocumentState,
): Array<Record<string, string | number>> {
  const table = DrawingTableSchema.parse(inputTable);
  const state = canonicalState(inputState);
  const columns = new Map(table.columns.map((column) => [column.id, column]));
  const propertySchemas = new Map(
    table.columns
      .filter((column) => column.kind === "property")
      .map((column) => {
        const schema = column.propertySchemaId
          ? state.structure.propertySchemas[column.propertySchemaId]
          : undefined;
        if (!schema)
          throw new DrawingStructureError(
            `Drawing schedule property column ${column.name} is invalid.`,
          );
        return [column.id, schema] as const;
      }),
  );
  return table.rows.map((row) => {
    for (const [columnId, value] of Object.entries(row.cells)) {
      const column = columns.get(columnId);
      if (!column || (column.kind !== "text" && column.kind !== "number"))
        throw new DrawingStructureError(
          "Drawing schedules store only manual text or number cells.",
        );
      if (
        value !== null &&
        ((column.kind === "text" && typeof value !== "string") ||
          (column.kind === "number" &&
            (typeof value !== "number" || !Number.isFinite(value))))
      )
        throw new DrawingStructureError(
          "Drawing schedule manual cell type is invalid.",
        );
    }
    const targetId = row.objectId ?? row.blockInstanceId;
    const target = row.objectId
      ? state.objects[row.objectId]
      : row.blockInstanceId
        ? state.structure.blockInstances[row.blockInstanceId]
        : undefined;
    const missing = !targetId || !target;
    const targetKind = target
      ? "geometry" in target
        ? target.geometry.type
        : "block_instance"
      : undefined;
    if (
      targetKind &&
      [...propertySchemas.values()].some(
        (schema) =>
          !(schema.appliesTo as readonly string[]).includes(targetKind),
      )
    )
      throw new DrawingStructureError(
        `Drawing schedule property does not apply to target ${targetId}.`,
      );
    const result: Record<string, string | number> = {};
    for (const column of table.columns) {
      if (column.kind === "text" || column.kind === "number") {
        result[column.name] = row.cells[column.id] ?? "";
        continue;
      }
      if (missing) {
        result[column.name] = DRAWING_TABLE_MISSING_TARGET;
        continue;
      }
      if (column.kind === "object_name") {
        result[column.name] = target.name;
        continue;
      }
      if (column.kind === "object_type") {
        result[column.name] =
          "geometry" in target ? target.geometry.type : "block_instance";
        continue;
      }
      const schema = propertySchemas.get(column.id);
      if (!schema)
        throw new DrawingStructureError(
          `Drawing schedule property column ${column.name} is invalid.`,
        );
      const matches = Object.values(state.structure.propertyValues).filter(
        (value) =>
          value.schemaId === schema.id &&
          (value.objectId === targetId || value.blockInstanceId === targetId),
      );
      if (matches.length > 1)
        throw new DrawingStructureError(
          `Drawing schedule target ${targetId} has duplicate values.`,
        );
      result[column.name] = formatDrawingTablePropertyValue(
        schema,
        matches[0]?.value ?? null,
      );
    }
    return result;
  });
}

export function createDrawingTableCommand(
  inputState: DrawingDocumentState,
  actorId: string,
  input: Omit<DrawingTable, "id" | "revisionId" | "version">,
  createId: () => string = () => crypto.randomUUID(),
) {
  const state = canonicalState(inputState);
  const table = DrawingTableSchema.parse({
    ...input,
    id: createId(),
    revisionId: state.revisionId,
    name: input.name.trim(),
    version: 1,
  });
  if (
    Object.values(state.structure.tables).some(
      (current) => current.name === table.name,
    )
  )
    throw new DrawingStructureError(
      `Drawing schedule name ${table.name} already exists.`,
    );
  return command(state, actorId, table, null);
}

export function updateDrawingTableCommand(
  inputState: DrawingDocumentState,
  actorId: string,
  tableId: string,
  patch: Partial<Pick<DrawingTable, "name" | "columns" | "rows">>,
) {
  const state = canonicalState(inputState);
  const current = state.structure.tables[tableId];
  if (!current)
    throw new DrawingStructureError(
      `Drawing schedule ${tableId} does not exist.`,
    );
  const table = DrawingTableSchema.parse({
    ...current,
    ...patch,
    ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
  });
  if (
    Object.values(state.structure.tables).some(
      (candidate) => candidate.id !== tableId && candidate.name === table.name,
    )
  )
    throw new DrawingStructureError(
      `Drawing schedule name ${table.name} already exists.`,
    );
  return command(state, actorId, table, current.version);
}

export function deleteDrawingTableCommand(
  inputState: DrawingDocumentState,
  actorId: string,
  tableId: string,
): Extract<DrawingCommand, { type: "mutate_structure" }> {
  const state = canonicalState(inputState);
  const current = state.structure.tables[tableId];
  if (!current)
    throw new DrawingStructureError(
      `Drawing schedule ${tableId} does not exist.`,
    );
  return {
    type: "mutate_structure",
    actorId,
    actions: [
      { kind: "delete_table", id: tableId, baseVersion: current.version },
    ],
  };
}
