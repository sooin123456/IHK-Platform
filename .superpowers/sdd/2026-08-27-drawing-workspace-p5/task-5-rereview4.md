# P5 Task 5 rereview round 4

Date: 2026-08-27

Review target: `f82e38ee96abb9bb499639f315cafa99e3db7623..5bd7c57f02f2392e4365a1a55c165d49b9989801` (fix 4), with the prior Task 5 authority and all three earlier Important regressions rechecked cumulatively.

Verdict: **READY — 0 Critical, 0 Important, 0 Minor.**

## Findings

### Critical

None.

### Important

None.

### Minor

None.

## Closed regressions and transition review

- The round-1 current-only regression is closed. `현재 도면` immediately removes the predecessor capability, resets the diff generation and markers, and a later compare re-entry performs **+0** image reads and publishes **0** markers. Only a new explicit `변경 표시 계산` performs **+2** reads and restores one non-listening `브라우저 미리보기` marker.
- The round-2 discarded-capability regression is closed. The accepted response remains bound to the exact request evidence: revision edge, current/predecessor file IDs and SHA-256 values, and page. In the delayed second-response case, the predecessor GET begins only after the fresh response and uses only its rewritten fresh capability URL.
- The round-3 held load/cancel/re-entry dead state is closed. The user's desired `{ mode, generation }` remains unhandled while the fetcher is busy; once cancellation settles, the transition effect submits exactly one fresh load. The mounted regression observed load POSTs `1 -> 2`, cancel POSTs `1`, predecessor GETs `0 -> 1`, one fresh queued URL, a mounted predecessor, and an enabled calculation control.
- A failed load response settles the handled generation and does not auto-retry. Waiting after failure retained exactly one load POST and zero predecessor GETs; one later explicit same-mode selection advanced the generation and caused exactly one retry and one predecessor GET.
- Rapid non-current mode changes can reuse one still-valid in-flight request for the same exact edge/page, while any intervening current-only transition clears the request binding before cancellation. Source/page changes also clear transient capability, request, pixels, and markers before advancing to current-only state. No stale response path was found that can mount a predecessor for a different source, page, or desired current-only state.
- The transition state remains local React state/ref data. It is not written to operations, snapshots, Awareness, Yjs, IndexedDB, signed-source metadata, or another store. No dependency, migration, schema, generated type, source-management API, or source byte changed in fix 4.

## Independent verification

- All execution used a clean detached temporary worktree at exact `5bd7c57`; the shared implementation worktree was not used as test authority and no production code was edited by this review.
- Focused mounted PDF lifecycle suite: **3/3 PASS**, covering delayed exact response binding, current-only generation reset, held load plus held cancellation queueing, and failure-settle/explicit-retry behavior.
- Mounted Chromium P5 suite: the first development run reached the known Vite dependency-optimizer reload and the IFC exact-fetch assertion observed three requests after the six PDF cases passed. The immediate isolated IFC case passed **1/1**, then the unchanged warm full suite passed **10/10**. This reproduces the previously documented development-only optimizer behavior rather than a fix-4 regression.
- Focused P5/source/PDF/Awareness/server/preview contracts: **83/83 PASS**. Fresh/upgrade PGlite and adjacent database authority contracts: **184/184 PASS**, including direct replacement denial, exact atomic relink lineage/rollback, role and RLS/grant boundaries, and immutable checkpoint/source preservation.
- Relevant serial Drawing suite: **687 PASS, 0 FAIL, 1 SKIP/UNEXECUTED** out of 688. The skip is the existing disposable real-PostgreSQL concurrency gate because `P3_POSTGRES_CONCURRENCY_DATABASE_URL` is unset.
- PDF suite: **17/17 PASS**.
- IFC geometry smoke: **PASS** — 413,681 bytes, 120 elements, 115 geometric elements, 119 placements, and 14,694 triangles.
- Application typecheck: **PASS**. Collaboration typecheck: **PASS**. Production build: **PASS**, retaining only the existing large-chunk, mixed IFC import, React Router future-flag, unsigned-theme-cookie, and localStorage warnings.
- Prettier check for both changed TypeScript files: **PASS**. `git diff --check 38df592..5bd7c57`: **PASS**.
- Browser verification left the committed current and predecessor PDF fixtures byte-stable at SHA-256 `4dbe58c133a1ce84e1b4da4fce93694ec4f69585bed20e71408a86b7f704e326` and `ea75a7e655dee16a460672131424f00112f70467e495f751d77de80e409fc9bc`; the mounted comparison test also re-hashed both in-memory inputs after interaction.
- The production release command exited nonzero with the explicit **UNEXECUTED** credential list. Hosted Supabase, signed-URL/CORS, collaboration service, deterministic two-user run, Storage SHA, and real PostgreSQL/Data API execution remain **UNEXECUTED** because their actual credentials and disposable authorities are absent; they were not represented as passing local evidence.

## Readiness

**READY: 0 Critical, 0 Important, 0 Minor.** Fix 4 closes the final queued-transition defect without weakening exact capability binding or explicit-only diff calculation. Task 5's local code, browser, PGlite authority, IFC, type, and build gates are ready. Production and real-PostgreSQL gates remain explicitly UNEXECUTED and belong to the external release evidence path.
