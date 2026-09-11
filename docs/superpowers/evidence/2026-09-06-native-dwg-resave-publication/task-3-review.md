# Task3 independent review — findings and controller record

Reviewer /root/resave_publication_worker_review, isolated gpt-6-astra/high. Full39086-character exact package read through EOF; no mutation/tests rerun. Spec compliance: Issues found. Task quality: Needs fixes. Critical:none. Important:one below. Minor:one below. Controller independently inspected publisher204–285, including the await241 and missing refusal recheck247–255, confirming the Important finding; it does not conflict with the binding spec and enters fix round1.

## Important — verbatim returned finding

**Shutdown can be discarded immediately before publication.** At platform/app/lukas/lib/drawing-native-dwg-resave-publication.server.ts:241, finishClosed passes the current undefined refusal/failure into the async settleClosedAttempt and awaits its undefined result. A parent abort queued during that await latches worker_interrupted, but the continuation at:247 never rereads refusal: it removes the abort listener and starts publish. This can commit a publication after shutdown was observed but before any publication request began. Avoid the await on the success path—for example, invoke settlement only inside a synchronous if(refusal||failure) branch—then detach the listener and initiate publication without another yielding boundary. Add a deterministic microtask-boundary regression for this handoff. The existing final-control test at drawing-native-dwg-resave-publication.test.mjs:497 returns cancellation from control itself and does not cover this gap.

## Minor — deferred to final whole-unit triage

**Pending-poll cleanup and competing-refusal coverage are incomplete.** The cancellation test at platform/tests/drawing-native-dwg-resave-publication.test.mjs:270 observes the poll refusal before releasing the POST. It therefore cannot detect removal of the pending-poll await at publisher:233, and no test holds a readback while control refuses or verifies that a later refusal cannot replace the first. Add controlled promises for these boundaries; the corresponding production logic otherwise appears correct.

## Strengths / checks

- Production artifact builder, strict validators and literal independent test sequences; sequential upload/read and no-POST closed replay (publisher276/300/318, tests209/270/327/403/463).
- Actual typed confirmed Storage errors only; unknown upload never closes/fails/acks (publisher321).
- Lost stage exact-close and conservative uncertain closure, independent5s cleanup (91/312).
- First-refusal latch, pending-poll await and exact publish replay identity present (188/228/249), subject to handoff gap above.
- Dependency capture and synchronous buffer snapshot confirmed in unchanged artifact core188 (publisher176/372).
- Narrow native-only helper extraction preserves deadline/firstrefusal (worker80/128/211).
- Focused unchanged SQL checks: historical close142, committed replay before live-lease admission182 in20260906130844. No broad crawl/gitdiff or identical116test rerun.

Cannot verify from delta: actual CLI/native/Auth/DB/Storage/full-stack/source-free E2E remain Tasks4–5; controller initial full build and116tests passed at exact initial hashes but do not resolve this new race. No initial Task3 acceptance.
