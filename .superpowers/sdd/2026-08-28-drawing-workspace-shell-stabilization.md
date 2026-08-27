# Drawing Workspace shell stabilization

Date: 2026-08-28

## Outcome

- The seven left-panel tabs remain accessible, while only the selected panel mounts.
- The desktop workspace is viewport-bound with strict containment and internal panel scrolling; mobile layout remains unchanged.
- Konva now uses three scene layers: background, committed drawing, and interaction overlay.
- Hidden/zero-size IFC startup defers its automatic fit until the first ready, visible, non-zero viewport. Explicit fit, focus, or camera restore cancels the pending automatic fit.

## TDD and verification

- Initial RED: four focused failures for panel mounting, desktop shell containment, seven-to-three Konva layers, and missing deferred IFC fit behavior.
- Additional RED: explicit focus/restore cancellation was missing from the first fit gate.
- Browser RED: the first desktop run measured `documentY: 1245`, which identified descendant layout overflow escaping the root.
- Final focused Node: 38 passed, 0 failed.
- Typecheck: `react-router typegen && tsc` passed.
- Prettier check and `git diff --check`: passed.
- Final Chromium probe at 1440×900: `documentY=0`, `layers=3`, `tabpanels=1`, `tabs=7`, `buttons=66`, `controls=24`, and computed `contain=strict`.

No dependency, state library, database migration, or database test file was changed by this unit.
