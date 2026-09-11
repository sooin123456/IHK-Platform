import { z } from "zod";

import type { DrawingDocumentState } from "./drawing-commands.ts";
import {
  createDrawingCadImportClient,
  DrawingCadImportClientError,
  type AppliedDrawingCadImportOperations,
  type DrawingCadCanonicalReceipt,
  type DrawingCadImportOperationResult,
} from "./drawing-cad-import-client.ts";

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const UnitCode = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
const PreparedPlan = z
  .object({
    requestId: Uuid,
    sourceSha256: Sha256,
    operations: z.array(z.unknown()),
  })
  .passthrough();

export class DrawingDxfImportClientError extends Error {
  constructor(message: string) {
    super(message.replaceAll("CAD", "DXF"));
    this.name = "DrawingDxfImportClientError";
  }
}

export type DrawingDxfCanonicalReceipt = DrawingCadCanonicalReceipt;
export type DrawingDxfImportOperationResult = DrawingCadImportOperationResult;
export type AppliedDrawingDxfImportOperations =
  AppliedDrawingCadImportOperations;

export type DrawingDxfQueuedGroupPrepareRequest = {
  revisionId: string;
  canvasId: string;
  sourceFileId: string;
  sourceSha256: string;
  createdAt: string;
  unitCode: "" | "1" | "2" | "4" | "5" | "6";
};

type DrawingDxfQueuedGroupPrepare = (
  request: DrawingDxfQueuedGroupPrepareRequest,
) => Promise<unknown>;

type DrawingDxfPrepareFetch = (
  url: string,
  init: {
    method: "POST";
    body: FormData;
    headers: { Accept: "application/json" };
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

const client =
  createDrawingCadImportClient<DrawingDxfQueuedGroupPrepareRequest>({
    historyKind: "dxf_import",
    sourceKind: "dxf_entity",
    sourceIdentity(source) {
      const parsed = z
        .object({
          sourceFileId: Uuid,
          sourceSha256: Sha256,
          unitCode: UnitCode,
          unitSource: z.enum(["declared", "user_selected"]),
        })
        .passthrough()
        .safeParse(source);
      return parsed.success
        ? {
            sourceFileId: parsed.data.sourceFileId,
            sourceSha256: parsed.data.sourceSha256,
            unitCode: parsed.data.unitCode,
            unitSource: parsed.data.unitSource,
          }
        : null;
    },
    prepareRequest({ operation, canvasId, source }) {
      return {
        revisionId: operation.revisionId,
        canvasId,
        sourceFileId: source.sourceFileId,
        sourceSha256: source.sourceSha256,
        createdAt: operation.createdAt,
        unitCode:
          source.unitSource === "user_selected"
            ? (String(source.unitCode) as "1" | "2" | "4" | "5" | "6")
            : "",
      };
    },
    preparedPlan(input) {
      const parsed = PreparedPlan.safeParse(input);
      return parsed.success ? parsed.data : null;
    },
  });

function dxfError(error: unknown): never {
  if (error instanceof DrawingDxfImportClientError) throw error;
  if (error instanceof DrawingCadImportClientError)
    throw new DrawingDxfImportClientError(error.message);
  throw error;
}

export async function prepareDrawingDxfImportOverHttp({
  action,
  request,
  fetch = globalThis.fetch,
  signal,
}: {
  action: string;
  request: DrawingDxfQueuedGroupPrepareRequest;
  fetch?: DrawingDxfPrepareFetch;
  signal?: AbortSignal;
}): Promise<unknown> {
  const form = new FormData();
  form.set("intent", "prepare_dxf_import");
  form.set("revision_id", request.revisionId);
  form.set("canvas_id", request.canvasId);
  form.set("source_file_id", request.sourceFileId);
  form.set("created_at", request.createdAt);
  form.set("unit_code", request.unitCode);

  let payload: unknown;
  try {
    const response = await fetch(action, {
      method: "POST",
      body: form,
      headers: { Accept: "application/json" },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok)
      throw new DrawingDxfImportClientError(
        "DXF import preparation is temporarily unavailable.",
      );
    payload = await response.json();
  } catch (error) {
    if (error instanceof DrawingDxfImportClientError) throw error;
    throw new DrawingDxfImportClientError(
      "DXF import preparation is temporarily unavailable.",
    );
  }
  const parsed = z
    .object({
      ok: z.literal(true),
      kind: z.literal("dxf_import_prepared"),
      result: PreparedPlan,
    })
    .safeParse(payload);
  if (!parsed.success)
    throw new DrawingDxfImportClientError(
      "DXF import preparation returned an invalid response.",
    );
  return parsed.data.result;
}

export function applyDrawingDxfImportOperation(
  state: DrawingDocumentState,
  actorId: string,
  plannedInput: unknown,
): DrawingDxfImportOperationResult {
  try {
    return client.applyOperation(state, actorId, plannedInput);
  } catch (error) {
    dxfError(error);
  }
}

export async function applyDrawingDxfImportOperations(
  state: DrawingDocumentState,
  actorId: string,
  plannedInputs: readonly unknown[],
  canonicalReceiptInputs: readonly unknown[] = [],
): Promise<AppliedDrawingDxfImportOperations> {
  try {
    return await client.applyOperations(
      state,
      actorId,
      plannedInputs,
      canonicalReceiptInputs,
    );
  } catch (error) {
    dxfError(error);
  }
}

export async function attestQueuedDrawingDxfGroupBeforeSend(input: {
  operation: unknown;
  knownOperations: readonly unknown[];
  prepare: DrawingDxfQueuedGroupPrepare;
}): Promise<string | null> {
  try {
    return await client.attestQueuedGroupBeforeSend(input);
  } catch (error) {
    dxfError(error);
  }
}

export function createDrawingDxfImportSendGate() {
  const gate = client.createSendGate();
  return {
    rememberPrepared(groupId: string, operations: readonly unknown[]) {
      try {
        return gate.rememberPrepared(groupId, operations);
      } catch (error) {
        dxfError(error);
      }
    },
    async send<T>(input: {
      operation: unknown;
      knownOperations: () => Promise<readonly unknown[]>;
      prepare: DrawingDxfQueuedGroupPrepare;
      send: () => Promise<T>;
    }): Promise<T> {
      try {
        return await gate.send(input);
      } catch (error) {
        dxfError(error);
      }
    },
  };
}
