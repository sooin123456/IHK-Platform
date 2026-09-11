# M4 OSS DXF Interoperability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current bounded DXF importer accept a pinned real MIT-licensed `dxf-parser` fixture whose unused AutoCAD extent sentinels are currently misclassified as drawing coordinates, without weakening coordinate-bomb protection.

**Architecture:** Keep `dxf-parser@1.1.2`, the server-only adapter, existing operation/outbox persistence, and all current limits. Redistribute one pinned upstream fixture with explicit MIT provenance. In parsed-header preflight, exempt only the complete exact `$EXTMIN=(1e20,1e20,1e20)` and `$EXTMAX=(-1e20,-1e20,-1e20)` pair; every other header value, raw entity, parsed entity, and converted coordinate remains bounded.

**Tech Stack:** TypeScript, Node.js, `dxf-parser@1.1.2`, Node test runner, existing Playwright M1–M4 release harness, Vercel.

**Spec:** `docs/superpowers/plans/2026-09-02-universal-workspace-m4-source-integration.md`

## Global Constraints

- Do not raise `maxCoordinateMillimeters`, ignore all header extents, or weaken raw/parsed/converted coordinate checks.
- Exempt the sentinel only when both exact uppercase header keys and all three exact numeric axes are present. A partial, altered, approximate, case-folded, or non-finite pair remains subject to normal limits.
- Keep source bytes immutable at runtime and preserve deterministic object/layer/source/operation identities.
- Keep the fixture under `platform/tests/fixtures`; do not publish it as a product template or represent it as customer data.
- Record repository, pinned commit/URL, upstream and local SHA-256, MIT text, local path, byte size, and any line-ending transformation truthfully.
- The OSS fixture proves parser interoperability only. The approved-customer DXF acceptance items remain unchecked and `UNEXECUTED`.
- Add no dependency, alternate CAD engine, client parser, state library, schema, worker, or conversion service.
- The worktree is already linked and dirty. Preserve existing work; do not stage, commit, reset, clean, or overwrite unrelated evidence.

---

### Task 1: Pinned fixture and license provenance

**Files:**

- Add: `platform/tests/fixtures/dxf-parser/extendeddata.dxf`
- Add: `platform/tests/fixtures/dxf-parser/LICENSE`
- Add: `platform/tests/fixtures/dxf-parser/DXF_FIXTURE_NOTICE.md`
- Modify: `platform/THIRD_PARTY_NOTICES.md`
- Modify: `platform/scripts/drawing-p7-license-authority.mjs`
- Test: `platform/tests/drawing-workspace-license.test.mjs`

**Pinned authority:**

- Repository: `https://github.com/gdsestimating/dxf-parser`
- Commit: `0df7a37a4207a1f925b8d0bfffc270ff121446b4`
- Raw file SHA-256: `9b39289e3435fb187eb0e671fb8a07b8728cdf69a0275836f67ca005732f781d`
- Raw byte size: `102001`
- License: MIT, Copyright (c) 2015 GDS Storefront Estimating

- [x] **Step 1: Add failing provenance tests**

  Require a distinct `validateDrawingP7DxfFixtureProvenance` boundary, actual local fixture hash/size, pinned source records, full MIT permission/copyright text, and the explicit “OSS interoperability; not customer acceptance” disclaimer. Add corrupted-byte, missing-license, and missing-disclaimer counterexamples.

- [x] **Step 2: Run RED**

  ```bash
  cd platform
  node --test --test-name-pattern="DXF fixture provenance" tests/drawing-workspace-license.test.mjs
  ```

  Expected: the validator/files/notice are absent.

- [x] **Step 3: Add the minimum redistributed fixture authority**

  Add the pinned bytes and MIT text. Add one separate provenance section rather than treating repository test data as part of the npm-package row. Validate local bytes and notices without network access. Do not expose the fixture under `public/`.

- [x] **Step 4: Run GREEN**

  Run the focused provenance test and the complete license test file.

### Task 2: Exact paired-sentinel exemption

**Files:**

- Modify: `platform/app/lukas/lib/drawing-dxf-import.server.ts`
- Test: `platform/tests/drawing-dxf-import-server.test.mjs`

- [x] **Step 1: Add failing real-fixture and security counterexamples**

  Under default limits, require the pinned fixture to produce declared millimetres, one layer `0`, eight deterministic `LINE` objects with handles `38`–`3F`, eight `STYLE_NORMALIZED` conversion reports, one deterministic unsupported raw `VIEWPORT` skip, zero blockers, and two operations. Require repeat-run equality. Also prove: exact sentinels plus an entity coordinate above the limit still block; either sentinel alone or one altered axis still blocks; exact sentinels plus a non-finite different header point still block.

- [x] **Step 2: Run RED**

  ```bash
  cd platform
  node --test --test-name-pattern="pinned upstream|extent sentinel" tests/drawing-dxf-import-server.test.mjs
  ```

  Expected: the real fixture is blocked by `COORDINATE_LIMIT`.

- [x] **Step 3: Exempt only the complete exact pair**

  Reuse the already-normalized parsed header. During header traversal omit only `$EXTMIN` and `$EXTMAX` when the complete exact pair matches; continue validating every other header value. Do not change the exported adapter interface or any limit.

- [x] **Step 4: Run GREEN and the full adapter suite**

  ```bash
  cd platform
  node --test tests/drawing-dxf-import-server.test.mjs
  ```

### Task 3: Review, regression, evidence, and deployment

**Files:**

- Modify: `docs/superpowers/plans/2026-09-02-universal-workspace-m4-source-integration.md`
- Modify: `docs/superpowers/evidence/2026-09-03-universal-workspace-m4-source-integration.md`
- Modify: `docs/superpowers/evidence/2026-09-03-universal-workspace-production-deployment.md`
- Modify: `.superpowers/sdd/2026-09-05-m4-oss-dxf-interoperability/progress.md`

- [x] **Step 1: Independent review**

  Require 0 Critical and 0 Important findings for licensing, parser security, deterministic output, and scoped implementation. Fix and re-review blockers.

- [x] **Step 2: Controller verification**

  Run sequentially:

  ```bash
  cd platform
  node --test tests/drawing-dxf-import-server.test.mjs tests/drawing-workspace-license.test.mjs
  npm run typecheck
  npm run build
  npm run test:e2e:drawing-workspace-m1:local
  npm exec prettier -- --check app/lukas/lib/drawing-dxf-import.server.ts tests/drawing-dxf-import-server.test.mjs scripts/drawing-p7-license-authority.mjs tests/drawing-workspace-license.test.mjs THIRD_PARTY_NOTICES.md tests/fixtures/dxf-parser/LICENSE tests/fixtures/dxf-parser/DXF_FIXTURE_NOTICE.md
  git diff --check
  ```

  The existing authenticated M1–M4 browser gate provides persistence/reload/relogin regression coverage; do not duplicate that large flow solely for the new parser-header branch.

- [x] **Step 3: Record honest M4 evidence**

  Add a distinct checked OSS-interoperability item and executed evidence. Leave both approved-customer fixture items unchecked and label them `UNEXECUTED`.

- [x] **Step 4: Deploy the exact verified runtime**

  Create a Vercel production-environment candidate without first moving the primary alias. Require Ready, public/protected route smokes, and zero candidate-scoped fatal/error/HTTP-500 logs. Promote only that exact candidate, repeat alias/runtime checks, and record the prior deployment as rollback.
