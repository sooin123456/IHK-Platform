# Exact controller rulings

Ruling: User has repeatedly said to implement without further approvals. Execute current local scope; omit approval/commit menus. Cost if wrong: scope remains bounded to source and owned local test fixtures, no externally visible writes.

Ruling: Authorized Viewer initialization, including absent approved revision, is trusted canonical serialization and is permitted; ordinary editor store remains forbidden. Service absent bootstrap stays draft-only. Cost if wrong: readonly reads could be unnecessarily denied or ordinary authorization weakened; dedicated DB and server tests are required.

Ruling: Initial insertion can occur under an existing freeze lease because it only establishes active/null origin and never changes lease or existing state. Browser admission must reject transient unpersisted fence. Cost if wrong: divergent client CRDT origins; actual concurrency and admission tests required.

Ruling: No live-room transient projection or legacy divergent cache recovery claim in this unit. These remain R2 follow-ups; R4/R5 remain full active goal requirements.

Ruling: Add Task 3 as bounded integration acceptance so actual SQL/adapter/socket seam is exercised, not just separate SQL and fake-storage tests. No new feature scope or dependencies. Cost if omitted: an adapter signature/mapping error could pass unit tests. Task 2 agent notified; no concurrent implementation dispatch. Task 3 pending after Task 2 gate.

Ruling: Expand narrow Task2 acceptance to wire serialization; local retryable property alone was insufficient. Cost if left: transient review state misreported as permission failure. No authorization loosening or transport framework replacement.

Task2 fix1 additional load-bearing finding: actual wire RED revealed failed Hocuspocus load never registers payload document, so upstream unloadDocument skips destroy and leaves its Awareness interval. Root confirmed upstream unloaded-map guard. Ruling: production onLoad failure must destroy its never-admitted payload in catch; add cleanup assertion, don't merely clean it in test and hide leak. Same server.ts ownership/initial-admission resource boundary; no dependency patch. Cost if ignored: each legitimate transient refusal retains timers/documents.

Ruling: Read-only analyst proposed replacing existing service first-boot test as divergent origin. Root checked actual client initializer: it creates empty collections only, does not write protected metadata. Keep existing pending-operation first-boot coverage and add separate canonical restart test. Cost if ignored: lost regression coverage and false diagnosis. Other focused findings (detached preparation, P3S04 rebuild, validation/receipt finally cleanup) accepted into Task 2 context.
