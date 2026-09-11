# Task 2 wire follow-up — Important finding

Root traced a concrete serialization risk after the initial Task2 gate; the same task reviewer independently ruled:

Important [P2]: `server.ts:1049–1058` reconciliationRetry sets message/code/retryable but no reason. Hocuspocus ClientConnection.ts:543–550 serializes only `error.reason`, otherwise permission-denied. Provider.ts:740–742 exposes only that reason. Admission safely closes but explicit retry classification is lost at actual browser boundary.

Reopen Task2 for this narrow issue. Add `reason: "drawing-reconciling"` and an actual socket test proving received reason, empty refused admission and successful explicit token retry after the lease clears. This does not imply automatic UI retry. Task3 happy-path evidence remains valid. No broad re-review or tests were run by reviewer.
