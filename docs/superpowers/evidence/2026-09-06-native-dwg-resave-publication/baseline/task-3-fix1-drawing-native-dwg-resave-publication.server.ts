import { createHash } from "node:crypto";

import { z } from "zod";

import type { NativeDrawingDwgImportRpcClient } from "./drawing-native-dwg-import-jobs.server.ts";
import { parseNativeDrawingDwgResaveClaim } from "./drawing-native-dwg-resave-jobs.server.ts";
import {
  buildNativeDrawingDwgResaveArtifacts,
  validateNativeDrawingDwgResaveReceipt,
  validateNativeDrawingDwgResaveStagedArtifacts,
} from "./drawing-native-dwg-resave-artifacts.server.ts";
import {
  callNativeDrawingDwgResaveAttemptRpc,
  NativeDrawingDwgResaveStaleLease,
  readNativeDrawingDwgResaveAttemptControl,
  runNativeDrawingDwgResaveAttempt,
  type NativeDrawingDwgResaveAttemptOptions,
  type NativeDrawingDwgResaveAttemptOutcome,
} from "./drawing-native-dwg-resave-worker.server.ts";
import {
  createNativeDwgResaveStorageTransport,
  NativeDwgConfirmedUploadError,
} from "../../../native-dwg-worker/src/supabase.ts";

type Claim = ReturnType<typeof parseNativeDrawingDwgResaveClaim>;
type Prepared = Extract<
  NativeDrawingDwgResaveAttemptOutcome,
  { outcome: "prepared" }
>;
type Storage = ReturnType<typeof createNativeDwgResaveStorageTransport>;
type Refusal =
  | "cancel"
  | "authority_revoked"
  | "stale"
  | "control_uncertain"
  | "worker_interrupted";
type PublicationFailure =
  | "output_invalid"
  | "upload_failed"
  | "publication_failed"
  | "authority_revoked"
  | "worker_interrupted";
type NonPrepared = Exclude<
  NativeDrawingDwgResaveAttemptOutcome,
  { outcome: "prepared" }
>;
export type NativeDrawingDwgResavePublicationOutcome =
  | NonPrepared
  | {
      outcome: "completed";
      receipt: ReturnType<typeof validateNativeDrawingDwgResaveReceipt>;
    }
  | { outcome: "publication_uncertain" };

const Identity = z
  .object({
    jobId: z.string().uuid(),
    attemptNumber: z.number().int().min(1).max(3),
    leaseToken: z.string().uuid(),
  })
  .strict();
const Closed = Identity.extend({ uploadState: z.literal("closed") }).strict();
const Cancellation = Identity.extend({
  status: z.literal("cancelled"),
}).strict();
const Failure = Identity.extend({
  status: z.enum(["retry_wait", "failed"]),
}).strict();

function identityArguments(claim: Claim) {
  return {
    p_job_id: claim.jobId,
    p_attempt_number: claim.attemptNumber,
    p_lease_token: claim.leaseToken,
  };
}

function requireIdentity(receipt: z.infer<typeof Identity>, claim: Claim) {
  if (
    receipt.jobId !== claim.jobId ||
    receipt.attemptNumber !== claim.attemptNumber ||
    receipt.leaseToken !== claim.leaseToken
  )
    throw new Error("Native DWG resave attempt identity changed.");
}

async function closeUpload(
  serviceClient: NativeDrawingDwgImportRpcClient,
  claim: Claim,
) {
  try {
    const receipt = Closed.parse(
      await callNativeDrawingDwgResaveAttemptRpc(
        serviceClient,
        "lukas_drawing_close_native_dwg_resave_upload",
        identityArguments(claim),
      ),
    );
    requireIdentity(receipt, claim);
    return true;
  } catch {
    return false;
  }
}

