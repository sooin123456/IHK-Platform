import {
  DrawingObjectSourceSchema,
  type DrawingObjectSource,
} from "./drawing-workspace.types.ts";

type DrawingIfcSourceIndex = ReadonlyMap<string, readonly string[]>;

export type DrawingIfcLoadIndex = {
  sourceFileId: string;
  sourceSha256: string;
  generation: number;
  globalIdToExpressId: ReadonlyMap<string, number>;
  expressIds: ReadonlySet<number>;
};

export type DrawingIfcVerifiedRevisionIdentity = {
  previousFileId: string;
  previousSha256: string;
  currentFileId: string;
  currentSha256: string;
  ifcGlobalId: string;
};

export type DrawingIfcFocusState = {
  generation: number;
  requestGeneration: number;
  handledRequestId: string | null;
  focusedExpressId: number | null;
};

function sourceIndexKey(sourceFileId: string, ifcGlobalId: string) {
  return `${sourceFileId}\u0000${ifcGlobalId}`;
}

export function createDrawingIfcSourceIndex(
  sources: Readonly<Record<string, DrawingObjectSource>>,
): DrawingIfcSourceIndex {
  const building = new Map<string, Set<string>>();
  for (const sourceInput of Object.values(sources)) {
    const source = DrawingObjectSourceSchema.parse(sourceInput);
    if (source.sourceKind !== "ifc_element") continue;
    const key = sourceIndexKey(source.sourceFileId, source.ifcGlobalId);
    const objectIds = building.get(key) ?? new Set<string>();
    objectIds.add(source.objectId);
    building.set(key, objectIds);
  }
  return new Map(
    [...building].map(([key, objectIds]) => [
      key,
      [...objectIds].sort((left, right) => left.localeCompare(right)),
    ]),
  );
}

export function matchDrawingObjectsForIfcSelection(
  index: DrawingIfcSourceIndex,
  selection: {
    origin: "user" | "programmatic";
    sourceFileId: string;
    ifcGlobalId: string | null;
  },
):
  | { status: "ignored_programmatic" }
  | { status: "no_match" }
  | { status: "unique"; objectId: string }
  | { status: "ambiguous"; objectIds: readonly string[] } {
  if (selection.origin === "programmatic")
    return { status: "ignored_programmatic" };
  if (!selection.ifcGlobalId) return { status: "no_match" };
  const objectIds = index.get(
    sourceIndexKey(selection.sourceFileId, selection.ifcGlobalId),
  );
  if (!objectIds?.length) return { status: "no_match" };
  if (objectIds.length === 1)
    return { status: "unique", objectId: objectIds[0] };
  return { status: "ambiguous", objectIds: [...objectIds] };
}

export function createDrawingIfcLoadIndex(input: {
  sourceFileId: string;
  sourceSha256: string;
  generation: number;
  elements: readonly { expressId: number; ifcGlobalId: string | null }[];
}): DrawingIfcLoadIndex {
  if (
    !/^[0-9a-f]{64}$/.test(input.sourceSha256) ||
    !Number.isInteger(input.generation) ||
    input.generation < 0
  )
    throw new Error("IFC load identity is invalid.");
  const globalIdToExpressId = new Map<string, number>();
  const expressIds = new Set<number>();
  for (const element of input.elements) {
    if (!Number.isInteger(element.expressId) || element.expressId <= 0)
      throw new Error("IFC ExpressId must be a positive integer.");
    if (expressIds.has(element.expressId))
      throw new Error("IFC ExpressId must be unique within a load.");
    expressIds.add(element.expressId);
    if (element.ifcGlobalId !== null) {
      if (!/^[0-9A-Za-z_$]{22}$/.test(element.ifcGlobalId))
        throw new Error("IFC GlobalId must be exact.");
      if (globalIdToExpressId.has(element.ifcGlobalId))
        throw new Error("IFC GlobalId must be unique within a load.");
      globalIdToExpressId.set(element.ifcGlobalId, element.expressId);
    }
  }
  return {
    sourceFileId: input.sourceFileId,
    sourceSha256: input.sourceSha256,
    generation: input.generation,
    globalIdToExpressId,
    expressIds,
  };
}

