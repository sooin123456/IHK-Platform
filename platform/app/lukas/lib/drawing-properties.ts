import {
  DrawingPropertySchemaSchema,
  type DrawingPropertySchema,
  type DrawingPropertyValue,
  type DrawingStructureAction,
} from "./drawing-workspace.types.ts";
import {
  applyDrawingStructureActions,
  DrawingStructureError,
} from "./drawing-structure.ts";
import type {
  DrawingCommand,
  DrawingDocumentState,
} from "./drawing-commands.ts";

type PropertyState = Pick<
  DrawingDocumentState,
  "revisionId" | "objects" | "structure"
> & {
  structure: NonNullable<DrawingDocumentState["structure"]>;
};

type PropertyValue = DrawingPropertyValue["value"];

function canonicalState(state: DrawingDocumentState): PropertyState {
  if (!state.structure)
    throw new DrawingStructureError("Drawing property state is unavailable.");
  return state as PropertyState;
}

function targetType(state: PropertyState, targetId: string) {
  const object = state.objects[targetId];
  if (object) return object.geometry.type;
  if (state.structure.blockInstances[targetId])
    return "block_instance" as const;
  throw new DrawingStructureError(
    `Drawing property target ${targetId} does not exist.`,
  );
}

function propertyValueFor(
  state: PropertyState,
  schemaId: string,
  targetId: string,
) {
  const matches = Object.values(state.structure.propertyValues).filter(
    (value) =>
      value.schemaId === schemaId &&
      (value.objectId === targetId || value.blockInstanceId === targetId),
  );
  if (matches.length > 1)
    throw new DrawingStructureError(
      `Drawing property ${schemaId} has duplicate values for target ${targetId}.`,
    );
  return matches[0];
}

function command(
  state: PropertyState,
  actorId: string,
  actions: DrawingStructureAction[],
): Extract<DrawingCommand, { type: "mutate_structure" }> {
  applyDrawingStructureActions(
    { revisionId: state.revisionId, ...state.structure },
    actions,
  );
  return { type: "mutate_structure", actorId, actions };
}

function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Converts a native control value without widening the canonical property type. */
export function parseDrawingPropertyInput(
  schema: DrawingPropertySchema,
  input: string | boolean,
): PropertyValue {
  if (schema.valueType === "boolean") {
    if (typeof input !== "boolean")
      throw new DrawingStructureError(
        "Boolean drawing properties require a checkbox value.",
      );
    return input;
  }
  if (typeof input !== "string")
    throw new DrawingStructureError("Drawing property input must be text.");
  if (schema.valueType === "text") return input;
  if (input === "") return null;
  if (schema.valueType === "number") {
    const value = Number(input);
    if (!Number.isFinite(value))
      throw new DrawingStructureError(
        "Drawing property numbers must be finite.",
      );
    return value;
  }
  if (schema.valueType === "date") {
    if (!validCalendarDate(input))
      throw new DrawingStructureError(
        "Drawing property dates must be valid YYYY-MM-DD values.",
      );
    return input;
  }
  if (!schema.enumOptions.includes(input))
    throw new DrawingStructureError("Drawing property option is unavailable.");
  return input;
}

export function applicableDrawingPropertySchemas(
  inputState: DrawingDocumentState,
  targetIds: readonly string[],
) {
  const state = canonicalState(inputState);
  if (targetIds.length === 0 || new Set(targetIds).size !== targetIds.length)
    return [];
  const types = targetIds.map((targetId) => targetType(state, targetId));
  return Object.values(state.structure.propertySchemas)
    .filter((schema) => types.every((type) => schema.appliesTo.includes(type)))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
}

export function drawingPropertyValue(
  inputState: DrawingDocumentState,
  schemaId: string,
  targetId: string,
) {
  return (
    propertyValueFor(canonicalState(inputState), schemaId, targetId)?.value ??
    null
  );
}

