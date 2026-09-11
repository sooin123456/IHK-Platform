import { createHash } from "node:crypto";

import { NativeDrawingDwgImportReportSchema } from "./drawing-native-dwg-import.server.ts";
import {
  NATIVE_DRAWING_DWG_IMPORT_LIMITS,
  NativeDrawingDwgImportClaimSchema,
  NativeDrawingDwgImportFailureReceiptSchema,
  NativeDrawingDwgImportReceiptSchema,
  type NativeDrawingDwgImportClaim,
  type NativeDrawingDwgImportFailureCode,
  type NativeDrawingDwgImportFailureReceipt,
  type NativeDrawingDwgImportReceipt,
} from "./drawing-native-dwg-import-jobs.server.ts";

export class NativeDrawingDwgImportStaleLeaseError extends Error {
  constructor() {
    super("Native DWG import lease is stale.");
    this.name = "NativeDrawingDwgImportStaleLeaseError";
  }
}

export class NativeDrawingDwgImportCompletionUncertainError extends Error {
  constructor() {
    super("Native DWG import completion is uncertain.");
    this.name = "NativeDrawingDwgImportCompletionUncertainError";
  }
}

export class NativeDrawingDwgImportPublicationRejectedError extends Error {
  constructor() {
    super("Native DWG import report evidence was rejected.");
    this.name = "NativeDrawingDwgImportPublicationRejectedError";
  }
}

export type NativeDrawingDwgImportWorkerDependencies = {
  claim(input: {
    signal: AbortSignal;
  }): Promise<NativeDrawingDwgImportClaim | null>;
  downloadSource(input: {
    source: NativeDrawingDwgImportClaim["source"];
    signal: AbortSignal;
  }): Promise<Uint8Array>;
  readSource(input: {
    sourceBytes: Uint8Array;
    expectedSource: {
      sha256: string;
      byteSize: number;
      headerVersion: string;
    };
    readerImageId: string;
    timeoutMilliseconds: number;
    signal: AbortSignal;
  }): Promise<unknown>;
  complete(input: {
    jobId: string;
    attemptNumber: number;
    leaseToken: string;
    readerImageId: string;
    reportText: string;
    reportSha256: string;
    signal: AbortSignal;
  }): Promise<NativeDrawingDwgImportReceipt>;
  fail(input: {
    jobId: string;
    attemptNumber: number;
    leaseToken: string;
    failureCode: NativeDrawingDwgImportFailureCode;
    retryable: boolean;
    signal: AbortSignal;
  }): Promise<NativeDrawingDwgImportFailureReceipt>;
};

export type NativeDrawingDwgImportWorkerOutcome =
  | "idle"
  | "analyzed"
  | "retry_scheduled"
  | "failed"
  | "stale"
  | "publication_uncertain";

function sha256(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactSource(
  actual: { sha256: string; byteSize: number; headerVersion: string },
  expected: { sha256: string; byteSize: number; headerVersion: string },
) {
  return (
    actual.sha256 === expected.sha256 &&
    actual.byteSize === expected.byteSize &&
    actual.headerVersion === expected.headerVersion
  );
}

function boundedSignal(milliseconds: number, parent?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, Math.max(0, milliseconds));
  timer.unref?.();
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}

function validReceipt(
  raw: unknown,
  expected: {
    claim: NativeDrawingDwgImportClaim;
    reportSha256: string;
    reportByteSize: number;
  },
) {
  const parsed = NativeDrawingDwgImportReceiptSchema.safeParse(raw);
  if (!parsed.success) return null;
  const receipt = parsed.data;
  const { claim } = expected;
  if (
    receipt.jobId !== claim.jobId ||
    receipt.attemptNumber !== claim.attemptNumber ||
    receipt.readerImageId !== claim.readerImageId ||
    receipt.reportSha256 !== expected.reportSha256 ||
    receipt.reportByteSize !== expected.reportByteSize ||
    receipt.source.verificationId !== claim.source.verificationId ||
    receipt.source.fileId !== claim.source.fileId ||
    !exactSource(receipt.source, claim.source)
  )
    return null;
  return receipt;
}

