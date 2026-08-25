# P3 Task 5 report — Yjs draft adapter and y-indexeddb recovery

## Outcome

- Added a reducer-backed `DrawingDraftAdapter`; `DrawingDocumentState` remains the only projection and no second React store was introduced.
- Local preparation is side-effect free. `appendDurableLocal` is the explicit post-outbox seam and appends one immutable Yjs ledger transaction.
- Server metadata/status stays read-only to the client API. Ack ordering/result versions, provisional conflicts, actor histories, checkpoint boundaries, malformed rooms, and duplicate authoritative sequences are validated before publication.
- Added revision-scoped browser persistence with local-sync gating, explicit flush/dispose, SSR no-open behavior, and synchronous listener removal on IndexedDB version change.
- Live workspace/provider/outbox wiring was intentionally not added; that remains Task 6.

## Review fixes

- Canonical operation order now de-duplicates identical durable IDs after a genuine two-document Yjs merge. Client, shared protocol, persisted-room validation, and live service update validation use the same canonical ledger while still rejecting rewrites, deletion/reinsert ordering, forged actors, and distinct-operation loss.
- Client full-room projection now requires exactly the same four top-level Yjs collections as the collaboration service.
- The Chromium harness no longer writes `serverMeta` or an unknown recovery collection from page code. It consumes a server-origin authoritative update, authors 100 canonical operations through `prepareLocal`/`appendDurableLocal`, then reopens persistence and a real adapter. Frozen recovery uses a valid authoritative frozen room with a real pending envelope.

## TDD evidence

### RED

- `node --test tests/drawing-yjs-draft.test.mjs`: 0/8 because the adapter module did not exist.
- Planned Chromium command: 0/2 because the persistence module did not exist.
- Version-change regression: 0/1 with `InvalidStateError` when a closed database still received a Yjs update.
- Authoritative result mismatch: failed because result versions were initially not checked.
- Forged inverse: failed because an integrity error was initially classified as a provisional collision.
- Duplicate authoritative sequences: failed because duplicate Postgres order was initially tie-broken rather than rejected.
- Fresh-server Chromium rerun exposed a Vite-internal `/@id/yjs` dependency; the test was changed first to require a stable module-owned Y.Doc factory and failed until that API existed.
- Review RED: same-ID two-document merge quarantined in both arrival orders; a rogue top-level map was accepted by the client; protocol/service rejected the idempotent merged ledger; and the replacement Chromium adapter fixtures were 0/2 until authoritative initial updates were applied through the server-origin document seam.

### GREEN

- `node --test tests/drawing-yjs-draft.test.mjs`: 13/13.
- `node --test tests/drawing-yjs-draft.test.mjs tests/drawing-document-store.test.mjs tests/drawing-workspace-commands.test.mjs tests/drawing-workspace-outbox.test.mjs`: 147/147.
- `SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=local-anon-key VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=local-anon-key npx playwright test e2e/drawing-yjs-indexeddb.spec.ts --project=chromium --workers=1`: 2/2.
- Chromium recovery covered 100 operations over five simulated offline-minute buckets, exact operation/object ID preservation, local-before-network ordering, revision scope, frozen evidence, version-change close, and zero requests to the fake Supabase endpoint.
- `npm run typecheck -- --pretty false`: pass.
- `npm run typecheck:collaboration -- --pretty false`: pass.
- `git diff --check`: pass.
- Review GREEN: protocol, service, adapter, command, document-store, and outbox suite 184/184; real Chromium 3/3 with canonical adapter state, two same-origin browser realms sharing IndexedDB, and no quarantine.

## Honest gates

- Task 5 does not connect Hocuspocus or replace the workspace command lifecycle; Task 6 owns that integration.
- Production Supabase, deployed collaboration networking, multi-browser latency, and production RLS were not exercised by this local adapter task.
- The Node runner emits its existing experimental `localStorage` warning from the Yjs dependency; SSR returns `null` before opening IndexedDB.
