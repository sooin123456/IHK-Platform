import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdtemp,
  realpath,
  rmdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { z } from "zod";

import {
  NativeDrawingDwgImportReportSchema,
  NativeDrawingDwgSourceSchema,
  type NativeDrawingDwgImportReport,
} from "./drawing-native-dwg-import.server.ts";

import {
  encodeNativeDrawingDwgResaveInput,
  decodeNativeDrawingDwgResaveOutput,
} from "./drawing-native-dwg-resave-protocol.server.ts";

const FAILURE = "Isolated native DWG read failed.";
const PROFILES = {
  reader: {
    failure: FAILURE,
    prefix: "1hk-dwg-read-",
    attemptLabel: "org.1hk.native-dwg-reader.attempt",
    protocolLabel: "org.1hk.native-dwg-reader.protocol",
    protocol: "1hk-dwg-import/1",
    command: "read-native-stdio",
    memory: 1_073_741_824,
    outputBytes: 32 * 1024 * 1024,
  },
  resaver: {
    failure: "Isolated native DWG resave failed.",
    prefix: "1hk-dwg-resave-",
    attemptLabel: "org.1hk.native-dwg-resaver.attempt",
    protocolLabel: "org.1hk.native-dwg-resaver.protocol",
    protocol: "1hk-dwg-resave/1",
    command: "resave-native-stdio",
    memory: 2_147_483_648,
    outputBytes: 16 + 201 * 1024 * 1024,
  },
} as const;
type Profile = keyof typeof PROFILES;
type ResaveResult = ReturnType<typeof decodeNativeDrawingDwgResaveOutput>;
/** Private execution evidence only; no native detail or resource locator escapes. */
export class NativeDrawingDwgResaveSandboxError extends Error {
  readonly cleanupConfirmed: boolean;
  constructor(cleanupConfirmed: boolean) {
    super(PROFILES.resaver.failure);
    this.name = "NativeDrawingDwgResaveSandboxError";
    this.cleanupConfirmed = cleanupConfirmed;
  }
}
const METADATA_BYTES = 64 * 1024;
const ImageId = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const ContainerId = z.string().regex(/^[0-9a-f]{64}$/);
const PolicyInput = z
  .object({
    imageId: ImageId,
    nonce: z.string().regex(/^[0-9a-f]{32}$/),
    timeoutMilliseconds: z.number().int().min(1).max(120_000),
  })
  .strict();

/** Closed internal command catalog; callers cannot supply commands or resources. */
function createArguments(
  kind: Profile,
  input: {
    imageId: string;
    nonce: string;
    timeoutMilliseconds: number;
  },
): string[] {
  try {
    const { imageId, nonce, timeoutMilliseconds } = PolicyInput.parse(input);
    const profile = PROFILES[kind];
    return [
      "create",
      "--pull",
      "never",
      "--name",
      `${profile.prefix}${nonce}`,
      "--label",
      `${profile.attemptLabel}=${nonce}`,
      "--network",
      "none",
      "--read-only",
      "--user",
      "65532:65532",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges=true",
      "--cpus",
      "1",
      "--memory",
      String(profile.memory),
      "--memory-swap",
      String(profile.memory),
      "--pids-limit",
      "64",
      "--cgroupns",
      "private",
      "--ipc",
      "private",
      "--ulimit",
      "core=0:0",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,nodev,size=16777216",
      "--log-driver",
      "none",
      "--restart",
      "no",
      "--init",
      "--interactive",
      "--entrypoint",
      "/usr/bin/timeout",
      imageId,
      "--signal=KILL",
      `${Math.ceil(timeoutMilliseconds / 1000)}s`,
      "/usr/share/dotnet/dotnet",
      "/app/DwgEngineQualification.dll",
      profile.command,
    ];
  } catch {
    throw new Error(PROFILES[kind].failure);
  }
}

