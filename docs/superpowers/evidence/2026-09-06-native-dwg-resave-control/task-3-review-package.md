# Task 3 exact review package

Read task-3-brief.md, task-3-runtime-notes.md and task-3-report.md, then these five frozen deltas once. Baselines for modified files are the exact controller-owned pre-task copies, not HEAD; new files use /dev/null. All paths refer to the authoritative universal-workspace-m1 worktree. Compare frozen hashes from the report before review. No edits, broad repo scans, private .superpowers/sdd access or redundant test reruns.

1. task-3-delta-1.patch: new execution bridge.
2. task-3-delta-2.patch: narrow resaver-only cleanup confirmation metadata.
3. task-3-delta-3.patch: bridge behavioral tests.
4. task-3-delta-4.patch: public synthetic actual sandbox bridge test.
5. task-3-delta-5.patch: cleanup confirmation regressions.

The binding design and Task 2 interfaces may be consulted for concrete cross-boundary risks. Task 1 and Task 2 are independently accepted; unrelated dirty changes are out of scope. Assess both spec compliance and quality, particularly fail-closed control races, exact claim identity, uncertain cleanup and response-buffer mutation. Actual native tests use finite service control; real PostgreSQL Task 2 evidence is separate. This unit does not publish artifacts or wire execution UI.
