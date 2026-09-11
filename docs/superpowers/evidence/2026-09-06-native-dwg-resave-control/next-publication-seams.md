# Next-unit reuse map — preparation, not implementation

Read-only bounded inspection by /root/resave_publication_seams, gpt-6-astra/high. No code/test changes or execution, no private evidence access. Binding artifact design/plan still needs to be written; preserve source-free eligibility and experimental/no-persistence-authority markers.

## Existing contracts to reuse

- app/lukas/lib/drawing-native-dwg-resave-worker.server.ts returns internal prepared claim/result after exact recompile, source/output validation, native cleanup and post-native control. Its poll stops before return: publication must control and settle its own upload/readback phase. Derive edit_request/authority bytes directly from exact UTF-8 attestation text, not source-free pretty JSON.
- app/lukas/lib/drawing-native-dwg-worker.server.ts:479–593 implements stage → no-upsert upload → exact size/hash/byte-equality readback → close → publish → receipt identity verification. Reuse the sequence, replacing source_manifest with edit_request.
- native-dwg-worker/src/supabase.ts exports NativeDwgUncertainUploadError and createNativeDwgStorageTransport. POST x-upsert:false; only explicit duplicate becomes exists; uncertain request/body settlement stays typed uncertainty. GET is bounded. Existing source-free schemas/caps are not imported-resave schemas: imported limits DWG200MiB, request2MiB, authority64MiB, report1MiB, compared to source-free DWG100MiB/authority20MiB. Existing runtime cap overrides only lower bounds.
- app/lukas/lib/drawing-native-dwg-download.server.ts resolves server-owned descriptor → bounded hash/size-verified Storage body → second user-authorized descriptor resolution/equality before response. Preserve private/no-store/no-referrer/nosniff, strict GET/scope/query and bounded errors; no browser locator input.

## SQL source-free patterns

Migration20260905185231_drawing_native_dwg_export_jobs.sql:

- stage RPC:697, exact four strict metadata records; project→job→attempt locks, live lease/source, server-generated projects/{project}/native-dwg/{job}/{attempt}/{sha}/{filename}; exact replay only.
- settle upload:825, monotonic open→closed. Exact old-attempt closure after lease/job changes is intentional cleanup, not renewed publication authority.
- publish:859, exact receipt replay; otherwise processing/current unexpired lease/closed uploads/four artifacts/live source; atomic immutable receipt and completed transition.
- private receipt:325 hides locators. Authorized download descriptor:454 joins completed→published attempt→artifact with verified current collaborator/exact approved scope.
- reserved prefix:967; retention manifest/open-upload protection:980,1121,1269. New imported prefix must be explicitly reserved and retained/deleted by corresponding guards.

Migration20260906110304_drawing_native_dwg_resave_control.sql currently has no completed outcome/artifact evidence, and its attempt guard only permits final outcome/finished_at/failure_code changes. Add a narrow guarded upload-state extension or separate session table. Use existing resave locked-job helper/live approved context, not source-free export authority.

## Required targeted acceptance

1. Exact four-artifact restage/replay; changed metadata/path conflict; duplicate objects require exact bytes; corrupt/truncated/oversized readback yields no receipt.
2. Independent sessions: cancel-first denies publication; publish-first leaves one immutable receipt; exact replay recovers it; stale token/attempt cannot publish.
3. Cancellation/revocation/expiry during upload/readback aborts work; late/ignored-abort completion cannot publish. Unknown upload settlement prevents successful close/cancel claims. Native cleanup confirmation alone says nothing about Storage completion.
4. Lost publication reply → exact receipt recovery; failure cannot overwrite completion or invent a new request/attempt.
5. Receipt-only exact-scope downloads, wrong-kind/noncompleted/stale-attempt rejection, final revocation denial and actual authenticated imported-DWG relogin/exact-byte download story.

SQL cannot inspect Storage bytes itself: trusted worker readback is still required. A closed upload records settlement, not revocation of service credentials. Preserve uncertainty explicitly instead of copying source-free generic publication-failure classification. Persistence/provenance evidence is not independent CAD or licensed-corpus qualification. Follow with exact-approved DWG/PDF/BOQ handoff.
