import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "database.types";
import type { Json } from "database.types";
import { DRAWING_CAD_IMPORT_PLAN_LIMITS } from "./drawing-cad-import-plan.server.ts";
import {
  loadDrawingCadImportCanonicalReceipts,
  type DrawingCadImportCanonicalReceipt,
} from "./drawing-cad-import-receipts.server.ts";
import {
  buildNativeDrawingDwgImportPlan,
  type NativeDrawingDwgImportPlan,
} from "./drawing-native-dwg-import-plan.server.ts";
import {
  NativeDrawingDwgImportResultSchema,
  NativeDrawingDwgImportScopeSchema,
  NativeDrawingDwgImportStatusSchema,
} from "./drawing-native-dwg-import-jobs.server.ts";
import { sameDrawingCanonicalValue } from "./drawing-structure.ts";
import { DrawingOperationInputSchema } from "./drawing-workspace.types.ts";

const Uuid = z.string().uuid();
const NativeDrawingDwgProjectImportInputSchema = z
  .object({
    projectId: Uuid,
    revisionId: Uuid,
    canvasId: Uuid,
    jobId: Uuid,
    actorId: Uuid,
  })
  .strict();
const NativeDrawingDwgImportContextSchema = z
  .object({
    scope: NativeDrawingDwgImportScopeSchema,
    status: NativeDrawingDwgImportStatusSchema,
    result: NativeDrawingDwgImportResultSchema.nullable(),
  })
  .strict();
const NativeDrawingDwgPlanAttestationReceiptSchema = z
  .object({
    planId: Uuid,
    planCount: z
      .number()
      .int()
      .min(1)
      .max(DRAWING_CAD_IMPORT_PLAN_LIMITS.maxOperations),
    alreadyAppliedCount: z.number().int().min(0),
  })
  .strict();

const unitSelections = {
  1: { code: 1, label: "in" },
  2: { code: 2, label: "ft" },
  4: { code: 4, label: "mm" },
  5: { code: 5, label: "cm" },
  6: { code: 6, label: "m" },
} as const;

type ApplicationSupabaseClient = SupabaseClient<Database>;
type RpcClient = Pick<ApplicationSupabaseClient, "rpc">;
type SessionClient = Pick<ApplicationSupabaseClient, "auth" | "from" | "rpc">;

export type PreparedNativeDrawingDwgProjectImport = Omit<
  NativeDrawingDwgImportPlan,
  "persistenceAuthority"
> & {
  canonicalReceipts: DrawingCadImportCanonicalReceipt[];
  persistenceAuthority: "operation-attested";
};

export class DrawingNativeDwgImportSourceError extends Error {
  readonly status: 400 | 403 | 409 | 503;

  constructor(message: string, status: 400 | 403 | 409 | 503 = 400) {
    super(message);
    this.name = "DrawingNativeDwgImportSourceError";
    this.status = status;
  }
}

