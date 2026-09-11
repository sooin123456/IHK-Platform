# Task 3 initial independent review

Reviewer canonical_initialization_socket_review, sol/high, read-only. Spec NEEDS FIXES; no Critical/Minor findings.

Strengths: actual production PostgreSQL/WS first sync before disconnect, exact cached cold restart with raw full-row identity, valid Viewer changed operation deniedP3A02, protected forgery, truthful JWT fixture limitation, credible retained RED/GREEN. Normal runtime teardown closes database/storage.

Important: `platform/tests/fixtures/drawing-collaboration-canonical-initialization.mjs:107` onAuthenticationFailed clears timeout and rejects without destroying its locally scoped provider. Because connect() never returns it, caller cleanup cannot reach it. Hocuspocus only emits authenticationFailed and does not destroy provider; managed WebSocket/connection-check interval can remain active. This violates failure-path cleanup. Destroy provider before rejection or guarantee every unsuccessful settlement destroys it. Gate not approved until fixed. No DB/advisor rerun by reviewer.