export function resolveDrawingIfcFocus(
  sourceInput: DrawingObjectSource,
  load: DrawingIfcLoadIndex,
  requestedGeneration: number,
  verifiedRevisionIdentity?: DrawingIfcVerifiedRevisionIdentity,
):
  | { status: "stale_generation" }
  | { status: "no_match" }
  | {
      status: "matched";
      expressId: number;
      matchedBy:
        "global_id" | "same_sha_express_id" | "verified_revision_global_id";
    } {
  if (requestedGeneration !== load.generation)
    return { status: "stale_generation" };
  const source = DrawingObjectSourceSchema.parse(sourceInput);
  if (source.sourceKind !== "ifc_element") return { status: "no_match" };
  const sameFileIdentity =
    load.sourceFileId === source.sourceFileId &&
    load.sourceSha256 === source.sourceSha256;
  const verifiedSuccessor =
    verifiedRevisionIdentity?.previousFileId === source.sourceFileId &&
    verifiedRevisionIdentity.previousSha256 === source.sourceSha256 &&
    verifiedRevisionIdentity.currentFileId === load.sourceFileId &&
    verifiedRevisionIdentity.currentSha256 === load.sourceSha256 &&
    verifiedRevisionIdentity.ifcGlobalId === source.ifcGlobalId;
  const globalExpressId = load.globalIdToExpressId.get(source.ifcGlobalId);
  if (globalExpressId !== undefined && (sameFileIdentity || verifiedSuccessor))
    return {
      status: "matched",
      expressId: globalExpressId,
      matchedBy: sameFileIdentity ? "global_id" : "verified_revision_global_id",
    };
  const elementId = source.elementId === null ? NaN : Number(source.elementId);
  if (
    sameFileIdentity &&
    Number.isSafeInteger(elementId) &&
    load.expressIds.has(elementId)
  )
    return {
      status: "matched",
      expressId: elementId,
      matchedBy: "same_sha_express_id",
    };
  return { status: "no_match" };
}

export function createDrawingIfcFocusState(
  generation: number,
): DrawingIfcFocusState {
  if (!Number.isInteger(generation) || generation < 0)
    throw new Error("IFC load generation is invalid.");
  return {
    generation,
    requestGeneration: 0,
    handledRequestId: null,
    focusedExpressId: null,
  };
}

export function nextDrawingIfcLoadGeneration(
  state: DrawingIfcFocusState,
  generation: number,
): DrawingIfcFocusState {
  if (!Number.isInteger(generation) || generation <= state.generation)
    throw new Error("IFC load generation must advance.");
  return createDrawingIfcFocusState(generation);
}

export function applyDrawingIfcFocusRequest(
  state: DrawingIfcFocusState,
  request: {
    requestId: string;
    generation: number;
    requestGeneration: number;
    expressId: number;
  },
):
  | {
      status: "applied";
      state: DrawingIfcFocusState;
      effect: {
        origin: "programmatic";
        expressId: number;
        requestId: string;
        generation: number;
        requestGeneration: number;
      };
    }
  | {
      status: "ignored_stale" | "ignored_stale_request" | "ignored_duplicate";
      state: DrawingIfcFocusState;
      effect: null;
    } {
  if (request.generation !== state.generation)
    return { status: "ignored_stale", state, effect: null };
  if (
    !request.requestId ||
    !Number.isInteger(request.requestGeneration) ||
    request.requestGeneration <= 0 ||
    !Number.isInteger(request.expressId) ||
    request.expressId <= 0
  )
    throw new Error("IFC focus request is invalid.");
  if (request.requestId === state.handledRequestId)
    return { status: "ignored_duplicate", state, effect: null };
  if (request.requestGeneration <= state.requestGeneration)
    return { status: "ignored_stale_request", state, effect: null };
  const next = {
    ...state,
    requestGeneration: request.requestGeneration,
    handledRequestId: request.requestId,
    focusedExpressId: request.expressId,
  };
  return {
    status: "applied",
    state: next,
    effect: {
      origin: "programmatic",
      expressId: request.expressId,
      requestId: request.requestId,
      generation: request.generation,
      requestGeneration: request.requestGeneration,
    },
  };
}
