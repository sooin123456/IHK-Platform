# Isolated native DWG resave protocol

## Purpose and authority

Continue the active Universal Workspace goal from the completed approved-source bridge. This unit makes a selected-edit request and original DWG produce a verified experimental DWG through the existing isolated native engine. It does not issue persistence authority, enqueue production jobs, publish artifacts, or qualify recipient delivery. Those remain required follow-on integration and acceptance work, not removed scope.

The previous goal turn is progress: reviewed approved-source code and actual DB/browser evidence changed authoritative state. Current linked worktree and those accepted hashes were rechecked before this unit. Existing unrelated dirty changes and preview build remain untouched.

## Approach

Use a new fixed binary stdio protocol and the existing ACadSharp selected-edit engine, native reader geometry checks, inventory and SemanticComparer. Share the existing Docker lifecycle internally between two closed profiles. Alternatives were a host CLI (does not provide the required production confinement) and a duplicate Docker runner (duplicates security lifecycle). Neither is selected. No third engine, service, framework or dependency is added.

Native work stays in memory. Add narrow byte/stream overloads to existing helpers where required instead of rewriting request validation or roundtrip semantics. Existing `qualify`, `write-native`, `read-native`, `read-native-stdio` and source-free export contracts remain unchanged.

## Wire contract

New exact CLI command: `resave-native-stdio`, no other arguments. Input is:

1. 8 ASCII bytes `1HKRSV01`.
2. Unsigned 32-bit **big endian** request byte length, then source byte length.
3. Exact request bytes, then exact source DWG bytes, then EOF.

Request is strict UTF-8 without BOM, existing `1hk-dwg-edits/2` JSON only; 1..2 MiB. Original source is 6..200 MiB, header `AC` plus four digits. Reuse full existing selected-edit validation; version 1 is rejected by this new command while remaining supported by the old CLI. Declared length validation precedes allocation. Reject wrong magic/version, over-budget lengths, truncated reads, trailing bytes, duplicate JSON keys, wrong hash, invalid/native-ineligible/duplicate targets and unsupported requests. Read non-seekable chunked input correctly.

Success output is:

1. 8 ASCII bytes `1HKRSO01`.
2. Unsigned 32-bit big endian report length, then DWG length.
3. Exact UTF-8 JSON report, then exact output DWG, then EOF.

Report is 1..1 MiB; DWG is 6..200 MiB. Bound output memory while writing. Do not emit success bytes until all native validation and readback succeed. Invalid requests/engine failures return nonzero, no success frame and only fixed stderr `native stream resave failed.` (plus newline); never exception type/message/path/stack/raw diagnostic. Transport output-write failure may yield incomplete bytes; the host must reject any incomplete frame/nonzero/diagnostic.

## Native verification

- Hash exact source and request bytes; compare request source hash before editing.
- Validate source using existing bounded native-reader contract (entity/layer/vertex budgets, ownership, Xrefs, header) and preserve current fail-closed unknown/proxy/nonzero-polyline-vertex-ID policy.
- Inventory the complete supported document, not just selected model-space handles. Require no explicit inventory gaps/duplicate identities. Reject external references without opening paths/URLs. Existing known inventory limits are explicitly described, not claimed solved.
- Ordinary default paper-space VIEWPORTs must be preserved in success fixtures and real execution, not deleted to satisfy the gap gate. Extend the existing passive inventory for VIEWPORT geometry, view/plot settings and relevant references using the pinned native API; add mutation-detection checks. This does not add editable VIEWPORT authoring or claim complete CAD appearance coverage. Other genuinely unhandled inventory types remain rejected.
- Perform no-edit DWG write/readback and require SemanticComparer equality with no exemptions at absolute geometry tolerance `1e-9`.
- Apply the exact v2 request only after validation of the entire batch. Inventory expected post-edit document. Write/readback selected output and compare to that exact expected inventory with no selected-handle exemption; preserve source units/header and untouched entities.
- Recheck source/request identities and validate output through native-reader bounds. Do not return known failed/gapped roundtrips. No-op source-bridge requests remain null and never invoke this protocol.
- Reuse current pin ACadSharp `3.7.1`, .NET 8, MIT notices. Synthetic engine readback is not independent CAD qualification.

## Public report (strict, no extra fields)

