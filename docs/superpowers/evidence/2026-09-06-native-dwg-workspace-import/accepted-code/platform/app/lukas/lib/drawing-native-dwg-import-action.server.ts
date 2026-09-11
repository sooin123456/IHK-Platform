import { z } from "zod";

import {
  NativeDrawingDwgImportScopeSchema,
  NativeDrawingDwgImportStatusSchema,
  NativeDrawingDwgImportJobError,
  requestNativeDrawingDwgImport,
  type NativeDrawingDwgImportRpcClient,
  type NativeDrawingDwgImportScope,
} from "./drawing-native-dwg-import-jobs.server.ts";
import {
  prepareNativeDrawingDwgProjectImport,
  DrawingNativeDwgImportSourceError,
  type PreparedNativeDrawingDwgProjectImport,
} from "./drawing-native-dwg-import-source.server.ts";
import type {
  DrawingWorkspace,
  DrawingWorkspaceCapability,
  DrawingWorkspaceClient,
} from "./drawing-workspace.server.ts";

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const NativeUnitCode = z.union([
  z.literal(""),
  z.literal("1"),
  z.literal("2"),
  z.literal("4"),
  z.literal("5"),
  z.literal("6"),
]);

const RequestFormSchema = z
  .object({
    intent: z.literal("request_native_dwg_import"),
    revision_id: Uuid,
    canvas_id: Uuid,
    source_file_id: Uuid,
    request_id: Uuid,
    unit_code: NativeUnitCode,
  })
  .strict();
const StatusFormSchema = z
  .object({
    intent: z.literal("native_dwg_import_status"),
    revision_id: Uuid,
    canvas_id: Uuid,
    job_id: Uuid,
  })
  .strict();
const PrepareFormSchema = z
  .object({
    intent: z.literal("prepare_native_dwg_import"),
    revision_id: Uuid,
    canvas_id: Uuid,
    job_id: Uuid,
  })
  .strict();
const NativeFormSchema = z.discriminatedUnion("intent", [
  RequestFormSchema,
  StatusFormSchema,
  PrepareFormSchema,
]);
const VerifiedDwgSchema = z
  .object({
    id: Uuid,
    project_id: Uuid,
    kind: z.literal("dwg"),
    sha256: Sha256,
    immutable: z.literal(true),
  })
  .strict();
const NativeContextSchema = z
  .object({
    scope: NativeDrawingDwgImportScopeSchema,
    status: NativeDrawingDwgImportStatusSchema,
    result: z.null(),
  })
  .strict();

export type DrawingNativeDwgImportForm =
  | {
      intent: "request_native_dwg_import";
      revisionId: string;
      canvasId: string;
      sourceFileId: string;
      requestId: string;
      unitOverride: 1 | 2 | 4 | 5 | 6 | null;
    }
  | {
      intent: "native_dwg_import_status" | "prepare_native_dwg_import";
      revisionId: string;
      canvasId: string;
      jobId: string;
    };

export class DrawingNativeDwgImportActionError extends Error {
  readonly status: 400 | 403 | 409 | 503;

  constructor(message: string, status: 400 | 403 | 409 | 503) {
    super(message);
    this.name = "DrawingNativeDwgImportActionError";
    this.status = status;
  }
}

function actionError(message: string, status: 400 | 403 | 409 | 503) {
  return new DrawingNativeDwgImportActionError(message, status);
}

function normalizeNativeError(error: unknown): never {
  if (error instanceof DrawingNativeDwgImportActionError) throw error;
  if (error instanceof NativeDrawingDwgImportJobError)
    throw actionError(
      "Native DWG import service rejected the request.",
      error.kind === "invalid"
        ? 400
        : error.kind === "conflict" || error.kind === "stale"
          ? 409
          : 503,
    );
  if (error instanceof DrawingNativeDwgImportSourceError)
    throw actionError(error.message, error.status);
  throw error;
}

