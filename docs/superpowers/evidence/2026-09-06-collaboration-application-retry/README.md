# Verification artifacts

Generated test logs, source hashes and exact pre-task delta for the adjacent [unit report](../2026-09-06-collaboration-application-retry.md).

- `baseline-red.log`: final seven socket scenarios executed against the exact pre-task client source, loaded with Node `registerHooks`; current checkout was not reverted.
- `focused-green.log`: eight focused checks after narrowing CLOSE classification.
- `regression.log`: fresh final 166-test integration run.
- `legacy.log`: separate existing 17-test suite, not included in 166.
- `typecheck-app.log`, `typecheck-collaboration.log`: successful silent compiler outputs (exit codes recorded in report).
- `change.diff`: exact unit delta from pre-task dirty-file copies, plus new tests.
- `accepted-files.json`: current and baseline source SHA-256 hashes. New tests have a null baseline.
