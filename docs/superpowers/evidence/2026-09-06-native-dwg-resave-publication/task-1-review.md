### Spec Compliance

- ❌ Issues found: imported upload errors can claim definite no-write without sufficient settlement evidence at platform/native-dwg-worker/src/supabase.ts:346 and :375.
- ⚠️ Cannot verify from this task: database fencing, publication/readback sequencing, authenticated downloads, source immutability across the completed workflow, or actual native acceptance. These belong to Tasks 2–5.
- ⚠️ Descriptor project authorization requires the later exact-scope RPC/download integration; the descriptor schema itself has no expected scope argument.

### Strengths

- Artifact builder:188 snapshots native buffers before awaiting attestation reconstruction, checks rebuilt authority, and delegates native identity validation to the accepted decoder.
- Artifact core:99 strictly bounds public receipt fields and preserves experimental-unqualified / not-issued.
- Artifact core:219 preserves exact request/authority text and derives ordered metadata from copied bytes.
- Artifact tests:127 exercise exact staged identity and path rejection.
- Storage tests:29 use real loopback HTTP to verify copied bodies, no-upsert headers, complete readback.

### Important findings (verbatim)

- platform/native-dwg-worker/src/supabase.ts:346: a synchronous exception from invoking injected fetch becomes NativeDwgConfirmedUploadError. An injected function can start a POST and then throw synchronously; invocation failure therefore does not prove no write started. This can let later publication code close the durable upload session while a remote write remains unresolved. Classify exceptions after invoking request as uncertain; reserve confirmed errors for local validation before invocation. platform/tests/drawing-native-dwg-resave-storage.test.mjs:196 currently asserts the unsafe classification and should instead cover a function that starts work before throwing.
- platform/native-dwg-worker/src/supabase.ts:375: every remaining non-OK response becomes confirmed, including the arbitrary 503 response in the loopback test. Fully consuming a response proves response completion, but an unknown backend/proxy failure does not establish that the object was never written or that downstream work stopped. Restrict confirmed classification to responses with an established definite-rejection meaning; retain uncertainty for generic 5xx/unknown errors. Adjust the refusal fixture to represent a definite refusal and add unknown-server-error coverage.

### Checks and assessment

No Critical/Minor findings. Reviewer read exact five-file delta and recovered truncated portions. Named outside-diff checks: claim parser:286, protocol decoder:142 and binding spec artifact/settlement sections. No tests rerun, files mutated, or agents spawned.

Task quality: Needs fixes. The artifact contract is cohesive and well exercised. The upload classification must preserve uncertainty whenever a POST may have started without definite settlement evidence.

### Controller resolution of cross-task checks

Database fencing and publication/readback sequencing map to Tasks2–3; authenticated exact-scope descriptor comparison/download maps to Task4; original-source/actual-native end-to-end evidence maps to Task5. These are not claimed implemented by Task1. Task2/4 must compare the descriptor's full derived project path against authorized scope, not merely schema validity.
