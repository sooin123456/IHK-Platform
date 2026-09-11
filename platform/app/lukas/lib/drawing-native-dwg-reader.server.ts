import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import {
  NativeDrawingDwgImportReportSchema,
  NativeDrawingDwgSourceSchema,
  type NativeDrawingDwgImportReport,
} from "./drawing-native-dwg-import.server.ts";
import {
  calculateNativeDwgWriterBuildSha256,
  runNativeDwgProcess,
} from "./drawing-native-dwg-worker.server.ts";

const READER_MILLISECONDS = 120_000;
const PROCESS_OUTPUT_BYTES = 64 * 1024;
const REPORT_BYTES = 32 * 1024 * 1024;
const Sha256Schema = NativeDrawingDwgSourceSchema.shape.sha256;

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function scopedSignal(parent: AbortSignal | undefined) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, READER_MILLISECONDS);
  timeout.unref?.();
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", abort);
    },
  };
}

function exactNames(actual: string[], expected: string[]) {
  return (
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
  );
}

function exactSource(
  report: NativeDrawingDwgImportReport,
  expected: { sha256: string; byteSize: number; headerVersion: string },
) {
  return (
    report.source.sha256 === expected.sha256 &&
    report.source.byteSize === expected.byteSize &&
    report.source.headerVersion === expected.headerVersion
  );
}

/**
 * Runs the internal native reader against a private working copy. This boundary
 * validates bytes and build identity; it does not grant persistence authority.
 */