```ts
type ResaveReport = {
  schemaVersion: "1hk-dwg-resave/1";
  qualification: "experimental-unqualified";
  persistenceAuthority: "not-issued";
  source: { sha256: string; byteSize: number; headerVersion: string };
  request: {
    schemaVersion: "1hk-dwg-edits/2";
    sha256: string;
    byteSize: number;
    handles: string[]; // exact request order; unique canonical uppercase UInt64 handles
  };
  output: { sha256: string; byteSize: number; headerVersion: string };
  engine: { name: "ACadSharp"; version: "3.7.1" };
  verification: {
    noEditRoundTrip: "passed";
    selectedEditRoundTrip: "passed";
    geometryTolerance: 1e-9;
    inventoriedEntityCount: number; // 1..10000; entire inventoried document
    editedEntityCount: number; // handles.length, <= inventoriedEntityCount
    inventoryCoverage: "supported-fields-only";
    independentCad: "not-performed";
  };
};
```

SHA-256 is lowercase 64 hex. Source/output identities use the existing source schema plus at least 6 bytes. Source/output header must match. Request handles/count/hash/size must match the supplied v2 request bytes. Reject report BOM/invalid UTF-8, non-strict shape, failed/qualified/authority-bearing statuses, altered bytes, mismatched framing or extra output. No public filenames, paths, diagnostics, timestamps, inventories, credentials, signed URLs or raw source text.

## Host and image contract

Add `nativeDwgResaveSandboxCreateArguments({imageId,nonce,timeoutMilliseconds})` and `runIsolatedNativeDrawingDwgResaver({dockerPath,dockerHost,imageId,sourceBytes,expectedSource,requestBytes,expectedRequestSha256,signal?,timeoutMilliseconds?})` to the sandbox module. Return `{report, reportBytes, dwgBytes}` only after verified container exit and completed cleanup. A new pure resave protocol module owns report validation and framing. Existing reader exports retain their exact behavior/errors.

Internally share a closed, unexported reader/resaver runner/profile, not an arbitrary-command API. Resaver name `1hk-dwg-resave-<32hex nonce>`, ownership label `org.1hk.native-dwg-resaver.attempt`, image label `org.1hk.native-dwg-resaver.protocol=1hk-dwg-resave/1`, fixed command `resave-native-stdio`. Add this image label to existing pinned Dockerfile.reader; keep its reader label/default entrypoint. The caller supplies an immutable image ID, not a tag; validate inspected image and actual container before and after execution.

Resaver memory and memory-swap are both 2147483648 bytes; existing reader remains 1073741824. All other confinement remains the existing profile: Linux local Unix socket only, seccomp builtin required, network none, readonly root, user65532, no capabilities/no-new-privileges, CPU1, pids64, private namespaces, core0, tmpfs16MiB noexec/nosuid/nodev, no host mounts/devices/ports/credentials/env, no logs/restart, inner kill deadline <=120s. Inspect actual receipt including memory and exact command; resource flags alone are not proof.

Snapshot source and request synchronously before the first await, verify hashes/header/source binding, stream `[header,requestSnapshot,sourceSnapshot]` with backpressure and explicit stdout budget. Report and output are validated against snapshots; after container and private CLI-config cleanup recheck caller-owned bytes and abort signal. Timeout/abort/overflow/nonzero/stderr/malformed/OOM/cleanup failure reject with only `Isolated native DWG resave failed.`. Independent cleanup budget is 10s; inspect exact name/image/nonce/id before removing only the owned container, including uncertain create outcomes. Never remove foreign identity; never use a host native fallback.

## Acceptance and remaining gates

1. Actual CLI + non-seekable stream success edits all five supported types, hashes original/request/output, verifies literal geometry/untouched inventory, malformed/truncated/trailing/version1/invalid batch rejected without success bytes.
2. Finite Docker transport doubles validate host framing, profile, source/request mutation and cancellation (including cleanup), wrong receipts/results, ownership safety and bounded redaction. They are not native/confinement proof.
3. Actual current Docker image from current native source: real source -> isolated read -> existing compiler -> isolated resave -> isolated readback with literal expected geometry, source SHA unchanged; request/source mismatch, invalid stream, cancellation/timeout, owned cleanup, no foreign container removal. Verify actual 2GiB profile/cgroup while preserving all old reader isolation tests.
4. Existing Node reader/selected/source adapter regressions, native self-tests and typecheck pass. No build writes to live platform/build.
5. Keep imported-resave jobs, cancellation API, immutable attested Storage artifacts, receipt-only downloads, full Auth/Storage/browser path, independent CAD/corpus qualification and R5 same-approved-revision package on the active continuation map.

No commit/stage/merge/push/deployment, dependency installation, paid service, remote database/Storage writes or customer files. Local generated fixtures and owned test containers/build outputs are allowed and recorded. Existing dirty changes are preserved.