export function parseDrawingNativeDwgImportForm(
  form: FormData,
): DrawingNativeDwgImportForm {
  const entries = [...form.entries()];
  if (entries.some(([, value]) => typeof value !== "string"))
    throw actionError("Native DWG import request is invalid.", 400);
  if (new Set(entries.map(([name]) => name)).size !== entries.length)
    throw actionError("Native DWG import request is invalid.", 400);
  const parsed = NativeFormSchema.safeParse(Object.fromEntries(entries));
  if (!parsed.success)
    throw actionError("Native DWG import request is invalid.", 400);
  const value = parsed.data;
  if (value.intent === "request_native_dwg_import")
    return {
      intent: value.intent,
      revisionId: value.revision_id,
      canvasId: value.canvas_id,
      sourceFileId: value.source_file_id,
      requestId: value.request_id,
      unitOverride:
        value.unit_code === ""
          ? null
          : (Number(value.unit_code) as 1 | 2 | 4 | 5 | 6),
    };
  return {
    intent: value.intent,
    revisionId: value.revision_id,
    canvasId: value.canvas_id,
    jobId: value.job_id,
  };
}

function currentCanvasIds(workspace: DrawingWorkspace) {
  const revision = workspace.document.revision;
  return new Set([
    ...(revision.canvases ?? []).map((canvas) => canvas.id),
    ...revision.pages.flatMap((page) =>
      "canvases" in page ? page.canvases.map((canvas) => canvas.id) : [],
    ),
  ]);
}

function assertCurrentEditableScope(
  capability: DrawingWorkspaceCapability,
  projectId: string,
  workspace: DrawingWorkspace,
  mutation: DrawingNativeDwgImportForm,
) {
  if (capability !== "admin" && capability !== "editor")
    throw actionError("Native DWG import is not permitted.", 403);
  const revision = workspace.document.revision;
  if (revision.status === "approved" || revision.status === "superseded")
    throw actionError("Approved drawing revisions cannot be changed.", 409);
  if (revision.status !== "draft")
    throw actionError("Native DWG import requires a draft revision.", 409);
  if (
    workspace.document.project_id !== projectId ||
    revision.project_id !== projectId ||
    revision.document_id !== workspace.document.id ||
    mutation.revisionId !== revision.id ||
    !currentCanvasIds(workspace).has(mutation.canvasId)
  )
    throw actionError("Native DWG import target is not current.", 409);
  return revision;
}

function dynamicNativeRpcClient(
  client: DrawingWorkspaceClient,
): NativeDrawingDwgImportRpcClient {
  return {
    rpc(name, args) {
      const builder = Reflect.apply(client.rpc, client, [name, args]) as {
        abortSignal?: unknown;
      };
      if (!builder || typeof builder.abortSignal !== "function")
        throw actionError("Native DWG import service is unavailable.", 503);
      return builder as ReturnType<NativeDrawingDwgImportRpcClient["rpc"]>;
    },
  };
}

async function callDynamicRpc(
  client: DrawingWorkspaceClient,
  name: string,
  args: Record<string, unknown>,
) {
  let response: unknown;
  try {
    response = await Reflect.apply(client.rpc, client, [name, args]);
  } catch {
    throw actionError("Native DWG import service is unavailable.", 503);
  }
  if (
    typeof response !== "object" ||
    response === null ||
    !("data" in response) ||
    !("error" in response) ||
    response.error
  )
    throw actionError("Native DWG import service is unavailable.", 503);
  return response.data;
}

async function loadVerifiedDwg(
  client: DrawingWorkspaceClient,
  projectId: string,
  sourceFileId: string,
) {
  const { data, error } = await client
    .from("lukas_qto_files")
    .select("id,project_id,kind,sha256,immutable")
    .eq("id", sourceFileId)
    .eq("project_id", projectId)
    .eq("kind", "dwg")
    .eq("immutable", true)
    .maybeSingle();
  if (error)
    throw actionError("Native DWG source verification is unavailable.", 503);
  const parsed = VerifiedDwgSchema.safeParse(data);
  if (
    !parsed.success ||
    parsed.data.id !== sourceFileId ||
    parsed.data.project_id !== projectId
  )
    throw actionError("Verified native DWG source is unavailable.", 409);
  return parsed.data;
}

