# Drawing Workspace P4 Canonical Awareness Publication Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Subagents are prohibited.

**Goal:** Route every local Awareness state write through one synchronous dependency-aware selection and soft-lock coordinator.

**Architecture:** Add a stable coordinator above the existing frame-bounded publisher. It owns candidate local state, reads render-current canonical selection and visible entity sets for every update/connect/reauthorization, persistently prunes hidden entities, and is the only code allowed to call an Awareness adapter's `setLocalState`. The React workspace retains refs only for current canonical inputs and uses the coordinator everywhere.

**Tech Stack:** TypeScript, React, Yjs Awareness, Node test runner, Playwright Chromium.

**Spec:** `.superpowers/sdd/2026-08-26-drawing-workspace-p4/p4-final-rereview3.md`

## Constraints

- TDD with observed failures before production edits.
- No subagents, dependencies, state manager, CRDT changes, database work, or P5 work.
- Preserve controller ledger and generated screenshots.

### Task 1: Timing-safe publication coordinator

**Files:** `platform/tests/drawing-awareness.test.mjs`, `platform/app/lukas/lib/drawing-awareness.ts`

- [x] Write a failing deterministic-frame test for initial connect, host hide before passive update, reconnect, reauthorization update, unrelated selection, soft-lock pruning, remote state independence, and no resurrection after restore.
- [x] Run the test and confirm stale opening selection/lock publication fails.
- [x] Implement one coordinator with `connect`, `update`, `clear`, `disconnect`, and `getLocalState`; normalize every state synchronously from current canonical refs.
- [x] Run the focused test green.

### Task 2: Workspace integration and mounted proof

**Files:** `platform/app/lukas/components/drawing-workspace.tsx`, `platform/app/lukas/screens/local-drawing-workspace-preview.tsx`, `platform/e2e/drawing-workspace-p4.spec.ts`, `platform/tests/drawing-workspace-p4-release.test.mjs`

- [x] Add a failing static contract requiring zero direct adapter writes and zero legacy publisher/local-ref authorities in the workspace.
- [x] Extend the mounted hidden-host test with a local opening soft lock and remote lock preservation through hide/restore.
- [x] Replace all connect, reconnect, reauthorization, cursor, lease, and passive-effect publications with the coordinator.
- [x] Run focused Node and Chromium tests green.

### Task 3: Gates and handoff

**Files:** `.superpowers/sdd/2026-08-26-drawing-workspace-p4/p4-final-fix4-report.md`

- [x] Run full Drawing Workspace, typechecks, builds, Chromium, diff, and proportionate exact release binding.
- [x] Commit product separately from plan/report/evidence.
- [x] Record honest local, real-PostgreSQL, production, and performance status without staging controller artifacts.
