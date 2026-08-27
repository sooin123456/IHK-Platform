# P5 Task 4 implementation report

Date: 2026-08-27

Base: `be51f01`

Commit subject: `feat: integrate IFC focus into drawing workspace`

## Outcome

Implemented the controlled IFC source/view surface in the existing Drawing workspace. The route accepts only strict shareable `view=2d|3d|split` and one UUID `ifc` selection, the server signs only the loaded primary PDF and selected immutable IFC, and the catalog contains identity metadata without signed URLs or storage paths.

The mounted workspace now provides accessible Korean `2D 도면`, `IFC 3D`, and `분할 보기` controls, an IFC chooser, two desktop panes, and narrow-screen tabs. One lazy IFC component remains mounted across view toggles; source swaps/unmounts fence and dispose stale generations, WebGL loss offers a no-refetch retry, and invisible/document-hidden canvases suppress animation frames.

Task 1's exact source contracts drive bidirectional drawing-object/IFC focus. Drawing focus requires the selected IFC file ID and SHA; IFC user selection resolves unique, ambiguous, and no-match states without guessing; programmatic focus carries an origin and cannot select the drawing again; ExpressId fallback is used only inside the already exact file/SHA load. Existing Awareness drawing selections are resolved to renderer-local GlobalIds without changing the Awareness schema.

No dependency, state store, CRDT schema, database migration, copied viewer source, geometry-diff surface, PDF overlay, or relink UI was added.

## TDD record

The implementation was developed through observed RED/GREEN seams:

1. Route and source-bundle tests failed on missing strict view parsing and bundle loading, then passed after adding pre-sign validation, URL-free catalog descriptors, and minimal signing. Review REDs additionally proved that explicit `view=` had been accepted and that a selected/primary IFC was signed in initial 2D; both now fail closed or remain unsigned until a 3D/split request.
2. Focus derivation tests failed on missing exact-file focus and remote-highlight helpers, then passed with file ID/SHA filtering over Task 1 source rows.
3. The local mounted preview test failed on the missing controlled IFC fixture/view state, then passed with a pinned immutable IFC whose signed URL exists only in the loader bundle.
4. Chromium initially failed because the view controls did not exist. After the mounted UI was composed, lifecycle instrumentation exposed six IFC requests under React development Strict Effects. A transient module-local in-flight byte acquisition keyed by immutable source ID/SHA reduced this to exactly one while preserving final-unmount/source-swap abort and cleanup.
5. Bidirectional browser focus initially failed because the mounted preview lacked a deterministic selection seam. The preview-only button now selects the existing linked object through the production selection path; the browser test then proved drawing-to-IFC focus, IFC-to-drawing selection, and remote renderer-only highlight.
6. Full serial Drawing initially exposed one brittle source-text assertion that counted two identical URL expressions. Loader URL parsing had intentionally been centralized; the regression now independently verifies loader and action document scope, and passed before the full rerun.
7. Independent review found a source-swap race after the dynamic `web-ifc` import, camera restoration being overwritten by reframing, and incomplete tab semantics. Each received a failing unit or mounted browser assertion before local resource ownership/generation fencing, focus-before-camera-restore ordering, and complete narrow tab/tabpanel keyboard wiring were added.
8. Making 2D signing minimal initially caused a production-shaped preview RED: the canvas instance changed from `1` to `2` across `3d -> 2d -> split`. The client now transiently retains an already loaded descriptor only while the selected catalog ID and SHA remain exact. A 2D loader response mints no capability but keeps the mounted viewer; source ID/SHA change or deselection still unmounts and disposes it.

## Source and URL boundary

- `parseDrawingWorkspaceViewState` rejects duplicate/unknown view values, duplicate IFC values, and malformed IFC UUIDs with a route `400`.
- `loadDrawingWorkspaceSourceBundle` validates the primary evidence and selected IFC project, immutability, kind, UUID, SHA, byte size, and storage metadata before signing.
- Only the loaded primary PDF and an IFC requested by 3D/split receive five-minute signed URLs. Initial 2D leaves selected and primary IFCs unsigned while retaining their URL-free catalog identity. The catalog has file ID, kind, original filename, byte size, and SHA only.
- Signed URLs remain loader/component props. The URL stores only view mode and selected file ID; neither enters Drawing operations, snapshots, Yjs state, IndexedDB document state, nor Awareness.

## Viewer lifecycle and focus

- The IFC module activates on the first 3D/split visit and remains mounted while switching among modes. Its already loaded descriptor is retained only in transient React state for the exact selected ID/SHA, so later 2D loader revalidation does not dispose it or mint another URL.
- A source key is the immutable `fileId:sha256`; same-source route revalidation does not parse or mount again.
- Byte acquisition is shared only transiently across Strict Effect cleanup/remount, reference-counted, and aborted/deleted after the last consumer. Load generations, selection request IDs, and focus request IDs discard stale completions.
- WebGL context loss disposes the renderer, retains the already parsed IFC model, and retries without fetching bytes again.
- The renderer stops scheduling frames while its pane or the document is hidden. Geometry, materials, observers, listeners, controls, and WebGL context are disposed on renderer replacement/unmount.
- Programmatic drawing focus resolves GlobalId first and same-load ExpressId second. User-originated IFC picks alone can drive drawing selection or the explicit source-link command.