export function nativeDwgSandboxCreateArguments(
  input: z.infer<typeof PolicyInput>,
): string[] {
  return createArguments("reader", input);
}

export function nativeDwgResaveSandboxCreateArguments(
  input: z.infer<typeof PolicyInput>,
): string[] {
  return createArguments("resaver", input);
}

function requireCondition(condition: unknown): asserts condition {
  if (!condition) throw new Error(FAILURE);
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exact(actual: unknown, expected: unknown) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function boundedSignal(milliseconds: number, parent?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, Math.max(0, milliseconds));
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}

/** Kill the CLI on overflow/abort; a separate owned-container cleanup follows. */
async function docker(
  executable: string,
  host: string,
  configDirectory: string,
  args: string[],
  signal: AbortSignal,
  inputChunks: Buffer[] = [],
  outputBudget = METADATA_BYTES,
): Promise<Buffer> {
  requireCondition(!signal.aborted);
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      executable,
      ["--config", configDirectory, "--host", host, ...args],
      {
        env: {
          LANG: "C",
          LC_ALL: "C",
          PATH: "/usr/bin:/bin",
        },
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      },
    );
    const chunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failed = false;
    const dispose = () => signal.removeEventListener("abort", fail);
    const fail = () => {
      if (failed) return;
      failed = true;
      child.kill("SIGKILL");
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      dispose();
      reject(new Error(FAILURE));
    };
    signal.addEventListener("abort", fail, { once: true });
    if (signal.aborted) fail();
    child.once("error", fail);
    child.stdout.on("error", fail);
    child.stderr.on("error", fail);
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > outputBudget) fail();
      else if (!failed) chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > METADATA_BYTES) fail();
    });
    // pipeline supplies backpressure without making a second source copy.
    const sent = pipeline(Readable.from(inputChunks), child.stdin);
    sent.catch(fail);
    child.once("close", (code, terminationSignal) => {
      dispose();
      if (failed) return;
      if (
        code !== 0 ||
        terminationSignal ||
        signal.aborted ||
        stderrBytes !== 0
      ) {
        fail();
        return;
      }
      void sent.then(() => {
        if (!failed) resolve(Buffer.concat(chunks, stdoutBytes));
      }, fail);
    });
  });
}

function json(bytes: Buffer): unknown {
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
  );
}

const EmptyCollection = z
  .union([z.null(), z.array(z.unknown()).length(0), z.object({}).strict()])
  .optional();