export function createDrawingPropertySchemaCommand(
  inputState: DrawingDocumentState,
  actorId: string,
  input: Omit<DrawingPropertySchema, "id" | "revisionId" | "version">,
  createId: () => string = () => crypto.randomUUID(),
) {
  const state = canonicalState(inputState);
  const entity = DrawingPropertySchemaSchema.parse({
    ...input,
    id: createId(),
    revisionId: state.revisionId,
    name: input.name.trim(),
    version: 1,
  });
  if (
    Object.values(state.structure.propertySchemas).some(
      (schema) => schema.name === entity.name,
    )
  )
    throw new DrawingStructureError(
      `Drawing property name ${entity.name} already exists.`,
    );
  return command(state, actorId, [
    { kind: "put_property_schema", entity, baseVersion: null },
  ]);
}

export function updateDrawingPropertySchemaCommand(
  inputState: DrawingDocumentState,
  actorId: string,
  schemaId: string,
  patch: Partial<
    Pick<
      DrawingPropertySchema,
      "name" | "valueType" | "enumOptions" | "appliesTo" | "required"
    >
  >,
) {
  const state = canonicalState(inputState);
  const current = state.structure.propertySchemas[schemaId];
  if (!current)
    throw new DrawingStructureError(
      `Drawing property schema ${schemaId} does not exist.`,
    );
  const entity = DrawingPropertySchemaSchema.parse({
    ...current,
    ...patch,
    ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
  });
  if (
    Object.values(state.structure.propertySchemas).some(
      (schema) => schema.id !== schemaId && schema.name === entity.name,
    )
  )
    throw new DrawingStructureError(
      `Drawing property name ${entity.name} already exists.`,
    );
  return command(state, actorId, [
    {
      kind: "put_property_schema",
      entity,
      baseVersion: current.version,
    },
  ]);
}

export function deleteDrawingPropertySchemaCommand(
  inputState: DrawingDocumentState,
  actorId: string,
  schemaId: string,
) {
  const state = canonicalState(inputState);
  const current = state.structure.propertySchemas[schemaId];
  if (!current)
    throw new DrawingStructureError(
      `Drawing property schema ${schemaId} does not exist.`,
    );
  const used =
    Object.values(state.structure.propertyValues).some(
      (value) => value.schemaId === schemaId,
    ) ||
    Object.values(state.structure.tables).some((table) =>
      table.columns.some((column) => column.propertySchemaId === schemaId),
    );
  if (used)
    throw new DrawingStructureError(
      "Referenced drawing property schemas cannot be deleted.",
    );
  return command(state, actorId, [
    {
      kind: "delete_property_schema",
      id: schemaId,
      baseVersion: current.version,
    },
  ]);
}

/** Builds one deterministic structure batch for every changed schema and target. */
export function setDrawingPropertySelectionValuesCommand(
  inputState: DrawingDocumentState,
  actorId: string,
  targetIds: readonly string[],
  values: Readonly<Record<string, PropertyValue>>,
  createId: () => string = () => crypto.randomUUID(),
) {
  const state = canonicalState(inputState);
  if (targetIds.length === 0 || new Set(targetIds).size !== targetIds.length)
    throw new DrawingStructureError(
      "Drawing property targets must be nonempty and unique.",
    );
  const orderedTargets = [...targetIds].sort();
  const actions: DrawingStructureAction[] = [];
  for (const schemaId of Object.keys(values).sort()) {
    const schema = state.structure.propertySchemas[schemaId];
    if (!schema)
      throw new DrawingStructureError(
        `Drawing property schema ${schemaId} does not exist.`,
      );
    for (const targetId of orderedTargets) {
      const type = targetType(state, targetId);
      if (!schema.appliesTo.includes(type))
        throw new DrawingStructureError(
          `Drawing property ${schema.name} does not apply to ${type}.`,
        );
      const current = propertyValueFor(state, schemaId, targetId);
      actions.push({
        kind: "put_property_value",
        entity: current
          ? { ...current, value: values[schemaId] }
          : {
              id: createId(),
              schemaId,
              objectId: state.objects[targetId] ? targetId : null,
              blockInstanceId: state.structure.blockInstances[targetId]
                ? targetId
                : null,
              value: values[schemaId],
              version: 1,
            },
        baseVersion: current?.version ?? null,
      });
    }
  }
  if (actions.length === 0)
    throw new DrawingStructureError(
      "A drawing property edit requires a value.",
    );
  return command(state, actorId, actions);
}

