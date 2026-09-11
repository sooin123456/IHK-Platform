# Task3 existing execution seams

See the binding Task3 brief/design for interfaces. No Task3 implementation exists yet. Root is the authoritative universal-workspace-m1 linked checkout; no build/install/preview mutation or private artifact access.

## Actual native prerequisites

- Docker `/opt/homebrew/bin/docker`, socket `unix:///Users/h/.colima/default/docker.sock`.
- Image `sha256:c921c67ddb37d2a57969d04c7a4983f6d847e0b89901403e3b015ac25bf566ae`, labels reader1hk-dwg-import/1 and resaver1hk-dwg-resave/1 verified by controller.
- Public synthetic DWG `docs/superpowers/evidence/2026-09-06-native-dwg-resave-protocol/controller/actual/source/synthetic-input.dwg`; source SHA256 `bcc54d3c768444c9ade41a23e4ef2b9f5b5668d9972522ee4a4adbc98c670434`. Never overwrite it. Use an owned fresh evidence directory under `/tmp/1hk-resave-control-m6Q9WS/` whose specific child does not yet exist.
- Existing resave-sandbox-integration test requires a historical engine DLL and has requestBytes assigned in an earlier test; do not run just its third test with guessed private prerequisites. New worker-sandbox test should be self-contained and explicit-opt-in. No native rebuild is needed to read the public source with the cached image.

## Reuse, not duplication

- `runIsolatedNativeDrawingDwgResaver({dockerPath,dockerHost,imageId,sourceBytes,expectedSource,requestBytes,expectedRequestSha256,signal,timeoutMilliseconds})` returns strict `{report,reportBytes,dwgBytes}` and performs owned process/container cleanup internally. Preserve its lifecycle; add only the design's cleanup-confirmation error metadata. The old generic rejection cannot distinguish abort from failed cleanup. Do not use execution-aborted signal for control/ack; do not acknowledge settlement when native cleanup is unknown.
- `createNativeDrawingDwgImportSourceTransport(config).downloadSource({source,signal})` is the existing actual source transport. It validates source shape/status/origin/content length and uses fetch redirect:error and cancellation. Its signature takes one object; do not silently invent a positional adapter.
- Reuse `encodeNativeDrawingDwgResaveInput` and strict report/protocol validation to independently compare returned source/request/report bytes/DWG hash/header; no duplicate native geometry semantics.
- Build test authority from the existing test fixture plus the real reader report and `buildNativeDrawingDwgImportPlan`, following allFiveEntityFixture's canonical layers/objects/sources setup. Keep source receipt/report hashes and analysis scope consistent and rehash exact snapshot. Make a real supported LINE edit, then use the production attestation builder. This proves execution mechanics, not actual database approval/Auth.
- For cancellation while the native process is truly alive, the accepted sandbox test's forwarding-shim pattern starts the real container without attaching stdin, records the exact daemon ID and waits before attach. The native reader/resaver awaits input. Independently assert container State.Running before requesting cancel; the new worker's poll must abort its execution signal and cleanup must remove the exact owned container before cancellation acknowledgement. Never invent native report/output or mutate unrelated containers.
- Keep a separate test of successful prepared native output if useful to ensure fixture/attestation consistency; prepared is internal only, never a receipt or downloadable completion.

The actual bridge cancellation test can combine controlled in-memory service RPC replies with the real native process. Label that boundary honestly; actual database cancellation races are proved separately in Task2, and full Auth/Storage/browser acceptance remains a later unit.

Controller already ran a successful real reader→Task1 attestation→resaver→reader probe without rebuilding, using `/tmp/1hk-resave-control-m6Q9WS/attestation-native-probe.mjs` and task1-actual-attestation-native.log. Its fixture construction is reusable reference for the new actual worker test, not a substitute for that test. Source10987bytes, literal LINE4A(10,11)→(120,21), other projected entities/layers/source unchanged; synthetic approval only.

## Consumer checks before dispatch

- Task2 service failure/ack response is now explicitly `{jobId,attemptNumber,leaseToken,status}`; the binding design records allowed statuses. Validate all identity fields, not just jobId. Do not confuse this private settlement with a public download receipt.
- The full verified source has Storage fields; sandbox expectedSource is the strict three-field `{sha256,byteSize,headerVersion}` subset. Reuse types without passing the full record into that strict schema.
- Keep the first refusal/uncertainty latched across asynchronous boundaries; a later continue or successful abort-ignoring result must not undo it. Never return from a timeout race while pretending the native cleanup promise has settled.
- Source transport passes AbortSignal but a deliberately abort-ignoring test double can remain pending. Cover late resolution and wait for owned execution settlement; do not invent cleanup success for a promise still pending.
- Snapshot returned native bytes/metadata before another await or revalidate after it so delayed mutation cannot evade exact output identity checks. Report object must match reportBytes; protocol markers remain experimental-unqualified/not-issued.
- Exact pre-Task3 baseline hashes: sandbox source87e62b6ddea49c0af38cc37a0681d6a587812106f3ecdef4b646bf503153f54c and resave-sandbox test3a49aa4dfe29eabca946b3ceb806f2e7ed08da1dcd6ded2743b4c0cf10e53f87. Saved copies in the owned temporary directory were hash-verified against source.