const ImageReceipt = z.object({
  Id: ImageId,
  Os: z.literal("linux"),
  Config: z.object({
    Volumes: EmptyCollection,
    ExposedPorts: EmptyCollection,
    Env: z.array(z.string()),
    Labels: z.record(z.string()),
  }),
});
// Ownership is deliberately independent of policy: a refused profile still
// belongs to this attempt and must be removed, while a foreign identity cannot.
const OwnershipReceipt = z.object({
  Id: ContainerId,
  Name: z.string(),
  Image: ImageId,
  Config: z.object({ Labels: z.record(z.string()) }),
});
const ContainerReceipt = z.object({
  Platform: z.literal("linux"),
  Path: z.literal("/usr/bin/timeout"),
  Args: z.array(z.string()),
  Config: z.object({
    Image: ImageId,
    User: z.literal("65532:65532"),
    Tty: z.literal(false),
    OpenStdin: z.literal(true),
    AttachStdin: z.literal(true),
    AttachStdout: z.literal(true),
    AttachStderr: z.literal(true),
    Env: z.array(z.string()),
    Volumes: EmptyCollection,
    ExposedPorts: EmptyCollection,
    Entrypoint: z.array(z.string()),
    Cmd: z.array(z.string()),
  }),
  HostConfig: z.object({
    NetworkMode: z.literal("none"),
    ReadonlyRootfs: z.literal(true),
    Privileged: z.literal(false),
    CapAdd: EmptyCollection,
    CapDrop: z.tuple([z.literal("ALL")]),
    SecurityOpt: z.tuple([z.literal("no-new-privileges=true")]),
    NanoCpus: z.literal(1_000_000_000),
    Memory: z.number().int(),
    MemorySwap: z.number().int(),
    PidsLimit: z.literal(64),
    CgroupnsMode: z.literal("private"),
    PidMode: z.literal(""),
    IpcMode: z.literal("private"),
    ShmSize: z.literal(67_108_864),
    UTSMode: z.literal(""),
    UsernsMode: z.literal(""),
    Binds: EmptyCollection,
    Mounts: EmptyCollection,
    Devices: EmptyCollection,
    DeviceRequests: EmptyCollection,
    DeviceCgroupRules: EmptyCollection,
    VolumesFrom: EmptyCollection,
    PortBindings: EmptyCollection,
    PublishAllPorts: z.literal(false),
    ExtraHosts: EmptyCollection,
    Links: EmptyCollection,
    RestartPolicy: z.object({
      Name: z.literal("no"),
      MaximumRetryCount: z.literal(0),
    }),
    AutoRemove: z.literal(false),
    Init: z.literal(true),
    LogConfig: z.object({ Type: z.literal("none"), Config: EmptyCollection }),
    Tmpfs: z
      .object({ "/tmp": z.literal("rw,noexec,nosuid,nodev,size=16777216") })
      .strict(),
    Ulimits: z.tuple([
      z.object({
        Name: z.literal("core"),
        Hard: z.literal(0),
        Soft: z.literal(0),
      }),
    ]),
  }),
  Mounts: z.array(z.unknown()).length(0),
  NetworkSettings: z.object({
    Networks: z.object({ none: z.object({}) }).strict(),
  }),
  State: z.object({
    Status: z.string(),
    Running: z.literal(false),
    Paused: z.literal(false),
    Restarting: z.literal(false),
    Dead: z.literal(false),
    OOMKilled: z.literal(false),
    ExitCode: z.literal(0),
    Error: z.literal(""),
  }),
});

type SandboxInput = {
  dockerPath: string;
  dockerHost: string;
  imageId: string;
  sourceBytes: Uint8Array;
  expectedSource: unknown;
  signal?: AbortSignal;
  timeoutMilliseconds?: number;
};

type ResaverInput = SandboxInput & {
  requestBytes: Uint8Array;
  expectedRequestSha256: string;
};

/** One ephemeral Linux parser; successful return carries no persistence authority. */
export async function runIsolatedNativeDrawingDwgReader(
  input: SandboxInput,
): Promise<NativeDrawingDwgImportReport> {
  return (await runIsolated("reader", input)) as NativeDrawingDwgImportReport;
}

export async function runIsolatedNativeDrawingDwgResaver(
  input: ResaverInput,
): Promise<ResaveResult> {
  return (await runIsolated("resaver", input)) as ResaveResult;
}

