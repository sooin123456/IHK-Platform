# Controller verification and final review scope

Binding spec: `docs/superpowers/specs/2026-09-06-collaboration-freeze-identity.md`.
Plan: `docs/superpowers/plans/2026-09-06-collaboration-freeze-identity.md`.
Task delta: `task-1-review.diff`; exact candidate hashes: `candidate-files.json`.
No commits: base/head remain `9f5f56d93db325ff935772252f9d4fb64d69f98c`.

Task reviewer approved spec + quality with no findings; see `task-1-review.md`. Implementer report and raw RED/GREEN logs are in this directory.

## Supplemental controller checks

The controller ran `verify-candidate.mjs`, which checks the three candidate hashes before/after all commands, captures stdout/stderr and exits, and records `controller-verification.json`:

- Relevant service/client/freeze/native collaboration regression, 140 tests.
- Unchanged legacy `drawing-collaboration.test.mjs`, 17 tests, via installed Vite SSR alias resolution. Middleware mode, no app build or preview restart; Vite closes in Node test `after`.
- Collaboration `tsc --noEmit`.

Read the final JSON/logs for exact successful output, not this prose as sole proof.

Failed diagnostic attempts are retained and not hidden: direct plain Node could not resolve existing `~` application aliases (`controller-plain-node-alias-failure.log/json`). Initial Vite invocation closed its module runner immediately after registration, so 10 tests passed and 7 deferred tests failed with `Vite module runner has been closed`. Closing in test `after` corrected the controller harness and all17 passed. No production/test source was changed for either diagnostic issue; no failed business assertion was suppressed.

Root additionally checked `git diff --check` on the three assigned files, unchanged prior native protocol17file hashes, and existing preview PID80284/4173 HTTP200. No full app build, actual-browser acceptance, database deployment, or complete-goal claim.

## Final review request boundary

Review the whole bounded unit's integration, not hundreds of pre-existing dirty changes: exported helper in existing server-only dependency graph; all projection consumers; preserved persistence/manifest/authorization invariants; evidence aligns with exact candidate; scope honesty. Use `task-1-review.diff` and complete binding spec. Named concrete call-site risk checks are allowed; do not repeat the whole suite or old audits. Remaining bootstrap/provenance work is documented in `docs/superpowers/evidence/2026-09-06-collaboration-provenance-followup.md`, not implemented/claimed fixed here.

## Rulings (all carried from ledger)

1. Standing user authorization replaces repeated plan approval and commit ceremonies; no stage/commit/deploy inferred. Cost if wrong: local changes await explicit integration.
2. Accept no-op identity churn as a bounded fix, not all reconnect root causes. Cost if wrong/misreported: honest reconnect can still reject; R2 remains open.
3. Use exact dirty baseline and preserve preview. Cost if wrong: user changes could be attributed/regressed; file/index hashes are checked.
4. Retain this private workspace until explicit integration because no commits hold the reports; publish accepted evidence and rulings, do not broadly clean up.
5. Add bridge regression omitted by glob; adds checks without code scope.
6. Use existing Vite alias-aware loading for the supplementary legacy test; do not patch unrelated imports. Cost if wrong: legacy loader behavior could mask test defects; record all diagnostic failures and final17 assertions.

No deferred task-review findings. Canonical initialization, transient-fence admission, live-room transition durability, real logout/offline acceptance, immutable DWG jobs/delivery and R5 packages remain active goal work.
