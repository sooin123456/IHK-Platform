# Universal Workspace Upload Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining malformed/ambiguous TUS resume boundary, make the five-scenario M2 local Chromium authority independent of shell secrets, and deploy the resulting upload-runtime correction after the complete production-shaped gate passes.

**Architecture:** Keep the existing actor/project browser journal as the sole trusted resume identity and make TUS candidate discovery consume that exact path. Keep the existing P4 fixed-loopback browser authority and add its missing server-only test key rather than changing production Supabase initialization or adding infrastructure.

**Tech Stack:** React Router 7, React 19, TypeScript, `tus-js-client`, Supabase JS, Node test runner, Playwright, Vercel.

**Spec:** `docs/superpowers/specs/2026-08-31-universal-workspace-estimator-vertical-slice-design.md`

## Global Constraints

- Original PDF, DXF, IFC, and other source bytes remain immutable; upload recovery may only choose an exact already-journaled object path or a fresh non-upsert path.
- Viewer authority remains read-only and all existing server/RLS checks remain unchanged.
- Browser recovery must survive reload/relogin without choosing a different stale upload for the same filename, size, and MIME type.
- Local functional-browser configuration must be fixed to loopback, must not inherit an external service-role secret, and must never expose a service-role value through a `VITE_` variable.
- Add no dependency, alternate uploader, state store, collaboration transport, cleanup worker, `.env` file, or parallel implementation path.
- The shared worktree is already linked and dirty. Preserve existing work; do not stage or commit. Review exact saved blobs and scoped diffs.
- Run commands that generate or consume `.react-router/types` sequentially.

---

### Task 1: Journal-bound TUS resume selection

**Files:**

- Modify: `platform/app/lukas/lib/project-file-upload.ts`
- Modify: `platform/app/lukas/screens/project.tsx`
- Test: `platform/tests/project-file-upload-resume.test.mjs`

**Interfaces:**

- Consumes: validated `savedPending?.storagePath` from `handleSourceUpload`.
- Produces: optional `resumeStoragePath?: string` input on `uploadProjectFileResumable` and exact-path candidate selection.

- [x] **Step 1: Add failing real-behavior tests**

  Extend the existing fake TUS boundary with literal candidates A and B. Cover numeric `metadata.objectName`, both A/B enumeration orders with trusted A, trusted A with only B, and no trusted path with an old candidate. Positive recovery calls provide `resumeStoragePath: previousPath`.

- [x] **Step 2: Run RED**

  Run:

  ```bash
  cd platform
  node --test tests/project-file-upload-resume.test.mjs
  ```

  Expected: the new cases fail because the current predicate accepts a non-string path or chooses the first otherwise-valid candidate without the journal identity.

- [x] **Step 3: Add the minimum selector boundary**

  Extend the existing argument object with:

  ```ts
  resumeStoragePath?: string;
  ```

  Pass `savedPending?.storagePath` from the sole product caller. Require the candidate path to satisfy:

  ```ts
  typeof candidate.metadata.objectName === "string" &&
    candidate.metadata.objectName === resumeStoragePath;
  ```

  in addition to every current origin, namespace, size, MIME, and parallel-upload check.

- [x] **Step 4: Run GREEN**

  Run the same focused Node test and require zero failures.

### Task 2: Self-contained local M2 browser authority

**Files:**

- Modify: `platform/scripts/drawing-p4-browser-authority.mjs`
- Test: `platform/tests/drawing-workspace-p4-release.test.mjs`

**Interfaces:**

- Consumes: the existing fixed loopback P4 authority environment.
- Produces: server-only `SUPABASE_SERVICE_ROLE_KEY=p4-local-browser-gate-service-role` for the preview web server.

- [x] **Step 1: Add the failing authority assertion**

  Add an inherited external service-role value to the existing fixture and assert the returned environment contains the exact local value, differs from the inherited value, contains no `VITE_SUPABASE_SERVICE_ROLE_KEY`, and that mutation of the server-only value is rejected.

- [x] **Step 2: Run RED**

  Run:

  ```bash
  cd platform
  node --test --test-name-pattern="P4 functional browser authority" tests/drawing-workspace-p4-release.test.mjs
  ```

  Expected: assertion mismatch because the external value is still inherited.

