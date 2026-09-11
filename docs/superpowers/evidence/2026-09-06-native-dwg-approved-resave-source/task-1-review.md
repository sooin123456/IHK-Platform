# Task 1 review — spec and quality

Reviewer: /root/approved_resave_source_task_review, gpt-5.6-sol high. Read-only; no tests rerun. Verdict: spec issues, task quality needs fixes.

Important: `drawing-native-dwg-resave-source.server.ts:140/152/188-191/205` normalizes layer/source/object IDs unconditionally, including when historical analysis scope equals approved original scope. A fully rehashed original payload can rewrite all imported identities and pass. `drawing-native-dwg-resave-source.test.mjs:626` reinforces this by treating same-scope ID rewriting as a clone. Require deterministic exact layer/object/source identities for the original; permit verified remapping for differing historical-to-current clone scope. Add negative same-scope ID rewrite proof and retain real differing-scope clones.

Strengths: approved snapshot + live scope + digest, complete report/source/upload linkage, bounded role/RPC errors, immutable flags and reuse of compiler; actual DB approval/clone and poisoned evidence probes.

Cannot independently verify no stage/commit/build/services from scoped diff. Controller captured baseline/current HEAD+index hashes and unrelated file hashes, and runtime ownership reports; this is evidence bookkeeping, not a source-code gap. No Critical or Minor findings. Concrete unchanged checks: compiler envelope, import DTOs, authority hydrator, actor capability helper and existing source/report constraints.
