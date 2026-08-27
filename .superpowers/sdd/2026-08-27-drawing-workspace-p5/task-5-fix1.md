# P5 Task 5 fix round 1 implementation

Date: 2026-08-27

Base implementation: `e25073a feat: review drawing PDF and IFC revisions`

## Outcome

- Generic `add_anchor` and `deactivate_anchor` no longer replace a revision-review predecessor. The mounted UI suppresses both forms, the drawing-room action derives authority from the posted issue/anchor and database rows rather than `params.fileId`, and the database rejects crafted authenticated Data API INSERT/UPDATE attempts.
- The only replacement path remains candidate focus, a fresh user selection, confirmation, and one `lukas_drawing_relink_issue_anchor` RPC. It preserves exact `replaces_anchor_id` lineage, deactivates the old anchor and activates the new anchor in one transaction, and rolls back on invalid evidence.
- Normal workspace loading returns URL-free predecessor catalog metadata. The existing workspace action revalidates the exact project, immutable files, SHA-256 values, revision edge, and active page before minting one five-minute predecessor capability after compare opt-in.
- Opacity and overlay/previous display-mode changes only update render style. Raster reads and diff calculation now rerun only for an explicit calculation generation or an exact current/predecessor page identity change.
- Local development now serves real no-store PDF bytes at `/__p5-current.pdf` and `/__p5-previous.pdf`, restricted to development loopback. The manual P5 preview works without Playwright request interception.

## TDD evidence

- I2 server RED: normal source loading signed both current and predecessor, and the lazy signer contract was absent. GREEN: initial load signs current only; compare opt-in signs exactly one revalidated predecessor; stale edge/SHA/page requests sign zero.
- M1 mounted RED: after the first explicit calculation, opacity and mode changes increased `getImageData` calls from 3 to 9. GREEN: style changes leave the count unchanged; another explicit calculation adds exactly two reads.
- Initial I1 RED: revision-review issues still rendered generic add/deactivate paths. GREEN: no generic mutation form is reachable before, during, or after candidate selection, including Viewer denial.
- Authoritative I1 RED: PGlite accepted a direct authenticated ordinary replacement INSERT. The cross-route server regression also showed that no route-independent authority guard existed. GREEN: direct INSERT and predecessor UPDATE both fail with SQLSTATE `42501`, cross-route crafted requests are denied from authoritative issue/file evidence, and the predecessor remains the sole active anchor.
- Compatibility GREEN: an unrelated PDF with no outgoing revision edge retains the intended generic add/deactivate behavior.
- Preview RED: neither local PDF resource route was registered. GREEN: both return real `%PDF` bytes with `Content-Type: application/pdf`, `Cache-Control: no-store`, and production/remote requests return 404.

## Database authority

Created exactly one CLI-generated forward migration:

- `platform/supabase/migrations/20260827102503_drawing_workspace_p5_revision_relink_authority.sql`

The private invoker trigger checks immutable predecessor/current file evidence and the authoritative `supersedes` edge. Direct authenticated ordinary inserts for a revision-review issue and direct predecessor deactivation are rejected. The existing security-definer public atomic RPC remains the only allowed replacement boundary. The migration adds no table, public function, management API, store, CRDT field, or client-controlled GUC path; private function execute is revoked from `public`, `anon`, `authenticated`, and `service_role`, with an empty search path and the existing default-ACL posture.

## Verification

- Focused P5/adjacent suite: **87 passed, 0 failed**.
- PDF suite: **17 passed, 0 failed**.
- Fresh authority PGlite: **3 passed, 0 failed** — direct INSERT/UPDATE denial, legacy compatibility, atomic RPC lineage/rollback.
- Upgrade PGlite: **3 passed, 0 failed** — populated P0-P3 preservation, legal P0-P4 source-shape preservation, immutable pre-P5 checkpoint preservation.
- Relevant serial Drawing suite: **681 passed, 0 failed, 1 existing real-PostgreSQL-dependent skip/UNEXECUTED** (682 total).
- Mounted Chromium P5 suite: **8 passed, 0 failed**. This includes no-interception manual PDF resources, opt-in signing, cancellation/cleanup, Viewer denial, diff call counts, PDF/IFC inspector commands, IFC resource ownership, narrow behavior, and focus synchronization.
- Cold Chromium note: the first full run passed the four PDF tests, then Vite dependency optimization caused the known development-only three-fetch IFC reload. The isolated warm IFC run passed 1/1 and the complete warm suite passed 8/8.
- IFC geometry smoke: **PASS** — 413,681 bytes, 120 elements, 115 geometric elements, 119 placements, 14,694 triangles.
- Application typecheck: **PASS**. Collaboration typecheck: **PASS**.
- Production build: **PASS**, with the existing large-chunk, mixed static/dynamic IFC import, React Router future-flag, unsigned-theme-cookie, and localStorage warnings.
- Production collaboration spec: **5 tests compiled/listed**, including cross-route POST denial, direct Data API denial, one atomic POST, exact old/new lineage, rollback, Viewer denial, and source byte hashes.
- Prettier check for every changed TS/TSX/MJS file: **PASS**.
- `git diff --check`: **PASS**.

Production collaboration execution is **UNEXECUTED** because `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `P3_E2E_RUN_ID`, collaboration service URL, and collaboration service token are absent. Real PostgreSQL execution is **UNEXECUTED** because `DATABASE_URL` and a local real-PostgreSQL authority are absent; fresh and upgrade PGlite evidence is complete.

## Scope and artifacts

- No dependency or lockfile, document store, schema version, migration rewrite, CRDT/Awareness shape, signed URL persistence, PDF pixels/markers persistence, source bytes, or public source-management API changed.
- The browser-generated Task 5 screenshot was restored byte-for-byte; no new screenshot is claimed for this fix. The four pre-existing dirty P4 artifacts and `.superpowers/audits/2026-08-27-current-diagnosis/` remain untouched and excluded from the commit.
- The default awareness preview remains unchanged in this fix. Exact decision: Task 6 must add the unified discoverable P5 vertical entry; until then the explicit local manual path is `/workspace-preview/drawing-workspace?p5PdfTest=1`. This fix does not broaden into Task 6.

## Residual gates

- Production collaboration and real-PostgreSQL execution remain environment-gated and must run when disposable production-equivalent credentials are available.
- No Task 6 release or unified-preview work is included.