type ActionDependencies = {
  requestImport: (
    client: NativeDrawingDwgImportRpcClient,
    scope: NativeDrawingDwgImportScope,
    requestId: string,
  ) => Promise<{ jobId: string }>;
  prepareImport: (
    client: DrawingWorkspaceClient,
    input: {
      projectId: string;
      revisionId: string;
      canvasId: string;
      jobId: string;
      actorId: string;
    },
  ) => Promise<PreparedNativeDrawingDwgProjectImport>;
};

const defaultDependencies: ActionDependencies = {
  requestImport: requestNativeDrawingDwgImport,
  prepareImport: (client, input) =>
    Reflect.apply(prepareNativeDrawingDwgProjectImport, undefined, [
      client,
      input,
    ]) as Promise<PreparedNativeDrawingDwgProjectImport>,
};

export async function handleDrawingNativeDwgImportAction(
  {
    actorId,
    capability,
    client,
    form,
    projectId,
    workspace,
  }: {
    actorId: string;
    capability: DrawingWorkspaceCapability;
    client: DrawingWorkspaceClient;
    form: FormData;
    projectId: string;
    workspace: DrawingWorkspace;
  },
  dependencies: Partial<ActionDependencies> = {},
) {
  const mutation = parseDrawingNativeDwgImportForm(form);
  assertCurrentEditableScope(capability, projectId, workspace, mutation);
  const runtime = { ...defaultDependencies, ...dependencies };

  if (mutation.intent === "request_native_dwg_import") {
    const source = await loadVerifiedDwg(
      client,
      projectId,
      mutation.sourceFileId,
    );
    const scope = NativeDrawingDwgImportScopeSchema.parse({
      projectId,
      documentId: workspace.document.id,
      revisionId: mutation.revisionId,
      canvasId: mutation.canvasId,
      sourceFileId: source.id,
      sourceSha256: source.sha256,
      unitOverride: mutation.unitOverride,
    });
    let result: { jobId: string };
    try {
      result = await runtime.requestImport(
        dynamicNativeRpcClient(client),
        scope,
        mutation.requestId,
      );
    } catch (error) {
      normalizeNativeError(error);
    }
    return {
      ok: true as const,
      kind: "native_dwg_import_requested" as const,
      error: null,
      result,
    };
  }

  if (mutation.intent === "native_dwg_import_status") {
    const parsedContext = NativeContextSchema.safeParse(
      await callDynamicRpc(client, "lukas_drawing_native_dwg_import_context", {
        p_job_id: mutation.jobId,
        p_include_result: false,
      }),
    );
    if (!parsedContext.success)
      throw actionError("Native DWG import status is invalid.", 503);
    const context = parsedContext.data;
    if (
      context.scope.projectId !== projectId ||
      context.scope.documentId !== workspace.document.id ||
      context.scope.revisionId !== mutation.revisionId ||
      context.scope.canvasId !== mutation.canvasId ||
      context.status.jobId !== mutation.jobId
    )
      throw actionError("Native DWG import status target is not current.", 409);
    return {
      ok: true as const,
      kind: "native_dwg_import_status" as const,
      error: null,
      result: context.status,
    };
  }

  let result: PreparedNativeDrawingDwgProjectImport;
  try {
    result = await runtime.prepareImport(client, {
      projectId,
      revisionId: mutation.revisionId,
      canvasId: mutation.canvasId,
      jobId: mutation.jobId,
      actorId,
    });
  } catch (error) {
    normalizeNativeError(error);
  }
  return {
    ok: true as const,
    kind: "native_dwg_import_prepared" as const,
    error: null,
    result,
  };
}
