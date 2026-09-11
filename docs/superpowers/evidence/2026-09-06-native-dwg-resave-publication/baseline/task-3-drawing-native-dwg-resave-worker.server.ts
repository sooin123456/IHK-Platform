import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import { type NativeDrawingDwgImportRpcClient } from "./drawing-native-dwg-import-jobs.server.ts";
import { buildNativeDrawingDwgResaveAttestation } from "./drawing-native-dwg-resave-attestation.server.ts";
import { parseNativeDrawingDwgResaveClaim } from "./drawing-native-dwg-resave-jobs.server.ts";
import {
  decodeNativeDrawingDwgResaveOutput,
  encodeNativeDrawingDwgResaveInput,
} from "./drawing-native-dwg-resave-protocol.server.ts";
import {
  NativeDrawingDwgResaveSandboxError,
  runIsolatedNativeDrawingDwgResaver,
} from "./drawing-native-dwg-sandbox.server.ts";

type Claim = ReturnType<typeof parseNativeDrawingDwgResaveClaim>;
type NativeResult = Awaited<
  ReturnType<typeof runIsolatedNativeDrawingDwgResaver>
>;
type FailureCode =
  | "source_unavailable"
  | "source_mismatch"
  | "resaver_failed"
  | "output_invalid"
  | "worker_interrupted"
  | "authority_revoked";
type Stop =
  | "cancel"
  | "authority_revoked"
  | "stale"
  | "control_uncertain"
  | "worker_interrupted";
export type NativeDrawingDwgResaveAttemptOutcome =
  | { outcome: "prepared"; claim: Claim; result: NativeResult }
  | {
      outcome:
        | "cancelled"
        | "retry_scheduled"
        | "failed"
        | "stale"
        | "control_uncertain"
        | "settlement_uncertain";
    };
export type NativeDrawingDwgResaveAttemptOptions = {
  claim: unknown;
  serviceClient: NativeDrawingDwgImportRpcClient;
  downloadSource(input: {
    source: Claim["source"];
    signal: AbortSignal;
  }): Promise<Uint8Array>;
  resave?: typeof runIsolatedNativeDrawingDwgResaver;
  dockerPath: string;
  dockerHost: string;
  imageId: string;
  signal?: AbortSignal;
};

const Identity = z.object({
  jobId: z.string().uuid(),
  attemptNumber: z.number().int().min(1).max(3),
  leaseToken: z.string().uuid(),
});
const Control = z.discriminatedUnion("action", [
  Identity.extend({ action: z.literal("continue"), reason: z.null() }).strict(),
  Identity.extend({
    action: z.literal("cancel"),
    reason: z.literal("cancel_requested"),
  }).strict(),
  Identity.extend({
    action: z.literal("stop"),
    reason: z.enum(["authority_revoked", "lease_expired"]),
  }).strict(),
]);
const Cancellation = Identity.extend({
  status: z.literal("cancelled"),
}).strict();
const Failure = Identity.extend({
  status: z.enum(["retry_wait", "failed"]),
}).strict();
class StaleLease extends Error {}

/** A separate deadline bounds even a service transport which ignores abort. */
async function rpc(
  client: NativeDrawingDwgImportRpcClient,
  name: string,
  args: Record<string, unknown>,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Native DWG resave control unavailable."));
    }, 5_000);
  });
  try {
    const response = await Promise.race([
      Promise.resolve().then(() =>
        client.rpc(name, args).abortSignal(controller.signal),
      ),
      deadline,
    ]);
    if (!response || controller.signal.aborted || response.error !== null) {
      if (
        response?.error &&
        typeof response.error === "object" &&
        "code" in response.error &&
        response.error.code === "PNR13"
      )
        throw new StaleLease();
      throw new Error("Native DWG resave control unavailable.");
    }
    return response.data;
  } finally {
    clearTimeout(timer);
  }
}

function requireIdentity(receipt: z.infer<typeof Identity>, claim: Claim) {
  if (
    receipt.jobId !== claim.jobId ||
    receipt.attemptNumber !== claim.attemptNumber ||
    receipt.leaseToken !== claim.leaseToken
  )
    throw new Error("Native DWG resave attempt identity changed.");
}

/** Snapshot before control awaits, then reuse the protocol's exact-byte verifier. */
function snapshotResult(
  result: NativeResult,
  expected: ReturnType<typeof encodeNativeDrawingDwgResaveInput>,
): NativeResult {
  if (
    !(result.reportBytes instanceof Uint8Array) ||
    !(result.dwgBytes instanceof Uint8Array) ||
    result.reportBytes.byteLength < 1 ||
    result.reportBytes.byteLength > 1024 * 1024 ||
    result.dwgBytes.byteLength < 6 ||
    result.dwgBytes.byteLength > 200 * 1024 * 1024
  )
    throw new Error("Invalid native DWG resave output.");
  const header = Buffer.alloc(16);
  header.write("1HKRSO01", 0, "ascii");
  header.writeUInt32BE(result.reportBytes.byteLength, 8);
  header.writeUInt32BE(result.dwgBytes.byteLength, 12);
  const verified = decodeNativeDrawingDwgResaveOutput(
    Buffer.concat([header, result.reportBytes, result.dwgBytes]),
    expected,
  );
  if (!isDeepStrictEqual(verified.report, result.report))
    throw new Error("Invalid native DWG resave report identity.");
  return verified;
}

