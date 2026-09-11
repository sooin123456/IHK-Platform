import { z } from "zod";

import type { DrawingDocumentState } from "./drawing-commands.ts";
import {
  createDrawingCadImportClient,
  DrawingCadImportClientError,
  type AppliedDrawingCadImportOperations,
} from "./drawing-cad-import-client.ts";
import type { PreparedNativeDrawingDwgProjectImport } from "./drawing-native-dwg-import-source.server.ts";
import { sameDrawingCanonicalValue } from "./drawing-structure.ts";
import {
  DrawingObjectSchema,
  DrawingObjectSourceSchema,
  DrawingOperationInputSchema,
  DrawingStructureLayerSchema,
} from "./drawing-workspace.types.ts";

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const UnitCode = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
const CanonicalReceipt = z
  .object({
    clientOperationId: Uuid,
    revisionId: Uuid,
    actorId: Uuid,
    sequence: z.number().int().positive(),
    resultVersions: z.record(Uuid, z.number().int().positive().nullable()),
    operationSha256: Sha256,
  })
  .strict();
const PreparedPlan = z
  .object({
    requestId: Uuid,
    sourceSha256: Sha256,
    units: z
      .object({
        code: UnitCode,
        label: z.enum(["in", "ft", "mm", "cm", "m"]),
        millimetersPerUnit: z.number().positive(),
        source: z.enum(["declared", "user_selected"]),
      })
      .strict(),
    layers: z.array(DrawingStructureLayerSchema),
    objects: z.array(DrawingObjectSchema),
    sources: z
      .array(DrawingObjectSourceSchema)
      .refine((sources) =>
        sources.every((source) => source.sourceKind === "dwg_entity"),
      ),
    operations: z.array(z.unknown()).min(1),
    coverage: z
      .object({
        modelSpaceEntities: z.number().int().nonnegative(),
        importedEntities: z.number().int().nonnegative(),
        unsupportedEntities: z.number().int().nonnegative(),
        nonModelSpaceEntities: z.number().int().nonnegative(),
      })
      .strict(),
    warnings: z.array(
      z.object({ code: z.string().min(1), detail: z.string().min(1) }).strict(),
    ),
    canonicalReceipts: z.array(CanonicalReceipt),
    qualification: z.literal("experimental-unqualified"),
    persistenceAuthority: z.literal("operation-attested"),
  })
  .passthrough();

function exactPreparedPlan(input: unknown) {
  const parsed = PreparedPlan.safeParse(input);
  if (
    !parsed.success ||
    !parsed.data.operations.every((operation) => {
      const envelope = DrawingOperationInputSchema.safeParse(operation);
      return (
        envelope.success && sameDrawingCanonicalValue(envelope.data, operation)
      );
    })
  )
    return null;
  return parsed.data;
}

export class DrawingNativeDwgImportClientError extends Error {
  constructor(message: string) {
    super(message.replaceAll("CAD", "Native DWG"));
    this.name = "DrawingNativeDwgImportClientError";
  }
}

export type NativeDrawingDwgQueuedGroupPrepareRequest = {
  revisionId: string;
  canvasId: string;
  jobId: string;
  sourceSha256: string;
};

type NativeDrawingDwgQueuedGroupPrepare = (
  request: NativeDrawingDwgQueuedGroupPrepareRequest,
) => Promise<unknown>;