async function settleClosedAttempt(
  serviceClient: NativeDrawingDwgImportRpcClient,
  claim: Claim,
  refusal: Refusal | undefined,
  failure: PublicationFailure | undefined,
): Promise<NonPrepared | undefined> {
  if (refusal === "stale" || refusal === "control_uncertain")
    return { outcome: refusal };
  const args = identityArguments(claim);
  if (refusal === "cancel") {
    try {
      const receipt = Cancellation.parse(
        await callNativeDrawingDwgResaveAttemptRpc(
          serviceClient,
          "lukas_drawing_ack_native_dwg_resave_cancel",
          args,
        ),
      );
      requireIdentity(receipt, claim);
      return { outcome: "cancelled" };
    } catch (error) {
      return {
        outcome:
          error instanceof NativeDrawingDwgResaveStaleLease
            ? "stale"
            : "control_uncertain",
      };
    }
  }
  const code =
    refusal === "worker_interrupted" || refusal === "authority_revoked"
      ? refusal
      : failure;
  if (!code) return undefined;
  const retryable = [
    "upload_failed",
    "publication_failed",
    "worker_interrupted",
  ].includes(code);
  try {
    const receipt = Failure.parse(
      await callNativeDrawingDwgResaveAttemptRpc(
        serviceClient,
        "lukas_drawing_fail_native_dwg_resave",
        { ...args, p_failure_code: code, p_retryable: retryable },
      ),
    );
    requireIdentity(receipt, claim);
    if (!retryable && receipt.status === "retry_wait")
      throw new Error("Invalid failure settlement.");
    return {
      outcome: receipt.status === "retry_wait" ? "retry_scheduled" : "failed",
    };
  } catch (error) {
    return {
      outcome:
        error instanceof NativeDrawingDwgResaveStaleLease
          ? "stale"
          : "settlement_uncertain",
    };
  }
}

