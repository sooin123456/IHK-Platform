# Native DWG worker

This server-only worker claims approved native drawing jobs, runs the pinned
published .NET writer, stages four immutable artifact identities, uploads and
reads every artifact back, settles the upload session, and only then publishes
the receipt. Output remains `experimental-unqualified`; this is not independent
recipient-CAD qualification.

## Durable native import analysis

The separate import-analysis command claims verified immutable DWG sources,
downloads their exact bytes from the private `lukas-qto` bucket, and sends only
those bytes to the existing credential-free, no-network Linux reader. It
publishes one strict `1hk-dwg-import/1` report with a database-checked digest.
Its terminal success is `analyzed` with
`qualification: experimental-unqualified` and
`persistenceAuthority: not-issued`; it does not create drawing objects or grant
canonical import/resave authority.

Required environment for the import-analysis command:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only; never passed to the reader)
- `NATIVE_DWG_READER_IMAGE_ID` (immutable lowercase `sha256:<64 hex>` image ID)
- `NATIVE_DWG_DOCKER_PATH` (absolute Docker CLI path)
- `NATIVE_DWG_DOCKER_HOST` (absolute normalized `unix:///...` socket only)

`NATIVE_DWG_IMPORT_LEASE_SECONDS` is optional from 180 through 900 and defaults
to 300. `NATIVE_DWG_IMPORT_POLL_MILLISECONDS` is optional from 100 through
60000 and defaults to 1000. Build/typecheck with
`npm run build:native-dwg-worker`; start with
`npm run start:native-dwg-import-worker`.

The service credential is used only by abort-bounded PostgREST and Storage
requests to the configured Supabase origin. Storage redirects, incorrect
declared lengths, malformed paths, truncated/oversized bodies, source identity
changes, malformed reports, stale leases, and late publication are rejected.
Chunked responses without a declared length remain bounded by the immutable
source descriptor and must finish at its exact expected byte size.
An uncertain completion response is reported as `publication_uncertain` and is
not retried or converted into a failure, because the exact publication may
already have committed.

Required environment:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only; never expose it to a browser)
- `NATIVE_DWG_DOTNET_PATH` (absolute `dotnet` path; its resolved target must be a regular file)
- `NATIVE_DWG_PUBLISHED_DIRECTORY` (absolute, non-symlinked published writer)

Optional `NATIVE_DWG_LEASE_SECONDS` defaults to 900 and
`NATIVE_DWG_POLL_MILLISECONDS` defaults to 1000. Build/typecheck with
`npm run build:native-dwg-worker`; start with
`npm run start:native-dwg-worker`.

The exported `calculateNativeDwgWriterBuildSha256()` sorts every regular file
name in the published directory and hashes, for each file, UTF-8 name, NUL,
decimal byte length, NUL, exact bytes, NUL. The worker checks the same build
before and after every conversion. It rejects symlinks, unexpected output
names, non-AC1024 data, report or source/hash mismatches, oversized artifacts,
and database paths that do not match the claimed project/job/attempt identity.

Storage uses a focused, server-only `fetch` transport against the private
`lukas-qto` bucket with `x-upsert:false`. The dependency factory requires the
validated Supabase URL and service credential, so upload/download cancellation
and bounded streaming are enforced rather than delegated to optional caller
configuration. Lifecycle RPC builders receive the same operation
`AbortSignal` through `.abortSignal(signal)`.

An upload is accepted only after its complete bounded HTTP response is read.
A completed success is `uploaded`; only a completed 400/409 Supabase
`Duplicate` or `ResourceAlreadyExists` response is `exists`. Both states still
require exact byte/hash/size readback. A timeout, abort, lost response, or other
transport uncertainty leaves the upload session open even if a later read could
find matching bytes; the worker never settles, publishes, or deletes on that
uncertain attempt.

Managed DWG bytes use the existing bucket's `application/octet-stream` upload
type; JSON artifacts use `application/json`. The authorized download resource
derives its response MIME from the verified artifact kind (`application/acad`
for DWG). No bucket allowlist or client Storage privilege is broadened.

## Local end-to-end gate

The M1 native-template scenario now exercises the actual published writer,
PostgREST, Storage, and authenticated browser downloads. It requires .NET 8,
the existing restored ACadSharp project, Docker/Supabase CLI, and installed
Playwright Chromium in addition to the normal app dependencies.

Publish `tools/dwg-engine-qualification/DwgEngineQualification.csproj` with
`dotnet publish --no-restore -c Release -o <fresh-absolute-output-directory>`.
Set `NATIVE_DWG_DOTNET_PATH` and `NATIVE_DWG_PUBLISHED_DIRECTORY` to the absolute
host and that fresh output directory. From `platform`, run:

```sh
NODE_OPTIONS=--no-experimental-webstorage npm run test:e2e:drawing-workspace-m1:local
```

The existing runner supplies isolated loopback database/Storage credentials,
builds the app/collaboration service, and cleans up its marked disposable stack.
The scenario imports native examples, completes independent review/approval,
checks same-request retry and dialog reopening, runs two real workers, verifies
all four downloads, and crosses a real lease deadline on separate connections.
It does not qualify externally authored customer DWG round trips.

Operational release requires both the database migration and a configured
long-running worker host with the pinned writer. Deploying the web app alone
does not process queued jobs. No production host or deployment is provisioned
by the local test command.
