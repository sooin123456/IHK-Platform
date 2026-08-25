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
        (schema) => !schema.appliesTo.includes(targetKind),
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
