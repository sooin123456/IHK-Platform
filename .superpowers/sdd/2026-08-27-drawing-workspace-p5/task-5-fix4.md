# P5 Task 5 fix round 4 implementation

Date: 2026-08-27

Base: `46b52d0 test: verify drawing workspace P5 integration`

## Outcome

- PDF compare mode is now the user's desired state, represented by one local `{ mode, generation }` transition.
- One effect owns compare request transitions. A non-current selection made while a load or cancellation is busy remains explicitly pending and submits exactly one fresh `load_pdf_compare` request when the fetcher becomes idle.
- `현재 도면` still immediately discards the transient predecessor capability, diff generation, pixels, and markers, clears the pending request binding, and supersedes an older response.
- The fix3 request/response binding remains authoritative: only the response for the exact submitted revision edge, current and predecessor IDs and SHA-256 values, and page can mount the predecessor.
- A failed capability response marks that user transition settled, so it cannot create an automatic retry loop. A later explicit user selection advances the generation and may retry once.
- No signed URL, request state, pixels, markers, mode, or generation is persisted to operations, snapshots, Awareness, Yjs, IndexedDB, or another store.

## TDD evidence

- RED: with the initial capability response held, `현재 도면` submitted and held cancellation; selecting `겹쳐 보기` during that cancellation left the UI selected but permanently stuck at one load POST, zero predecessor GETs, no mounted predecessor, and disabled calculation after both responses settled.
- GREEN: the same mounted sequence exposes the pending status while cancellation is held, then submits exactly one second load POST after idle and performs exactly one predecessor GET using only the fresh `?capability=queued` URL. The predecessor mounts and calculation becomes enabled.
- Rapid `이전 도면` to `현재 도면` after mounting leaves current selected and predecessor unmounted without an extra load, cancel, or predecessor request.
- A typed capability failure produces one alert and remains at one POST and zero predecessor GETs after settling. One new overlay click performs exactly one retry and one predecessor GET.
- The existing delayed-response regression remains green: current to overlay re-entry performs zero additional `getImageData` calls and restores zero markers; the next explicit `변경 표시 계산` alone performs two reads and restores one non-listening `브라우저 미리보기` marker.

## Verification

- Final mounted lifecycle subset (exact predecessor/diff/Viewer denial, held load plus held cancellation queue, failure settle/retry): **3/3 PASS**.
- Focused P5, server, PGlite database, Awareness, PDF, source command/link, and local-preview suite, serial: **219/219 PASS**.
- PDF transform/diff suite: **17/17 PASS**.
- Relevant serial Drawing suite: **687 PASS, 0 FAIL, 1 existing real-PostgreSQL-dependent SKIP/UNEXECUTED** (688 total, including the already committed Task 6 release contracts).
- Mounted Chromium P5 suite, warm: **10/10 PASS**. The isolated warm IFC lifecycle case also passed **1/1**.
- Cold Chromium note: all six PDF cases passed before the known Vite dependency-optimizer reload caused the IFC exact-fetch case to observe three requests. Warming the optimizer and rerunning the full unchanged suite passed 10/10.
- IFC geometry smoke: **PASS** — 413,681 bytes, 120 elements, 115 geometric elements, 119 placements, 14,694 triangles.
- Application typecheck: **PASS**. Collaboration typecheck: **PASS**.
- Production build: **PASS**, with only the existing large-chunk, mixed IFC import, React Router future-flag, unsigned-theme-cookie, and localStorage warnings.
- Production collaboration spec compiled/listed **5 tests**.
- Prettier check for both changed TypeScript files and `git diff --check`: **PASS**.

Production collaboration execution remains **UNEXECUTED** because `SUPABASE_URL`, anon/service keys, hosted base URL, collaboration URL/token, and deterministic run ID are absent. Real PostgreSQL/Data API execution remains **UNEXECUTED** because `DATABASE_URL`, `DIRECT_URL`, `POSTGRES_URL`, and `P3_E2E_DATABASE_ADMIN_URL` are absent. The fresh and upgrade PGlite authority evidence remains green; this round makes no database or schema change.

## Scope and artifacts

- Changed only the local PDF compare transition owner, two deterministic mounted lifecycle regressions, and this report.
- No dependency, lockfile, migration, schema, generated database type, hook abstraction, store, CRDT/Awareness shape, signed URL persistence, source bytes, or public API changed.
- The browser-generated Task 5 screenshot was restored byte-for-byte from the base commit.
- The four pre-existing P4 dirty artifacts and `.superpowers/audits/` diagnosis capture remain untouched and excluded. Already committed Task 6 product, release, evidence, and documentation files were not modified.
