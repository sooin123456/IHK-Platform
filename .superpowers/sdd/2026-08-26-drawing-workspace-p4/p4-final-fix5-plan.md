# Drawing Workspace P4 Real Lease Revocation Plan

**Goal:** Revoke the real local advisory lease when its entity leaves the canonical dependency-aware visible set, with no timer-driven resurrection.

**Architecture:** Keep the existing single publication coordinator and real soft-lock lease. Publication normalization reports pruned lock entity IDs; the workspace atomically releases/removes the matching real lease and cancels its renewal timer. Lease creation remains lazy and requires an explicit user gesture.

**Spec:** `.superpowers/sdd/2026-08-26-drawing-workspace-p4/p4-final-rereview4.md`

## Constraints

- TDD with observed real-lease and mounted failures before implementation.
- No subagents, dependencies, state manager, CRDT, database, or P5 changes.
- Preserve the controller ledger and generated screenshots.

## Tasks

- [x] Add a deterministic fake-clock test wiring real lease objects to the canonical coordinator.
- [x] Observe hidden lease retention fail before implementation.
- [x] Add atomic matching-entity lease release and observe its wished-for API fail before implementation.
- [x] Route canonical pruned lock IDs to real lease removal and renewal-timer cancellation.
- [x] Remove eager empty-lease creation and bind browser UUID generation correctly.
- [x] Use the real lease path in mounted host-hide and capability-loss regressions.
- [x] Run focused/full Node, typecheck, builds, canonical Chromium, diff, and exact local release.
- [x] Commit product separately from report and refreshed evidence.