function importError(message: string, status: 400 | 403 | 409 | 503 = 400) {
  return new DrawingNativeDwgImportSourceError(message, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function rpc(
  client: RpcClient,
  name: string,
  args: Record<string, unknown>,
  unavailableMessage: string,
) {
  if (!client || typeof client.rpc !== "function")
    throw importError(unavailableMessage, 503);
  let response: unknown;
  try {
    response = await Reflect.apply(client.rpc, client, [name, args]);
  } catch {
    throw importError(unavailableMessage, 503);
  }
  if (!isRecord(response) || response.error)
    throw importError(unavailableMessage, 503);
  return response.data;
}

async function requireActor(client: SessionClient, actorId: string) {
  let auth: unknown;
  try {
    auth = await client.auth.getUser();
  } catch {
    throw importError("Native DWG import actor is not authenticated.", 403);
  }
  const data = isRecord(auth) ? auth.data : null;
  const user = isRecord(data) ? data.user : null;
  if (
    !isRecord(auth) ||
    auth.error ||
    !isRecord(user) ||
    user.is_anonymous ||
    user.id !== actorId
  )
    throw importError("Native DWG import actor is not authenticated.", 403);
}

async function loadNativeDrawingDwgAttestationAdminClient(): Promise<{
  default: RpcClient;
}> {
  const { default: adminClient } = await import(
    "~/core/lib/supa-admin-client.server"
  );
  return { default: adminClient };
}

/**
 * Converts one authenticated analyzed DWG job into an exact service-attested
 * canonical operation plan. Neither client report data nor analysis receipts
 * alone can produce operation authority.
 */
export async function prepareNativeDrawingDwgProjectImport(
  client: SessionClient,
  rawInput: {
    projectId: string;
    revisionId: string;
    canvasId: string;
    jobId: string;
    actorId: string;
  },
  loadAdminClient: () => Promise<{
    default: RpcClient;
  }> = loadNativeDrawingDwgAttestationAdminClient,
): Promise<PreparedNativeDrawingDwgProjectImport> {
  const parsedInput =
    NativeDrawingDwgProjectImportInputSchema.safeParse(rawInput);
  if (!parsedInput.success)
    throw importError("Native DWG import request is invalid.");
  const input = parsedInput.data;

  await requireActor(client, input.actorId);
  const rawContext = await rpc(
    client,
    "lukas_drawing_native_dwg_import_context",
    { p_job_id: input.jobId, p_include_result: true },
    "Native DWG import context is unavailable.",
  );
  const parsedContext =
    NativeDrawingDwgImportContextSchema.safeParse(rawContext);
  if (!parsedContext.success)
    throw importError("Native DWG import context is invalid.", 503);
  const context = parsedContext.data;
  if (
    context.scope.projectId !== input.projectId ||
    context.scope.revisionId !== input.revisionId ||
    context.scope.canvasId !== input.canvasId ||
    context.status.jobId !== input.jobId
  )
    throw importError(
      "Native DWG import target does not match the authenticated job.",
    );
  if (
    context.status.status !== "analyzed" ||
    !context.status.receipt ||
    !context.result
  )
    throw importError("Native DWG analysis is not ready.", 409);
  const receipt = context.result.receipt;
  if (
    receipt.jobId !== input.jobId ||
    receipt.source.fileId !== context.scope.sourceFileId ||
    receipt.source.sha256 !== context.scope.sourceSha256 ||
    !sameDrawingCanonicalValue(context.status.receipt, receipt)
  )
    throw importError("Native DWG import analysis receipt is invalid.", 503);

  let report: unknown;
  try {
    report = JSON.parse(context.result.reportText) as unknown;
  } catch {
    throw importError("Native DWG import analysis report is invalid.");
  }
  const unitOverride = context.scope.unitOverride;
  let plan: NativeDrawingDwgImportPlan;
  try {
    plan = buildNativeDrawingDwgImportPlan({
      report,
      expectedSource: {
        sha256: receipt.source.sha256,
        byteSize: receipt.source.byteSize,
        headerVersion: receipt.source.headerVersion,
      },
      revisionId: context.scope.revisionId,
      canvasId: context.scope.canvasId,
      sourceFileId: context.scope.sourceFileId,
      ...(unitOverride === null
        ? {}
        : {
            unitOverride: unitSelections[unitOverride],
          }),
      analysisJobId: input.jobId,
      reportSha256: receipt.reportSha256,
    });
  } catch {
    throw importError("Native DWG canonical import plan is invalid.");
  }
  if (
    plan.persistenceAuthority !== "not-issued" ||
    plan.operations.length === 0 ||
    plan.sourceSha256 !== context.scope.sourceSha256 ||
    !plan.operations.every(
      (operation) => DrawingOperationInputSchema.safeParse(operation).success,
    )
  )
    throw importError("Native DWG canonical import plan is invalid.");

  let adminClient: RpcClient;
  try {
    adminClient = (await loadAdminClient()).default;
  } catch {
    throw importError(
      "Native DWG import plan attestation is unavailable.",
      503,
    );
  }
  const rawAttestation = await rpc(
    adminClient,
    "lukas_drawing_attest_dwg_import_plan",
    {
      p_job_id: input.jobId,
      p_operations: plan.operations as unknown as Json,
    },
    "Native DWG import plan attestation is unavailable.",
  );
  const parsedAttestation =
    NativeDrawingDwgPlanAttestationReceiptSchema.safeParse(rawAttestation);
  if (
    !parsedAttestation.success ||
    parsedAttestation.data.planId !== plan.requestId ||
    parsedAttestation.data.planCount !== plan.operations.length ||
    parsedAttestation.data.alreadyAppliedCount >
      parsedAttestation.data.planCount
  )
    throw importError("Native DWG import plan attestation is invalid.", 503);

  let canonicalReceipts: DrawingCadImportCanonicalReceipt[];
  try {
    canonicalReceipts = await loadDrawingCadImportCanonicalReceipts(
      client,
      {
        projectId: input.projectId,
        revisionId: input.revisionId,
        actorId: input.actorId,
        operations: plan.operations,
        maxOperations: DRAWING_CAD_IMPORT_PLAN_LIMITS.maxOperations,
      },
      (message, status) => importError(`Native DWG ${message}.`, status),
    );
  } catch (error) {
    if (error instanceof DrawingNativeDwgImportSourceError) throw error;
    throw importError(
      "Native DWG canonical operation receipt lookup failed.",
      503,
    );
  }
  if (canonicalReceipts.length !== parsedAttestation.data.alreadyAppliedCount)
    throw importError(
      "Native DWG canonical operation receipt prefix is incomplete.",
      503,
    );

  const prepared: PreparedNativeDrawingDwgProjectImport = {
    ...plan,
    canonicalReceipts,
    persistenceAuthority: "operation-attested",
  };
  if (
    new TextEncoder().encode(JSON.stringify(prepared)).byteLength >
    DRAWING_CAD_IMPORT_PLAN_LIMITS.maxSerializedBytes
  )
    throw importError("Native DWG canonical receipt response is oversized.");
  return prepared;
}
