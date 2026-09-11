# Native DWG reader isolation

## Decision and scope

Continue the active R4 goal with an executable OS-confined native reader. The preceding native import projection has real same-engine read/edit/resave evidence but intentionally has no public input route. This unit supplies the missing confined execution boundary needed before a DB import worker can safely consume uploaded DWG bytes. It does not replace the full goal with an isolated demo or claim browser/persistence/delivery completion.

The existing direct .NET reader stays available for internal qualification. A whole long-running application container would still give a parser the service's credentials and network. A separate generic conversion server would add another service before its authority contract exists. Instead, each read runs the existing pinned ACadSharp reader in a credential-free, network-free, one-shot Linux container. The host supervisor holds orchestration authority; no Docker socket, host mount, service key or original path enters the parser container. Input/output are bounded pipes.

The user requested continued implementation without repeated approval prompts. Preserve existing dirty changes and this worktree; no commit, push, deployment, remote DB mutation, paid dependency or shared-container removal. Local image build and marked disposable test containers are ordinary implementation verification. Existing Docker/Colima and .NET are already installed.

## Native stream contract and image

Add `read-native-stdio` (no other arguments). `NativeDwgReader.RunStream(Stream input, Stream output, TextWriter error)` reads a non-seekable raw DWG stream to EOF, capped at 200MiB, validates the six exact ASCII ACdddd bytes, and reuses the exact strict reader/report builder from `read-native`. Do not duplicate geometry extraction or weaken existing source/path checks. It writes one complete UTF-8 `1hk-dwg-import/1` JSON report only after native validation and the 32MiB report cap succeed. No filesystem artifacts or path arguments. Error exit is nonzero with bounded fixed stderr and no success report. Transport failure may produce incomplete bytes; callers reject any nonzero/partial output. Original caller bytes remain untouched.

The existing file CLI must keep source-before/after identity checks and exclusive publication. All existing native self-tests remain. A real stream CLI test must pipe a generated DWG through the executable, not only call a helper. Add non-seekable/chunked, invalid/truncated/header-only and oversized-stream checks using bounded generated data; do not allocate a giant fixture on disk.

Build a dedicated runtime image using `tools/dwg-engine-qualification/Dockerfile.reader` with that directory as build context and a matching `.dockerignore` whitelist. NuGet restore is locked and ACadSharp stays3.7.1. Base manifest digests were read from official MCR headers on2026-09-06:

- SDK `mcr.microsoft.com/dotnet/sdk:8.0-bookworm-slim@sha256:bb32ba3ba3ea36e38572d9d8db76fa15f7cbf722f3f886e06bca6d528bd4fba8`
- Runtime `mcr.microsoft.com/dotnet/runtime:8.0-bookworm-slim@sha256:9d94ecf60a21c6e7a784cf0761fbd4a8391646617a0ff2f39621443d580cc2c3`

The image contains the published DLL at `/app/DwgEngineQualification.dll`, its locked dependencies and notices. It runs as65532:65532, disables .NET diagnostics and has no exposed port/volume. Verify `/usr/bin/timeout` exists during build. The supervisor fixes the entrypoint to `/usr/bin/timeout`, which wraps `/usr/share/dotnet/dotnet /app/DwgEngineQualification.dll read-native-stdio`; a120s inner kill deadline remains if the host supervisor disappears. No shell executes the production command. Add image label `org.1hk.native-dwg-reader.protocol=1hk-dwg-import/1`. Runtime configuration uses the full immutable local image ID `sha256:<64 lowercase hex>`; mutable tags and runtime pulls are rejected.

## Host supervisor

Export `runIsolatedNativeDrawingDwgReader({dockerPath,dockerHost,imageId,sourceBytes,expectedSource,signal?,timeoutMilliseconds?}): Promise<NativeDrawingDwgImportReport>` from a new server-only module. `expectedSource` uses the existing schema and strict source identity. Docker path is an absolute resolved regular executable; Docker host is an explicit local `unix:///absolute/socket` endpoint, not inherited context/TCP. Only minimal locale/PATH environment reaches the Docker CLI; no inherited credentials. Verify exact source byte size, SHA and raw header before any Docker operation; copy caller bytes before awaits and recheck caller identity after execution. Source cap200MiB, stdout cap32MiB, stderr/metadata cap64KiB.