/** Produces deterministic cleanup actions that can precede a target deletion. */
export function drawingTargetReferenceCleanupActions(
  inputState: DrawingDocumentState,
  targetIds: readonly string[],
): DrawingStructureAction[] {
  const state = canonicalState(inputState);
  const targets = new Set(targetIds);
  const valueActions: DrawingStructureAction[] = Object.values(
    state.structure.propertyValues,
  )
    .filter(
      (value) =>
        (value.objectId !== null && targets.has(value.objectId)) ||
        (value.blockInstanceId !== null && targets.has(value.blockInstanceId)),
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((value) => ({
      kind: "delete_property_value" as const,
      id: value.id,
      baseVersion: value.version,
    }));
  const tableActions: DrawingStructureAction[] = Object.values(
    state.structure.tables,
  )
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((table) => {
      const rows = table.rows.filter(
        (row) =>
          !(row.objectId && targets.has(row.objectId)) &&
          !(row.blockInstanceId && targets.has(row.blockInstanceId)),
      );
      return rows.length === table.rows.length
        ? []
        : [
            {
              kind: "put_table" as const,
              entity: { ...table, rows },
              baseVersion: table.version,
            },
          ];
    });
  return [...valueActions, ...tableActions];
}

/** Records target-reference cleanup as one independently undoable command. */
export function cleanupDrawingTargetReferencesCommand(
  inputState: DrawingDocumentState,
  actorId: string,
  targetIds: readonly string[],
) {
  const state = canonicalState(inputState);
  const actions = drawingTargetReferenceCleanupActions(inputState, targetIds);
  if (actions.length === 0)
    throw new DrawingStructureError(
      "Drawing targets have no property or schedule references.",
    );
  return command(state, actorId, actions);
}

/** Deletes ordinary objects and every P2 reference as one cross-contract command. */
export function deleteDrawingObjectsWithReferencesCommand(
  inputState: DrawingDocumentState,
  actorId: string,
  targetIds: readonly string[],
): Extract<DrawingCommand, { type: "mutate_objects_with_references" }> {
  const state = canonicalState(inputState);
  const orderedIds = [...new Set(targetIds)].sort();
  if (orderedIds.length === 0 || orderedIds.length !== targetIds.length)
    throw new DrawingStructureError(
      "Drawing object deletion targets must be nonempty and unique.",
    );
  const objects = orderedIds.map((id) => {
    const object = state.objects[id];
    const layer = object ? state.structure.layers[object.layerId] : undefined;
    if (
      !object ||
      !layer ||
      !layer.visible ||
      layer.locked ||
      layer.systemKind === "source"
    )
      throw new DrawingStructureError(
        `Drawing object ${id} requires a visible unlocked user layer.`,
      );
    return structuredClone(object);
  });
  return {
    type: "mutate_objects_with_references",
    actorId,
    objectAction: "delete",
    objects,
    actions: drawingTargetReferenceCleanupActions(inputState, orderedIds),
  };
}

export function missingRequiredDrawingProperties(
  inputState: DrawingDocumentState,
) {
  if (!inputState.structure) return [];
  const state = canonicalState(inputState);
  const targets = [
    ...Object.values(state.objects).map((target) => ({
      id: target.id,
      type: target.geometry.type,
    })),
    ...Object.values(state.structure.blockInstances).map((target) => ({
      id: target.id,
      type: "block_instance" as const,
    })),
  ].sort((left, right) => left.id.localeCompare(right.id));
  return Object.values(state.structure.propertySchemas)
    .filter((schema) => schema.required)
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    )
    .flatMap((schema) =>
      targets
        .filter((target) => schema.appliesTo.includes(target.type))
        .filter(
          (target) =>
            propertyValueFor(state, schema.id, target.id)?.value == null,
        )
        .map((target) => ({
          schemaId: schema.id,
          schemaName: schema.name,
          targetId: target.id,
        })),
    );
}