export async function runNativeDrawingDwgReader(input: {
  dotnetPath: string;
  publishedDirectory: string;
  sourceBytes: Uint8Array;
  expectedSource: unknown;
  expectedWriterBuildSha256: string;
  signal?: AbortSignal;
}): Promise<NativeDrawingDwgImportReport> {
  try {
    if (!(input.sourceBytes instanceof Uint8Array))
      throw new Error("invalid source bytes");
    const expectedSource = NativeDrawingDwgSourceSchema.parse(
      input.expectedSource,
    );
    if (
      input.sourceBytes.byteLength < 1 ||
      input.sourceBytes.byteLength > 200 * 1024 * 1024 ||
      input.sourceBytes.byteLength !== expectedSource.byteSize
    )
      throw new Error("invalid source byte size");
    const sourceSnapshot = Buffer.from(input.sourceBytes);
    const expectedBuild = Sha256Schema.parse(input.expectedWriterBuildSha256);
    if (
      sha256(sourceSnapshot) !== expectedSource.sha256 ||
      !sourceSnapshot
        .subarray(0, 6)
        .equals(Buffer.from(expectedSource.headerVersion, "ascii"))
    )
      throw new Error("source identity mismatch");
    if (!isAbsolute(input.dotnetPath) || !isAbsolute(input.publishedDirectory))
      throw new Error("invalid native reader configuration");

    const resolvedDotnetPath = await realpath(input.dotnetPath);
    const dotnetInformation = await lstat(resolvedDotnetPath);
    if (!isAbsolute(resolvedDotnetPath) || !dotnetInformation.isFile())
      throw new Error("invalid dotnet executable");
    const beforeBuild = await calculateNativeDwgWriterBuildSha256(
      input.publishedDirectory,
    );
    if (beforeBuild !== expectedBuild) throw new Error("reader build mismatch");

    const temporaryParent = await realpath(tmpdir());
    const temporaryParentInformation = await lstat(temporaryParent);
    if (
      !isAbsolute(temporaryParent) ||
      !temporaryParentInformation.isDirectory() ||
      temporaryParentInformation.isSymbolicLink() ||
      (await realpath(temporaryParent)) !== resolve(temporaryParent)
    )
      throw new Error("unsafe temporary parent");
    const prefix = join(temporaryParent, "1hk-native-dwg-reader-");
    let root: string | undefined;
    let rootIdentity: { device: bigint; inode: bigint } | undefined;
    try {
      root = await mkdtemp(prefix);
      if (
        !isAbsolute(root) ||
        dirname(root) !== temporaryParent ||
        !basename(root).startsWith("1hk-native-dwg-reader-")
      )
        throw new Error("unsafe temporary directory");
      const rootInformation = await lstat(root, { bigint: true });
      rootIdentity = {
        device: rootInformation.dev,
        inode: rootInformation.ino,
      };
      if (
        !rootInformation.isDirectory() ||
        rootInformation.isSymbolicLink() ||
        (await realpath(root)) !== resolve(root)
      )
        throw new Error("unsafe temporary directory");

      const sourcePath = join(root, "source.dwg");
      const outputDirectory = join(root, "output");
      await writeFile(sourcePath, sourceSnapshot, { flag: "wx", mode: 0o600 });
      const processSignal = scopedSignal(input.signal);
      try {
        await runNativeDwgProcess(
          resolvedDotnetPath,
          [
            join(input.publishedDirectory, "DwgEngineQualification.dll"),
            "read-native",
            "--input",
            sourcePath,
            "--output-dir",
            outputDirectory,
          ],
          {
            timeoutMilliseconds: READER_MILLISECONDS,
            maxOutputBytes: PROCESS_OUTPUT_BYTES,
            signal: processSignal.signal,
            env: { LANG: "C", LC_ALL: "C" },
          },
        );
        if (processSignal.signal.aborted) throw new Error("reader aborted");
      } finally {
        processSignal.dispose();
      }

      if (!exactNames(await readdir(root), ["output", "source.dwg"]))
        throw new Error("unexpected native reader working files");
      const sourceInformation = await lstat(sourcePath);
      if (
        !sourceInformation.isFile() ||
        sourceInformation.isSymbolicLink() ||
        (await realpath(sourcePath)) !== resolve(sourcePath) ||
        sourceInformation.size !== sourceSnapshot.byteLength
      )
        throw new Error("native source working copy changed");
      const sourceAfter = await readFile(sourcePath);
      if (
        sha256(sourceAfter) !== expectedSource.sha256 ||
        !Buffer.from(sourceAfter).equals(sourceSnapshot)
      )
        throw new Error("native source working copy changed");

      const outputInformation = await lstat(outputDirectory);
      if (
        !outputInformation.isDirectory() ||
        outputInformation.isSymbolicLink() ||
        (await realpath(outputDirectory)) !== resolve(outputDirectory) ||
        !exactNames(await readdir(outputDirectory), ["native-import.json"])
      )
        throw new Error("unexpected native reader output");
      const reportPath = join(outputDirectory, "native-import.json");
      const reportInformation = await lstat(reportPath);
      if (
        !reportInformation.isFile() ||
        reportInformation.isSymbolicLink() ||
        (await realpath(reportPath)) !== resolve(reportPath) ||
        !Number.isSafeInteger(reportInformation.size) ||
        reportInformation.size < 1 ||
        reportInformation.size > REPORT_BYTES
      )
        throw new Error("invalid native reader report");
      const reportBytes = await readFile(reportPath);
      if (reportBytes.byteLength !== reportInformation.size)
        throw new Error("native reader report changed");
      const reportText = new TextDecoder("utf-8", { fatal: true }).decode(
        reportBytes,
      );
      const report = NativeDrawingDwgImportReportSchema.parse(
        JSON.parse(reportText) as unknown,
      );
      if (!exactSource(report, expectedSource))
        throw new Error("native reader report source mismatch");
      if (
        sha256(input.sourceBytes) !== expectedSource.sha256 ||
        input.sourceBytes.byteLength !== expectedSource.byteSize
      )
        throw new Error("caller source bytes changed");
      const afterBuild = await calculateNativeDwgWriterBuildSha256(
        input.publishedDirectory,
      );
      if (afterBuild !== expectedBuild) throw new Error("reader build changed");
      return report;
    } finally {
      if (root) {
        const confined =
          isAbsolute(root) &&
          dirname(root) === temporaryParent &&
          basename(root).startsWith("1hk-native-dwg-reader-");
        const rootInformation = confined
          ? await lstat(root, { bigint: true })
          : null;
        if (
          !confined ||
          !rootIdentity ||
          !rootInformation?.isDirectory() ||
          rootInformation.isSymbolicLink() ||
          (await realpath(root)) !== resolve(root) ||
          rootInformation.dev !== rootIdentity.device ||
          rootInformation.ino !== rootIdentity.inode
        )
          throw new Error("native reader temporary cleanup refused");
        await rm(root, { recursive: true, force: true });
      }
    }
  } catch {
    throw new Error("Native DWG read failed.");
  }
}