type NativeDrawingDwgPrepareFetch = (
  url: string,
  init: {
    method: "POST";
    body: FormData;
    headers: { Accept: "application/json" };
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

const client =
  createDrawingCadImportClient<NativeDrawingDwgQueuedGroupPrepareRequest>({
    historyKind: "dwg_import",
    sourceKind: "dwg_entity",
    sourceIdentity(source) {
      const parsed = z
        .object({
          sourceFileId: Uuid,
          sourceSha256: Sha256,
          unitCode: UnitCode,
          unitSource: z.enum(["declared", "user_selected"]),
          analysisJobId: Uuid,
          reportSha256: Sha256,
        })
        .passthrough()
        .safeParse(source);
      return parsed.success
        ? {
            sourceFileId: parsed.data.sourceFileId,
            sourceSha256: parsed.data.sourceSha256,
            unitCode: parsed.data.unitCode,
            unitSource: parsed.data.unitSource,
            analysisJobId: parsed.data.analysisJobId,
            reportSha256: parsed.data.reportSha256,
          }
        : null;
    },
    prepareRequest({ operation, canvasId, source }) {
      return {
        revisionId: operation.revisionId,
        canvasId,
        jobId: source.analysisJobId as string,
        sourceSha256: source.sourceSha256,
      };
    },
    preparedPlan(input) {
      return exactPreparedPlan(input);
    },
  });

function nativeError(error: unknown): never {
  if (error instanceof DrawingNativeDwgImportClientError) throw error;
  if (error instanceof DrawingCadImportClientError)
    throw new DrawingNativeDwgImportClientError(error.message);
  throw error;
}

export async function applyNativeDrawingDwgImportOperations(
  state: DrawingDocumentState,
  actorId: string,
  operations: readonly unknown[],
  canonicalReceipts: readonly unknown[] = [],
): Promise<AppliedDrawingCadImportOperations> {
  try {
    return await client.applyOperations(
      state,
      actorId,
      operations,
      canonicalReceipts,
    );
  } catch (error) {
    nativeError(error);
  }
}

export function createNativeDrawingDwgImportSendGate() {
  const gate = client.createSendGate();
  return {
    rememberPrepared(groupId: string, operations: readonly unknown[]) {
      try {
        return gate.rememberPrepared(groupId, operations);
      } catch (error) {
        nativeError(error);
      }
    },
    async send<T>(input: {
      operation: unknown;
      knownOperations: () => Promise<readonly unknown[]>;
      prepare: NativeDrawingDwgQueuedGroupPrepare;
      send: () => Promise<T>;
    }): Promise<T> {
      try {
        return await gate.send(input);
      } catch (error) {
        nativeError(error);
      }
    },
  };
}

export async function prepareNativeDrawingDwgImportOverHttp({
  action,
  request,
  fetch = globalThis.fetch,
  signal,
}: {
  action: string;
  request: NativeDrawingDwgQueuedGroupPrepareRequest;
  fetch?: NativeDrawingDwgPrepareFetch;
  signal?: AbortSignal;
}): Promise<PreparedNativeDrawingDwgProjectImport> {
  const form = new FormData();
  form.set("intent", "prepare_native_dwg_import");
  form.set("revision_id", request.revisionId);
  form.set("canvas_id", request.canvasId);
  form.set("job_id", request.jobId);

  let payload: unknown;
  try {
    const response = await fetch(action, {
      method: "POST",
      body: form,
      headers: { Accept: "application/json" },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok)
      throw new DrawingNativeDwgImportClientError(
        "Native DWG import preparation is temporarily unavailable.",
      );
    payload = await response.json();
  } catch (error) {
    if (error instanceof DrawingNativeDwgImportClientError) throw error;
    throw new DrawingNativeDwgImportClientError(
      "Native DWG import preparation is temporarily unavailable.",
    );
  }
  const parsed = z
    .object({
      ok: z.literal(true),
      kind: z.literal("native_dwg_import_prepared"),
      error: z.null().optional(),
      result: z.unknown(),
    })
    .safeParse(payload);
  const result = parsed.success ? exactPreparedPlan(parsed.data.result) : null;
  if (!result)
    throw new DrawingNativeDwgImportClientError(
      "Native DWG import preparation returned an invalid response.",
    );
  const sources = result.sources.filter(
    (source) => source.sourceKind === "dwg_entity",
  );
  if (
    result.sourceSha256 !== request.sourceSha256 ||
    sources.length === 0 ||
    sources.some(
      (source) =>
        source.sourceSha256 !== request.sourceSha256 ||
        source.analysisJobId !== request.jobId ||
        source.reportSha256 !== sources[0].reportSha256,
    )
  )
    throw new DrawingNativeDwgImportClientError(
      "Native DWG import preparation does not match the requested job.",
    );
  return result as PreparedNativeDrawingDwgProjectImport;
}