/** Internal execution only: no admission retry, publication RPC or output receipt. */
export async function runNativeDrawingDwgResaveAttempt(
  options: NativeDrawingDwgResaveAttemptOptions,
): Promise<NativeDrawingDwgResaveAttemptOutcome> {
  const {
    imageId,
    dockerPath,
    dockerHost,
    serviceClient,
    downloadSource,
    signal,
  } = options;
  const resave = options.resave ?? runIsolatedNativeDrawingDwgResaver;
  let claim: Claim;
  try {
    claim = parseNativeDrawingDwgResaveClaim(options.claim, imageId);
  } catch {
    // A malformed claim supplies no trusted identity with which to settle work.
    return { outcome: "control_uncertain" };
  }
  const args = {
    p_job_id: claim.jobId,
    p_attempt_number: claim.attemptNumber,
    p_lease_token: claim.leaseToken,
  };
  const execution = new AbortController();
  let refusal: Stop | undefined;
  const stop = (reason: Stop) => {
    refusal ??= reason;
    execution.abort();
  };
  const shutdown = () => stop("worker_interrupted");
  signal?.addEventListener("abort", shutdown, { once: true });
  if (signal?.aborted) shutdown();
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let pollPending: Promise<void> | undefined;
  let polling = false;
  const check = async () => {
    try {
      const control = Control.parse(
        await rpc(
          serviceClient,
          "lukas_drawing_native_dwg_resave_control",
          args,
        ),
      );
      requireIdentity(control, claim);
      if (control.action === "cancel") stop("cancel");
      if (control.action === "stop")
        stop(
          control.reason === "lease_expired" ? "stale" : "authority_revoked",
        );
    } catch (error) {
      stop(error instanceof StaleLease ? "stale" : "control_uncertain");
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
    polling = false;
    clearTimeout(pollTimer);
    await pollPending;
  };
  let nativeCleanupConfirmed = true;
  let failure: FailureCode | undefined;
  let result: NativeResult | undefined;
  let postNativeChecked = false;
  try {
    await check();
    if (!refusal) {
      polling = true;
      schedule();
      failure = "authority_revoked";
      const rebuilt = await buildNativeDrawingDwgResaveAttestation(
        claim.scope,
        claim.payload,
        imageId,
      );
      if (!isDeepStrictEqual(rebuilt, claim.attestation) || !rebuilt.request)
        throw new Error("Attestation changed.");
      if (!refusal) {
        failure = "source_unavailable";
        const bytes = await downloadSource({
          source: claim.source,
          signal: execution.signal,
        });
        if (!refusal) {
          failure = "source_mismatch";
          const expectedSource = {
            sha256: claim.source.sha256,
            byteSize: claim.source.byteSize,
            headerVersion: claim.source.headerVersion,
          };
          const encoded = encodeNativeDrawingDwgResaveInput({
            sourceBytes: bytes,
            expectedSource,
            requestBytes: Buffer.from(rebuilt.request.text, "utf8"),
            expectedRequestSha256: rebuilt.request.sha256,
          });
          failure = "resaver_failed";
          nativeCleanupConfirmed = false;
          let native: NativeResult;
          try {
            native = await resave({
              dockerPath,
              dockerHost,
              imageId,
              sourceBytes: encoded.chunks[2],
              expectedSource,
              requestBytes: encoded.chunks[1],
              expectedRequestSha256: rebuilt.request.sha256,
              signal: execution.signal,
              timeoutMilliseconds: 120_000,
            });
            nativeCleanupConfirmed = true;
          } catch (error) {
            nativeCleanupConfirmed =
              error instanceof NativeDrawingDwgResaveSandboxError &&
              error.cleanupConfirmed === true;
            throw error;
          }
          failure = "output_invalid";
          result = snapshotResult(native, encoded);
          failure = undefined;
          postNativeChecked = true;
          await check();
        }
      }
    }
  } catch {
    // Failure classification follows the actual stage, with cleanup evidence
    // kept separate from rejection/abort and live control decisions.
  } finally {
    // Never race the native/source promise: the above await must settle first.
    await stopPolling();
    if (!refusal && !postNativeChecked) await check();
    signal?.removeEventListener("abort", shutdown);
  }

  if (!nativeCleanupConfirmed)
    return {
      outcome:
        refusal === "cancel" || refusal === "control_uncertain"
          ? "control_uncertain"
          : "settlement_uncertain",
    };
  if (refusal === "stale" || refusal === "control_uncertain")
    return { outcome: refusal };
  if (refusal === "cancel") {
    try {
      const receipt = Cancellation.parse(
        await rpc(
          serviceClient,
          "lukas_drawing_ack_native_dwg_resave_cancel",
          args,
        ),
      );
      requireIdentity(receipt, claim);
      return { outcome: "cancelled" };
    } catch (error) {
      return {
        outcome: error instanceof StaleLease ? "stale" : "control_uncertain",
      };
    }
  }
  if (refusal === "worker_interrupted" || refusal === "authority_revoked")
    failure = refusal;
  if (failure) {
    try {
      const retryable = [
        "source_unavailable",
        "resaver_failed",
        "worker_interrupted",
      ].includes(failure);
      const receipt = Failure.parse(
        await rpc(serviceClient, "lukas_drawing_fail_native_dwg_resave", {
          ...args,
          p_failure_code: failure,
          p_retryable: retryable,
        }),
      );
      requireIdentity(receipt, claim);
      if (!retryable && receipt.status === "retry_wait")
        throw new Error("Invalid failure settlement.");
      return {
        outcome: receipt.status === "retry_wait" ? "retry_scheduled" : "failed",
      };
    } catch (error) {
      return {
        outcome: error instanceof StaleLease ? "stale" : "settlement_uncertain",
      };
    }
  }
  return result
    ? { outcome: "prepared", claim, result }
    : { outcome: "control_uncertain" };
}