- [x] **Step 3: Add one fixed server-only value**

  Add `SUPABASE_SERVICE_ROLE_KEY: "p4-local-browser-gate-service-role"` to the already-fixed loopback environment and its assertion function. Do not add a Vite-prefixed equivalent.

- [x] **Step 4: Run GREEN and the five browser scenarios**

  Run sequentially:

  ```bash
  cd platform
  node --test --test-name-pattern="P4 functional browser authority" tests/drawing-workspace-p4-release.test.mjs
  npm run test:e2e:drawing-workspace-m2:local -- --reporter=line
  ```

  Expected: focused test passes; Playwright begins and passes all five configured tests.

### Task 3: Isolate the functional-browser Vite dependency cache

**Files:**

- Modify: `platform/vite.config.ts`
- Modify: `platform/scripts/drawing-p4-browser-authority.mjs`
- Test: `platform/tests/drawing-workspace-p4-release.test.mjs`

**Interfaces:**

- Consumes: the existing P4 fixed-loopback authority passed to the Playwright web server.
- Produces: `P4_FUNCTIONAL_VITE_CACHE_DIR=node_modules/.vite-p4-functional`, consumed only as Vite's server-side `cacheDir` override.

- [x] **Step 1: Add a failing isolated-cache authority test**

  Seed an inherited external cache directory, require the authority to replace it with the exact harness-only directory, require mutation rejection, and prove the resolved Vite configuration consumes that value. Do not use a `VITE_`-prefixed environment variable.

- [x] **Step 2: Run RED**

  Run the focused P4 authority test and require an exact missing/inherited cache-authority failure.

- [x] **Step 3: Add the minimum cache isolation**

  Add the fixed cache directory to the existing authority and assertion, then let `vite.config.ts` use it when present. Keep the default Vite cache unchanged for production and ordinary development.

- [x] **Step 4: Run GREEN and reproduce the previously failing boundary**

  Run sequentially: the focused authority test, the single precision Playwright spec under the P4 functional config, and the complete five-scenario M2 command. Require 1/1 then 5/5 with no missing optimized-dependency warning.

### Task 4: Review, full verification, and exact-artifact deployment

**Files:**

- Modify: `docs/superpowers/evidence/2026-09-03-universal-workspace-production-deployment.md`
- Modify: `docs/superpowers/evidence/2026-09-02-universal-workspace-m2-precision-touch.md`
- Modify: `docs/superpowers/evidence/2026-09-02-universal-workspace-m2-structure-source.md`

**Interfaces:**

- Consumes: reviewed Task 1 and Task 2 working-file blobs.
- Produces: exact current verification and Vercel production deployment identity.

- [x] **Step 1: Independently review all scoped task diffs**

  Require spec compliance, Critical 0, Important 0, and approved task quality. Fix and re-review any blocking finding.

- [x] **Step 2: Run sequential verification**

  Run:

  ```bash
  cd platform
  node --test tests/project-file-upload-resume.test.mjs tests/drawing-workspace-p4-release.test.mjs
  npm run test:e2e:drawing-workspace-m2:local -- --reporter=line
  npm run typecheck
  npm run typecheck:collaboration
  npm run build
  npm run build:collaboration
  npm run test:e2e:drawing-workspace-m1:local
  npm exec prettier -- --check scripts/drawing-p4-browser-authority.mjs tests/drawing-workspace-p4-release.test.mjs app/lukas/lib/project-file-upload.ts app/lukas/screens/project.tsx tests/project-file-upload-resume.test.mjs
  git diff --check
  ```

  The bare `npm run build` receives the same explicit loopback test environment only for local verification; production deployment must use the Vercel production environment.

- [x] **Step 3: Deploy without assigning the primary domain**

  Create one Vercel production-environment candidate from the verified working tree with primary-domain assignment withheld. Record its deployment ID and preceding production deployment as rollback.

- [x] **Step 4: Verify and promote the exact candidate**

  Require Ready status, expected public/auth-route responses, and empty candidate-scoped error/fatal/HTTP-500 scans. Promote only that exact deployment, then repeat alias and runtime checks.

- [x] **Step 5: Record honest evidence**

  Record exact counts and identities. Keep hosted credentialed multi-user, customer DXF, and performance authorities UNEXECUTED unless separately measured.