/**
 * Runs one claimed analysis attempt. All validation, hashing and publication
 * identity remain here; dependencies are only RPC, byte transport and the
 * isolated native reader boundary.
 */
export async function runNativeDrawingDwgImportWorkerOnce(
  dependencies: NativeDrawingDwgImportWorkerDependencies,
  options: { signal?: AbortSignal } = {},
): Promise<NativeDrawingDwgImportWorkerOutcome> {
  if (
    !dependencies ||
    typeof dependencies.claim !== "function" ||
    typeof dependencies.downloadSource !== "function" ||
    typeof dependencies.readSource !== "function" ||
    typeof dependencies.complete !== "function" ||
    typeof dependencies.fail !== "function"
  )
    throw new Error("Native DWG import worker dependencies are invalid.");

  const claimScope = boundedSignal(
    NATIVE_DRAWING_DWG_IMPORT_LIMITS.rpcMilliseconds,
    options.signal,
  );
  let rawClaim: NativeDrawingDwgImportClaim | null;
  try {
    rawClaim = await dependencies.claim({ signal: claimScope.signal });
  } catch {
    throw new Error("Native DWG import claim failed.");
  } finally {
    claimScope.dispose();
  }
  if (rawClaim === null) return "idle";
  const parsedClaim = NativeDrawingDwgImportClaimSchema.safeParse(rawClaim);
  if (!parsedClaim.success)
    throw new Error("Native DWG import claim is invalid.");
  const claim = parsedClaim.data;
  const leaseExpiresAt = Date.parse(claim.leaseExpiresAt);
  const publicationDeadline =
    leaseExpiresAt -
    NATIVE_DRAWING_DWG_IMPORT_LIMITS.publicationMarginMilliseconds;

  const fail = async (
    failureCode: NativeDrawingDwgImportFailureCode,
    retryable: boolean,
  ): Promise<NativeDrawingDwgImportWorkerOutcome> => {
    const remaining = Math.min(
      NATIVE_DRAWING_DWG_IMPORT_LIMITS.failureMilliseconds,
      leaseExpiresAt - Date.now(),
    );
    if (remaining <= 0) return "stale";
    const failureScope = boundedSignal(remaining);
    try {
      let raw: NativeDrawingDwgImportFailureReceipt;
      try {
        raw = await dependencies.fail({
          jobId: claim.jobId,
          attemptNumber: claim.attemptNumber,
          leaseToken: claim.leaseToken,
          failureCode,
          retryable,
          signal: failureScope.signal,
        });
      } catch (error) {
        if (error instanceof NativeDrawingDwgImportStaleLeaseError)
          return "stale";
        throw new Error("Native DWG import failure acknowledgement failed.");
      }
      const receipt = NativeDrawingDwgImportFailureReceiptSchema.safeParse(raw);
      if (!receipt.success || receipt.data.jobId !== claim.jobId)
        throw new Error("Native DWG import failure acknowledgement failed.");
      return receipt.data.status === "retry_wait"
        ? "retry_scheduled"
        : "failed";
    } finally {
      failureScope.dispose();
    }
  };

  if (options.signal?.aborted || Date.now() >= publicationDeadline)
    return fail("worker_interrupted", true);

  const sourceOperationMilliseconds = Math.min(
    NATIVE_DRAWING_DWG_IMPORT_LIMITS.rpcMilliseconds,
    publicationDeadline - Date.now(),
  );
  if (sourceOperationMilliseconds <= 0) return fail("worker_interrupted", true);
  const sourceScope = boundedSignal(
    sourceOperationMilliseconds,
    options.signal,
  );
  let downloaded: Uint8Array;
  try {
    try {
      downloaded = await dependencies.downloadSource({
        source: claim.source,
        signal: sourceScope.signal,
      });
    } catch {
      return fail(
        options.signal?.aborted || sourceScope.signal.aborted
          ? "worker_interrupted"
          : "source_unavailable",
        true,
      );
    }
  } finally {
    sourceScope.dispose();
  }
  if (options.signal?.aborted) return fail("worker_interrupted", true);
  if (!(downloaded instanceof Uint8Array))
    return fail("source_mismatch", false);

  // Own the bytes before the first parser await. The dependency may retain and
  // mutate its buffer, while the isolated reader may only receive this snapshot.
  const sourceBytes = Buffer.from(downloaded);
  const expectedSource = {
    sha256: claim.source.sha256,
    byteSize: claim.source.byteSize,
    headerVersion: claim.source.headerVersion,
  };
  if (
    sourceBytes.byteLength !== expectedSource.byteSize ||
    sourceBytes.byteLength < 1 ||
    sourceBytes.byteLength > NATIVE_DRAWING_DWG_IMPORT_LIMITS.sourceBytes ||
    sha256(sourceBytes) !== expectedSource.sha256 ||
    !sourceBytes
      .subarray(0, 6)
      .equals(Buffer.from(expectedSource.headerVersion, "ascii"))
  )
    return fail("source_mismatch", false);

  const readerMilliseconds = Math.min(
    NATIVE_DRAWING_DWG_IMPORT_LIMITS.readerMilliseconds,
    Math.floor(
      publicationDeadline -
        Date.now() -
        NATIVE_DRAWING_DWG_IMPORT_LIMITS.readerCleanupMilliseconds,
    ),
  );
  if (readerMilliseconds < 1) return fail("worker_interrupted", true);
  const readerScope = boundedSignal(readerMilliseconds, options.signal);
  let rawReport: unknown;
  try {
    try {
      rawReport = await dependencies.readSource({
        sourceBytes,
        expectedSource,
        readerImageId: claim.readerImageId,
        timeoutMilliseconds: readerMilliseconds,
        signal: readerScope.signal,
      });
    } catch {
      return fail(
        options.signal?.aborted || readerScope.signal.aborted
          ? "worker_interrupted"
          : "reader_failed",
        true,
      );
    }
  } finally {
    readerScope.dispose();
  }
  if (options.signal?.aborted || Date.now() >= publicationDeadline)
    return fail("worker_interrupted", true);

  const parsedReport = NativeDrawingDwgImportReportSchema.safeParse(rawReport);
  if (
    !parsedReport.success ||
    !exactSource(parsedReport.data.source, expectedSource)
  )
    return fail("report_invalid", false);
  if (
    sourceBytes.byteLength !== expectedSource.byteSize ||
    sha256(sourceBytes) !== expectedSource.sha256 ||
    !sourceBytes
      .subarray(0, 6)
      .equals(Buffer.from(expectedSource.headerVersion, "ascii"))
  )
    return fail("source_mismatch", false);

  let reportText: string;
  try {
    reportText = JSON.stringify(parsedReport.data);
  } catch {
    return fail("report_invalid", false);
  }
  const reportByteSize = Buffer.byteLength(reportText, "utf8");
  if (
    reportByteSize < 1 ||
    reportByteSize > NATIVE_DRAWING_DWG_IMPORT_LIMITS.reportBytes
  )
    return fail("report_invalid", false);
  const reportSha256 = sha256(reportText);

  if (options.signal?.aborted || Date.now() >= publicationDeadline)
    return fail("worker_interrupted", true);
  const completionMilliseconds = leaseExpiresAt - Date.now();
  if (completionMilliseconds <= 0) return "stale";
  const completionScope = boundedSignal(completionMilliseconds, options.signal);
  try {
    let rawReceipt: NativeDrawingDwgImportReceipt;
    try {
      rawReceipt = await dependencies.complete({
        jobId: claim.jobId,
        attemptNumber: claim.attemptNumber,
        leaseToken: claim.leaseToken,
        readerImageId: claim.readerImageId,
        reportText,
        reportSha256,
        signal: completionScope.signal,
      });
    } catch (error) {
      if (error instanceof NativeDrawingDwgImportStaleLeaseError)
        return "stale";
      if (error instanceof NativeDrawingDwgImportPublicationRejectedError)
        return fail("report_invalid", false);
      // The completion request may have reached the database. Never retry it or
      // mutate the attempt after losing its exact acknowledgement.
      return "publication_uncertain";
    }
    return validReceipt(rawReceipt, {
      claim,
      reportSha256,
      reportByteSize,
    })
      ? "analyzed"
      : "publication_uncertain";
  } finally {
    completionScope.dispose();
  }
}
