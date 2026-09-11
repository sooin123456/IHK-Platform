# Existing preview shell failures — bounded follow-up diagnosis

This is a diagnosis, not a completed correction or whole-suite acceptance. It was prepared while the separate lifecycle/restore unit was being verified. Do not loosen assertions or claim the preview suite is green.

## Reproduction

The exact pre-task copies of `drawing-workspace.tsx`, `local-drawing-workspace-preview.tsx` and `drawing-workspace-shell.spec.ts` were restored only in the owned runtime `/Users/h/1hk-r2-restore-uvc74K`. Its development server used port 5198. The authoritative dirty checkout and original preview 4173 were not reverted/rebuilt.

- Baseline: 8 passed, 8 failed.
- Changed shell including the new lifecycle case: 8 passed, 9 failed.
- The extra failure was a console HTTP 500 in the compact split-view test. Independent response capture reproduced the identical `http://127.0.0.1:5198/__p5-current.pdf` 500 on both baseline and changed source. The baseline test can finish before this asynchronous request fails; its initial pass is not proof that the fake PDF exists.
- The new actor lifecycle regression and the existing local-edit/revalidation/actor-reset/read-only regression pass independently. They do not qualify the whole preview suite.

## Concrete next corrections

1. **Default mode expectations:** `drawing-workspace-view.ts` defaults to 2D. The desktop test must explicitly request split mode before expecting IFC. Authoring mode ends at Blocks; History is a Review panel. Test the actual mode-specific End/Home contract.
2. **Permission/recovery expectations:** the Line tool is intentionally retained inside a disabled fieldset while writable authority exists but local editing is unavailable. Assert disabled and then enabled on retry, not absent.
3. **Radix menu semantics:** the installed DropdownMenu gives content an `aria-labelledby` pointing to the trigger, which takes precedence over `aria-label`. Query its actual trigger-derived name unless deliberately changing the product name. Open with keyboard ArrowDown when testing first-item focus; pointer opening deliberately suppresses that focus.
4. **Awareness fixture selection:** `awarenessTest` is absent from `legacyPreviewTest`, selecting canonical P5 and its fake PDF while the canonical branch suppresses `awarenessPreviewHarness`. Repair the intended fixture routing without discarding the compact split test's IFC requirement. Supply a portable PDF where canonical P5 actually requires one; do not allowlist a missing-source 500.
5. **Lazy export dialog:** the test repeatedly clicks and allows only 250 ms for lazy dialog mount. A late successful open hides the launcher, making the retry fail. Click once and wait for the dialog. This diagnosis is source-supported but has not been independently reproduced with a controlled lazy-load delay.
6. **Actual overflow remains:** baseline and current runs both measured `scrollWidth=243` against `clientWidth=239`. Preserve the strict no-overflow assertion. Inspect descendant bounds before fixing CSS; the scale control's flex input/label row is a suspect, not yet a proven cause.

`r2_connection_review` independently inspected these tests, current mode/fixture implementation and installed Radix behavior read-only. No UI implementation change is included in this diagnosis. Raw local logs are under `/tmp/1hk-r2-restore-x55wft/` (`shell-baseline.log`, `shell-final.log`, `compact-http-baseline-diagnostic.log`, `compact-http-diagnostic.log`).
