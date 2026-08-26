# P4 Task 6 rereview fix report

Base: `0c62ff150812081c1b71edf6584b465a6924a362`

Prior reviewed fix: `4c9c798f9857d48330915ad2b9a699ce68249488`

## Mounted browser vertical

The integrated Chromium test no longer imports drawing commands, tools,
document stores, Yjs adapters, or preview fixture modules to create a detached
state. It operates the rendered workspace through native buttons, menu items,
canvas pointer/keyboard events, inspector inputs, panel controls, download UI,
and checkpoint restore UI.

The development-loopback-only `verticalTest=1` preview flag adds a small
observable snapshot output and two mounted command probes. The invalid wall
shrink probe calls the live collaboration command bridge owned by the mounted
workspace. The viewer probe calls the same mounted `applyCommand` callback used
by production controls. Neither probe constructs another document store or
mutates state outside the mounted workspace.

One passing workflow now verifies:

- all six semantic tools author wall, hosted opening, space, area, grid, and
  arc through rendered controls;
- the authored graph reloads from real Yjs/IndexedDB with exact object IDs,
  object order/content, and operation order;
- inspector thickness edit, wall keyboard move, hosted-opening follow,
  opening pointer move, invalid shrink rejection, and native undo/redo;
- peer selection and advisory lock rejection, provider retry/reconnect UI,
  and no loss after returning to the real persisted workspace;
- native layer lock prevents the wall move, and the mounted viewer-direct
  mutation is rejected;
- real review freeze hides mutation UI and the simulated action failure
  releases it;
- PDF download parses and renders with non-white content;
- changed checkpoint restore returns exact object content, opening host
  references, Room/Door/Finish schedules, and SVG bytes, then survives reload;
- durable PDF and IFC source SHA-256 values remain unchanged around the same
  workflow.

The remaining `page.evaluate` calls render already-downloaded PDF bytes and
dispatch the browser `online` event. They do not import or mutate drawing
state.

## Offline/action acknowledgement boundary

The 100-operation test still uses Playwright's real network offline state,
the production command bridge, `DrawingOutbox`, Yjs, and IndexedDB. It closes
and reopens every store and compares exact ordered operation, outbox, pending,
and object ID sets.

After network reconnect, 100 real local action requests are acknowledged and
the outbox is empty. The test does **not** write `operationStatus`. Because no
disposable PostgreSQL-backed collaboration authority/provider is configured,
all 100 operations correctly remain pending and the server-owned status map
remains empty. Authority-to-provider convergence is **UNEXECUTED**, not
simulated or claimed.

## Hosted-cut visual gate

The inverse-ID SVG, PNG, and rendered-PDF sample is now at `(40, 36.5)`, inside
the wall body (`y=36..40`) and inside the void opening. Disabling the existing
dependency ordering as a temporary mutation made the focused browser test fail
with black `[0, 0, 0, 255]` instead of white `[255, 255, 255, 255]`. Restoring
the implementation made the same test pass.

## Scope and boundaries

- No dependency, lockfile, migration, RPC, protocol, operation kind, semantic
  CRDT, or state manager was added.
- The test instrumentation is available only from the existing development
  loopback preview query.
- The local retry connection remains a lifecycle fixture; it is not presented
  as a provider-authoritative convergence proof.
- Production PostgreSQL concurrency, hosted collaboration, deployment, and
  latency remain **PRODUCTION UNEXECUTED**.

See `task-6-fix2-evidence.txt` and the two visually inspected fix2 screenshots.