async function runIsolated(
  kind: Profile,
  input: SandboxInput | ResaverInput,
): Promise<NativeDrawingDwgImportReport | ResaveResult> {
  const profile = PROFILES[kind];
  const started = performance.now();
  let configUnsettled = false;
  let containerUnsettled = false;
  try {
    const { dockerHost, dockerPath, sourceBytes, signal } = input;
    const timeoutMilliseconds = input.timeoutMilliseconds ?? 120_000;
    const imageId = ImageId.parse(input.imageId);
    requireCondition(
      Number.isInteger(timeoutMilliseconds) &&
        timeoutMilliseconds >= 1 &&
        timeoutMilliseconds <= 120_000,
    );
    requireCondition(!signal?.aborted && sourceBytes instanceof Uint8Array);
    const requestBytes =
      kind === "resaver" ? (input as ResaverInput).requestBytes : undefined;
    const encoded =
      kind === "resaver"
        ? encodeNativeDrawingDwgResaveInput(input as ResaverInput)
        : undefined;
    const expected =
      encoded?.source ??
      NativeDrawingDwgSourceSchema.parse(input.expectedSource);
    requireCondition(sourceBytes.byteLength === expected.byteSize);
    // Copy before the first await; hashing a caller-owned view after awaits is unsafe.
    const snapshot = encoded?.chunks[2] ?? Buffer.from(sourceBytes);
    const unchanged = () =>
      sourceBytes.byteLength === expected.byteSize &&
      sha256(sourceBytes) === expected.sha256 &&
      (!encoded ||
        (requestBytes instanceof Uint8Array &&
          requestBytes.byteLength === encoded.request.byteSize &&
          sha256(requestBytes) === encoded.request.sha256));
    requireCondition(
      sha256(snapshot) === expected.sha256 &&
        snapshot
          .subarray(0, 6)
          .equals(Buffer.from(expected.headerVersion, "ascii")),
    );
    requireCondition(
      typeof dockerHost === "string" &&
        /^unix:\/\/\/[^\0\r\n?#%]+$/.test(dockerHost),
    );
    const socket = dockerHost.slice("unix://".length);
    requireCondition(
      isAbsolute(socket) &&
        normalize(socket) === socket &&
        !socket.startsWith("//"),
    );
    requireCondition(isAbsolute(dockerPath));
    const scope = boundedSignal(
      timeoutMilliseconds - (performance.now() - started),
      signal,
    );
    let configDirectory: string | undefined;
    let configIdentity: { dev: bigint; ino: bigint } | undefined;
    let report: NativeDrawingDwgImportReport | ResaveResult | undefined;
    let cleanupScope: ReturnType<typeof boundedSignal> | undefined;
    const cleanupSignal = () => (cleanupScope ??= boundedSignal(10_000)).signal;
    try {
      const executable = await realpath(dockerPath);
      requireCondition(
        isAbsolute(executable) && (await stat(executable)).isFile(),
      );
      await access(executable, constants.X_OK);
      requireCondition((await stat(socket)).isSocket());
      // Docker falls back to passwd home config even without HOME. This empty
      // private directory prevents client auth, proxy and custom-header loading.
      const configPrefix = join(await realpath(tmpdir()), "1hk-dwg-cli-");
      configUnsettled = true;
      configDirectory = await mkdtemp(configPrefix);
      configIdentity = await lstat(configDirectory, { bigint: true });
      requireCondition((await realpath(configDirectory)) === configDirectory);
      const config = configDirectory;
      const call = (
        args: string[],
        signal = scope.signal,
        chunks?: Buffer[],
        outputBudget = METADATA_BYTES,
      ) =>
        docker(
          executable,
          dockerHost,
          config,
          args,
          signal,
          chunks,
          outputBudget,
        );
      const capabilities = z
        .object({
          OSType: z.literal("linux"),
          MemoryLimit: z.literal(true),
          SwapLimit: z.literal(true),
          CpuCfsPeriod: z.literal(true),
          CpuCfsQuota: z.literal(true),
          PidsLimit: z.literal(true),
          SecurityOptions: z.array(z.string()),
        })
        .parse(json(await call(["info", "--format", "{{json .}}"])));
      requireCondition(
        capabilities.SecurityOptions.includes("name=seccomp,profile=builtin"),
      );
      const image = z
        .tuple([ImageReceipt])
        .parse(json(await call(["image", "inspect", imageId])))[0];
      requireCondition(
        image.Id === imageId &&
          image.Config.Labels[profile.protocolLabel] === profile.protocol,
      );
      requireCondition(image.Config.Env.includes("DOTNET_EnableDiagnostics=0"));
      const nonce = randomBytes(16).toString("hex");
      const name = `${profile.prefix}${nonce}`;
      const argv = createArguments(kind, {
        imageId,
        nonce,
        timeoutMilliseconds,
      });
      const command = argv.slice(argv.indexOf(imageId) + 1);
      let id: string | undefined;
      let createAttempted = false;
      const inspect = async (target: string, signal = scope.signal) => {
        const receipt = z
          .tuple([z.unknown()])
          .parse(json(await call(["container", "inspect", target], signal)))[0];
        const owner = OwnershipReceipt.parse(receipt);
        requireCondition(
          owner.Name === `/${name}` &&
            owner.Image === imageId &&
            owner.Config.Labels[profile.attemptLabel] === nonce &&
            (!id || owner.Id === id),
        );
        return { receipt, id: owner.Id };
      };
      try {
        requireCondition(!scope.signal.aborted);
        createAttempted = true;
        containerUnsettled = true;
        const createOutput = await call(argv);
        id = ContainerId.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(createOutput).trim(),
        );
        const validateProfile = (
          receipt: unknown,
          status: "created" | "exited",
        ) => {
          const container = ContainerReceipt.parse(receipt);
          requireCondition(
            container.Config.Image === imageId &&
              container.State.Status === status &&
              container.HostConfig.Memory === profile.memory &&
              container.HostConfig.MemorySwap === profile.memory,
          );
          requireCondition(exact(container.Config.Env, image.Config.Env));
          requireCondition(
            exact(container.Config.Entrypoint, ["/usr/bin/timeout"]) &&
              exact(container.Config.Cmd, command) &&
              exact(container.Args, command),
          );
        };
        validateProfile((await inspect(id)).receipt, "created");
        const output = await call(
          ["start", "--attach", "--interactive", id],
          scope.signal,
          encoded?.chunks ?? [snapshot],
          profile.outputBytes,
        );
        validateProfile((await inspect(id)).receipt, "exited");
        if (encoded)
          report = decodeNativeDrawingDwgResaveOutput(output, encoded);
        else {
          const parsed = NativeDrawingDwgImportReportSchema.parse(json(output));
          requireCondition(exact(parsed.source, expected));
          report = parsed;
        }
        requireCondition(
          !scope.signal.aborted &&
            performance.now() - started <= timeoutMilliseconds,
        );
        requireCondition(unchanged());
      } finally {
        if (createAttempted) {
          const cleanup = cleanupSignal();
          const owned = await inspect(id ?? name, cleanup);
          const removed = await call(["rm", "--force", owned.id], cleanup);
          requireCondition(
            new TextDecoder("utf-8", { fatal: true }).decode(removed).trim() ===
              owned.id,
          );
          containerUnsettled = false;
        }
      }
    } finally {
      scope.dispose();
      try {
        if (configDirectory) {
          const cleanup = cleanupSignal();
          const config = configDirectory;
          // Nonrecursive removal cannot destroy any unexpected client artifacts.
          await new Promise<void>((resolve, reject) => {
            const abort = () => reject(new Error(FAILURE));
            cleanup.addEventListener("abort", abort, { once: true });
            void (async () => {
              requireCondition(!cleanup.aborted);
              const current = await lstat(config, { bigint: true });
              requireCondition(
                current.isDirectory() &&
                  !current.isSymbolicLink() &&
                  current.dev === configIdentity?.dev &&
                  current.ino === configIdentity?.ino &&
                  (await realpath(config)) === config &&
                  !cleanup.aborted,
              );
              await rmdir(config);
              requireCondition(!cleanup.aborted);
            })()
              .then(resolve, reject)
              .finally(() => cleanup.removeEventListener("abort", abort));
          });
          configUnsettled = false;
        }
      } finally {
        cleanupScope?.dispose();
      }
    }
    // Publish only after both asynchronous cleanup stages; callers can still
    // mutate their bytes or cancel while the CLI directory is being removed.
    requireCondition(report && !signal?.aborted && unchanged());
    return report;
  } catch {
    if (kind === "resaver")
      throw new NativeDrawingDwgResaveSandboxError(
        !configUnsettled && !containerUnsettled,
      );
    throw new Error(profile.failure);
  }
}