export async function publishNativeDrawingDwgResaveArtifacts(options: {
  prepared: Prepared;
  serviceClient: NativeDrawingDwgImportRpcClient;
  storage: Storage;
  imageId: string;
  signal?: AbortSignal;
}): Promise<NativeDrawingDwgResavePublicationOutcome> {
  const { prepared, serviceClient, storage, imageId, signal } = options;
  const upload = storage.upload.bind(storage);
  const read = storage.read.bind(storage);
  let claim: Claim;
  try {
    claim = parseNativeDrawingDwgResaveClaim(prepared.claim, imageId);
  } catch {
    return { outcome: "control_uncertain" };
  }

  const execution = new AbortController();
  let refusal: Refusal | undefined;
  const stop = (reason: Refusal) => {
    refusal ??= reason;
    execution.abort();
  };
  const shutdown = () => stop("worker_interrupted");
  signal?.addEventListener("abort", shutdown, { once: true });
  if (signal?.aborted) shutdown();

  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let pollPending: Promise<void> | undefined;
  let polling = false;
  let pollingStopped = false;
  const check = async () => {
    try {
      const control = await readNativeDrawingDwgResaveAttemptControl(
        serviceClient,
        claim,
      );
      if (control.action === "cancel") stop("cancel");
      if (control.action === "stop")
        stop(
          control.reason === "lease_expired" ? "stale" : "authority_revoked",
        );
    } catch (error) {
      stop(
        error instanceof NativeDrawingDwgResaveStaleLease
          ? "stale"
          : "control_uncertain",
      );
    }
  };
  const schedule = () => {
    if (!polling || refusal) return;
    pollTimer = setTimeout(() => {
      pollPending = check().finally(() => {
        pollPending = undefined;
        schedule();
      });
    }, 1_000);
  };
  const stopPolling = async () => {
    if (pollingStopped) return;
    pollingStopped = true;
    polling = false;
    clearTimeout(pollTimer);
    await pollPending;
  };

  const finishClosed = async (
    failure?: PublicationFailure,
  ): Promise<NativeDrawingDwgResavePublicationOutcome> => {
    await stopPolling();
    if (!refusal) await check();
    const settled = await settleClosedAttempt(
      serviceClient,
      claim,
      refusal,
      failure,
    );
    if (settled) return settled;
    signal?.removeEventListener("abort", shutdown);
    const args = identityArguments(claim);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const receipt = validateNativeDrawingDwgResaveReceipt(
          await callNativeDrawingDwgResaveAttemptRpc(
            serviceClient,
            "lukas_drawing_publish_native_dwg_resave",
            args,
          ),
          claim,
          built!.metadata,
        );
        return { outcome: "completed", receipt };
      } catch (error) {
        if (error instanceof NativeDrawingDwgResaveStaleLease)
          return { outcome: "stale" };
      }
    }
    return { outcome: "publication_uncertain" };
  };

  let built:
    | Awaited<ReturnType<typeof buildNativeDrawingDwgResaveArtifacts>>
    | undefined;
  let failure: PublicationFailure | undefined;
  try {
    try {
      built = await buildNativeDrawingDwgResaveArtifacts(
        claim,
        prepared.result,
        imageId,
      );
      claim = built.claim;
    } catch {
      failure = "output_invalid";
    }
    await check();
    if (failure || refusal) {
      return (
        (await settleClosedAttempt(serviceClient, claim, refusal, failure)) ?? {
          outcome: "control_uncertain",
        }
      );
    }

    polling = true;
    schedule();
    let staged: ReturnType<
      typeof validateNativeDrawingDwgResaveStagedArtifacts
    >;
    try {
      staged = validateNativeDrawingDwgResaveStagedArtifacts(
        await callNativeDrawingDwgResaveAttemptRpc(
          serviceClient,
          "lukas_drawing_stage_native_dwg_resave",
          {
            ...identityArguments(claim),
            p_artifacts: built!.metadata,
          },
        ),
        claim,
        built!.metadata,
      );
    } catch {
      if (!(await closeUpload(serviceClient, claim)))
        return { outcome: "settlement_uncertain" };
      return await finishClosed("publication_failed");
    }

    for (const artifact of staged.artifacts) {
      if (refusal) break;
      if (staged.uploadState === "open") {
        try {
          const status = await upload({
            kind: artifact.kind,
            path: artifact.path,
            bytes: built!.bytesByKind[artifact.kind],
            signal: execution.signal,
          });
          if (status !== "uploaded" && status !== "exists")
            return { outcome: "settlement_uncertain" };
        } catch (error) {
          if (!(error instanceof NativeDwgConfirmedUploadError))
            return { outcome: "settlement_uncertain" };
          failure = "upload_failed";
          break;
        }
        if (refusal) break;
      }
      try {
        const bytes = await read({
          kind: artifact.kind,
          path: artifact.path,
          signal: execution.signal,
        });
        if (
          !(bytes instanceof Uint8Array) ||
          bytes.byteLength !== artifact.byteSize ||
          createHash("sha256").update(bytes).digest("hex") !==
            artifact.sha256 ||
          !Buffer.from(bytes).equals(built!.bytesByKind[artifact.kind])
        )
          throw new Error("Native DWG resave readback changed.");
      } catch {
        failure = "output_invalid";
        break;
      }
    }

    if (
      staged.uploadState === "open" &&
      !(await closeUpload(serviceClient, claim))
    )
      return { outcome: "settlement_uncertain" };
    return await finishClosed(failure);
  } finally {
    await stopPolling();
    signal?.removeEventListener("abort", shutdown);
  }
}

export async function runNativeDrawingDwgResaveToStorage(
  options: NativeDrawingDwgResaveAttemptOptions & { storage: Storage },
): Promise<NativeDrawingDwgResavePublicationOutcome> {
  const { storage, ...attemptOptions } = options;
  const capturedStorage = {
    upload: storage.upload.bind(storage),
    read: storage.read.bind(storage),
  };
  const { serviceClient, imageId, signal } = attemptOptions;
  const result = await runNativeDrawingDwgResaveAttempt(attemptOptions);
  if (result.outcome !== "prepared") return result;
  return publishNativeDrawingDwgResaveArtifacts({
    prepared: result,
    serviceClient,
    storage: capturedStorage,
    imageId,
    signal,
  });
}