Use one internal argv builder exported as `nativeDwgSandboxCreateArguments({imageId,nonce,timeoutMilliseconds})` so production and actual isolation tests use the same policy. Nonce is32lowercasehex. Container name `1hk-dwg-read-<nonce>` and label `org.1hk.native-dwg-reader.attempt=<nonce>` are generated from it. The function produces `docker create` arguments with the fixed native command; callers cannot inject a command or mount. Timeout is an integer1..120000ms and can only reduce the maximum. Test probes may change the command in their own argv copy; production has no probe command/input hook.

Each supervisor call supplies Docker `--config` with its own empty0700temporary directory. Omitting HOME alone is insufficient: Docker can resolve the account's home through the user database and load its config. No source bytes enter this directory. Clean up only the exact owned empty directory non-recursively after identity checks; a substituted or nonempty directory must not be recursively removed. This is host CLI credential isolation, not a parser mount. See [Docker CLI configuration source](https://raw.githubusercontent.com/docker/cli/master/cli/config/config.go).

Required profile:

- Linux, immutable expected image ID, `--pull never`, no image volumes.
- `--network none`, no ports, no binds/devices/host namespaces or Docker socket.
- `--read-only`, user65532:65532, `--cap-drop ALL`, `--security-opt no-new-privileges=true`, Docker default seccomp retained.
- `--cpus 1`, memory1073741824bytes and memory-swap1073741824bytes, pids64, private cgroup/PID/IPC namespaces, core dump limit0.
- The only added application working mount is `/tmp` tmpfs16MiB with noexec/nosuid/nodev; no durable output, no anonymous volumes, `--log-driver none`, no restart policy, `--init`. Standard namespaced Docker pseudo-filesystems and its private64MiB `/dev/shm` remain; they are not host-directory mounts and their memory is included in the container limit. Do not claim that every path other than `/tmp` is literally unwritable.
- Outer total deadline<=120s plus bounded10s cleanup allowance; inner `/usr/bin/timeout --signal=KILL <ceiled seconds>s` ensures the parser cannot outlive the same maximum if its host disconnects.

Create once, capture the exact64hex container ID, inspect image/attempt/policy before starting, attach stdin/stdout/stderr, send only DWG bytes, and require stopped exit0/non-OOM state before parsing the strict report and matching original identity. Source data never enters argv/env/logs. Reject unexpected output, invalidUTF8/JSON/schema/source identity, abort, deadline, output overflow, engine failure or mutable image configuration with only `Isolated native DWG read failed.`. Do not expose daemon logs, credentials or local paths.

On every outcome, remove only the created container after verifying ID/name/nonce/image ownership. If creation output is uncertain, inspect only the generated exact name and reconcile that attempt; never create another container merely because a CLI response was lost. A missing created container is not successful parsing. An ownership mismatch is not permission to remove it. Cleanup does not inherit an already-aborted signal; it has a separate10s bound. Uncertain cleanup fails the call. No global prune/list-and-delete behavior. Confinement is Docker namespace/cgroup/default-seccomp isolation on a trusted patched Linux daemon, not proof against kernel/daemon vulnerabilities or independent security certification.

## Verification and continuation

TDD for native pipe command and supervisor validation/lifecycle. Actual Docker tests must not skip missing prerequisites: build the image, generate a fresh native fixture, run the real isolated reader and real projector, assert native handles/literal geometry and originalSHA. Verify two reads do not share a container. Probe actual UID, no-new-privileges/capabilities, read-only filesystem, private mounts, network loopback only/no egress route, credential absence, cgroup CPU/memory/pids limits. Test inner timeout and outer abort cleanup with finite test processes; no fork bomb or uncontrolled memory exhaustion. Confirm no marked test containers remain after success, invalid input and cancellation. Command-level fakes may test uncertainty paths but cannot count as native/isolation evidence.

Run previous direct-reader/projection/selected-edit tests, old native writer tests and application typecheck. Record exact image ID, engine version, source/report hashes and outcomes in evidence. No public route/DB operation/approved resave guard changes in this unit. Next dependent work: verified source → DWG import job/lease → isolated read → service-issued `dwg_entity` attestation → canonical history/outbox/UI → approved whole-source resave and recipientCAD qualification.

References: [Docker run controls](https://docs.docker.com/reference/cli/docker/container/run/), [Docker security boundary](https://docs.docker.com/engine/security/). Local Docker CLI create/start help and credential-free explicit-unix-socket access were verified before this design.