## Mounted Chromium evidence

Command:

```sh
E2E_BASE_URL=http://127.0.0.1:4104 \
  npx playwright test e2e/drawing-workspace-p5.spec.ts \
  --project=chromium --workers=1
```

Result: exit 0, 4/4 passed in 9.8 seconds.

The lifecycle test uses a production-shaped preview whose initial 2D bundle contains the selected IFC identity but no signed URL. It observed zero IFC requests in initial 2D, exactly one on first 3D load, no additional request for `2d -> split`, the same canvas instance across the toggle, no additional request for WebGL retry, exactly one additional request on IFC source swap, and no canvas after choosing no IFC. A separate scenario held the `web-ifc` module import pending, swapped the source, and proved that only the latest generation mounted before deselection/unmount. The narrow/two-page test proved ARIA-linked tabpanels, arrow-key selection, and independent shareable modes in two browser pages. The focus test proved exact GlobalId selection in both directions, stale no-match clearing on programmatic focus, and `ExpressId 2863` as a renderer-local remote highlight from the existing Awareness selection.

Screenshots:

- `.superpowers/sdd/2026-08-27-drawing-workspace-p5/task-4-desktop-focus.png` — desktop split mode after exact drawing-to-IFC GlobalId focus.
- `.superpowers/sdd/2026-08-27-drawing-workspace-p5/task-4-narrow-ifc-tab.png` — narrow split mode with the accessible IFC tab selected.

These screenshots are mounted development-preview evidence, not hosted production evidence.

## Executed verification

Focused route/source/focus/preview suite:

```sh
node --test \
  tests/drawing-workspace-p5-server.test.mjs \
  tests/drawing-workspace-p5-view.test.mjs \
  tests/drawing-ifc-focus.test.mjs \
  tests/drawing-workspace-route.test.mjs \
  tests/local-drawing-workspace-preview.test.mjs
```

Result: exit 0, 42/42 passed.

Full relevant Drawing suite, explicitly serial:

```sh
node --test --test-concurrency=1 \
  tests/drawing-workspace-*.test.mjs \
  tests/drawing-fixture-cleanup.test.mjs
```

Result: exit 0, 672 passed, 0 failed, 1 skipped. The existing real-PostgreSQL-dependent case remained skipped.

IFC geometry smoke:

```sh
npm run test:ifc
```

Result: exit 0; 413,681 bytes, 120 IFC elements, 115 geometric elements, 119 placements, and 14,694 triangles.

Types and production build:

```sh
npm run typecheck
npm run typecheck:collaboration
npm run build
```

Results: all exit 0. The build retains the repository's existing large-chunk and React Router future-flag warnings. The IFC property/model modules remain dynamically loaded by the Drawing workspace; the existing standalone IFC browser still statically imports the property browser.

Format and diff checks:

```sh
npx prettier --write <Task 4 TypeScript, TSX, MJS files>
git diff --check
```

Results: configured formatting applied and no whitespace errors.

## Performance observations

- First 3D activation is deferred and downloads the 413,681-byte pinned fixture once.
- Mounted toggles and WebGL retry perform no IFC network refetch; a real source swap performs exactly one new fetch.
- The fixture exposes 115 rendered geometric elements and 14,694 smoke-test triangles.
- No frame-rate, first-usable latency, memory ceiling, 10k-object/2k-link baseline, or production GPU claim is made in Task 4. Those measured release gates belong to Task 6.

## Preserved worktree state

The following pre-existing P4 dirty files were neither reset nor included in the Task 4 commit:

- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/progress.md`
- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/task-6-desktop.png`
- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/task-6-fix2-integrated-authored.png`
- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/task-6-fix2-integrated-restored.png`

## Independent code review

The first independent review reported 0 Critical, 4 Important, and 1 Minor findings. All were reproduced or covered with RED assertions and fixed: stale IFC initialization ownership, initial-2D signing minimization, camera ordering, explicit empty view rejection, and narrow tab semantics. A second review exposed the interaction between minimal 2D signing and mounted viewer retention plus primary-IFC signing; the production-shaped preview produced the expected canvas-remount RED before the exact ID/SHA retention fix.

Final rereview result: **0 Critical, 0 Important, 0 Minor — READY**. The reviewer independently confirmed that null, ID, SHA, or kind changes drop the retained descriptor while `3d -> 2d -> split` preserves the exact mounted viewer without newly minting or fetching a URL.

## Residual gates

- Hosted signed-URL expiry/refresh, storage CORS, production GPU/WebGL recovery, and a real two-user collaboration provider remain unexecuted; the mounted tests use the loopback preview and pinned remote IFC.
- Task 6 owns production authority, real-provider, source-byte invariance, 10k-object/2k-link performance, and release evidence.
- Task 5 owns PDF overlay/diff markers and link/unlink/relink review UI; none is implemented here.
