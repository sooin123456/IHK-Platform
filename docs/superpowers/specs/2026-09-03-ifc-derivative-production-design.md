# 1HK IFC derivative production design

Status: approved continuation of the Universal Drawing Workspace goal

## Outcome

An immutable IFC upload must converge from an actual queued conversion to one
of two truthful terminal states:

```text
verified IFC upload
  -> atomic queued job
  -> leased storage-pull worker
  -> source byte-size and SHA-256 recheck
  -> deterministic GLB and semantic manifest
  -> existing managed validation/publication boundary
  -> ready or bounded failed evidence
```

The browser never parses or mutates the original IFC. A missing job is not
reported as “generating,” and a worker failure cannot create ready evidence.

## Decision

The converter continues the existing `oxideav-ifc` Rust prototype rather than
extending the narrow IfcPlusPlus spike or adding `web-ifc` to the browser
package.

- `oxideav-ifc` and its locked dependency closure are MIT/permissive-only,
  pure Rust, and already produced deterministic geometry for the pinned P5
  IFC2X3 fixture.
- the tracked IfcPlusPlus spike accepts only unplaced
  `IfcTriangulatedFaceSet` geometry and its output does not match the current
  strict platform contract;
- `web-ifc` is the operational fallback if the customer corpus proves the Rust
  engine insufficient, but its MPL-2.0 exception must be an explicit product
  decision;
- IfcOpenShell is the mature interoperability fallback, but its LGPL/native
  image boundary is larger than this release unit.

The Rust engine remains pinned. Passing one representative file does not make
it a general IFC compatibility claim. Revit, Archicad, Tekla, IFC2X3, and IFC4
fixtures are a separate production-qualification gate.

## Artifact contract

The converter receives an IFC path, two new target paths, and the authoritative
source-file UUID. It produces both artifacts in memory or task-local temporary
files and publishes neither on failure.

- Manifest: exact `IfcDerivativeManifestSchema` shape, recursively sorted
  compact JSON, no newline or additional keys.
- Geometry: self-contained GLB 2.0 with embedded binary data, finite metre
  coordinates, deterministic nodes, and exact `ifcNodeId` / `ifcExpressId`
  extras.
- Every GLB mesh primitive is claimed exactly once by one manifest element.
- Every manifest element has an exact 22-character GlobalId and at least one
  rendered mesh.
- Limits remain at or below 200 MiB IFC/GLB and 32 MiB manifest. Limit failure
  rejects rather than truncates.
- Existing targets are never overwritten. Original IFC bytes are read-only.

The existing `validateManagedIfcDerivativePair` and
`publishManagedIfcDerivativeReady` remain the only ready publication path.

## Job authority

A forward migration creates one service-only operational job for every
immutable IFC file, including an idempotent backfill. The file insert trigger
and file row commit are atomic.

The job projection may move through `queued`, `processing`, `retry_wait`,
`completed`, or `failed`; derivative rows remain immutable evidence. No
`pending` derivative row is created because it cannot be updated and would
collide with a ready version.

Only narrow service-role RPCs can claim, complete, or fail a job. Claim uses
`FOR UPDATE SKIP LOCKED`, a bounded lease, an opaque lease token, a capped
attempt count, and the next unused derivative version. An expired lease is
recoverable. Completion requires the exact ready derivative row. Terminal
failure inserts one immutable failed derivative row. A discovered ready row
reconciles a response-loss retry to completed.

The browser and ordinary authenticated users have no direct table or RPC write
authority.

## Worker boundary

The worker is a separate Linux container, not a Vercel request and not the
collaboration WebSocket process. It holds the service credential; the native
converter subprocess never does.

For each claim the worker:

1. downloads only the claimed private Storage object;
2. checks exact length and SHA-256 before spawning the converter;
3. runs the pinned binary without a shell, with a deadline and bounded output;
4. reads the manifest/GLB only after successful conversion;
5. calls the existing validator/publisher and then completes the lease;
6. classifies transient storage/network/publication errors for capped retry,
   and malformed/unsupported/hash/contract failures as terminal;
7. removes task-local files in all outcomes.

No IFC, manifest, GLB, token, or service key is written to logs.

## Product state and refresh

Source loading distinguishes `not_queued`, `queued`, `processing`,
`retry_wait`, `ready`, and `failed`. While a real job is nonterminal, the
workspace performs bounded revalidation and stops at a terminal state. Legacy
IFC files without a job say that conversion has not been requested; they do not
show an infinite spinner.

2D editing, comments, and source metadata stay mounted when 3D is unavailable.

## Retention and race safety

Project purge must include jobs, derivative database evidence, and every
content-addressed JSON/GLB object. Purge first prevents new claims/publication,
waits for or invalidates active leases, records the exact artifact manifest,
then removes rows and Storage objects under existing retention authority.

Publication against a purging project fails closed. An orphaned exact
content-addressed artifact is safe for idempotent reconciliation and is removed
by the retention/garbage-collection path, never treated as ready by itself.

## Release gates

- exactly one job from one verified IFC finalization and from backfill;
- two workers cannot claim the same live lease;
- expired-lease recovery, capped retry, response-loss convergence;
- source length/SHA mismatch prevents conversion and ready publication;
- real source-derived fixture passes current manifest/GLB validator and
  GlobalId bidirectional selection;
- Viewer/anon/authenticated denial for job and publication authority;
- UI reaches truthful ready or bounded failed state without fake pending;
- purge covers job rows, derivative rows, manifest, and GLB;
- Linux image digest, engine commit, SBOM, and exact fixture evidence recorded;
- no claim of general IFC compatibility until the multi-exporter corpus passes.

