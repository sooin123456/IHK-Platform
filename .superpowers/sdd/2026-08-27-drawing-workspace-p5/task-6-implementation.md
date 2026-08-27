# Task 6 implementation and evidence

- Commits: `46b52d0` (vertical/release/outbox transport), `d4d51ef` (distinct PDF pair).
- Focused gates: Node/license 25/25, offline/collaboration/source 97/97,
  typecheck/build PASS, production-build Chromium 3/3.
- Fixtures: current PDF 62,602B `4dbe58…`; synthetic prior 63,118B `ea75a7…`;
  real IFC 413,681B `db372f…`. Metadata and served bytes match; all before/after hashes match.
- Browser evidence: visible diff marker, 115 IFC elements/#2863 selection, one IFC fetch,
  offline unlink/undo/reload/ordered ACK, durable outbox 0, Viewer denial, cleanup 0 canvas.
- Measured first usable 10,775.4ms: 2,500ms target NOT MET. P7 60fps UNEXECUTED.
- Exact composed P0–P4 gate NOT MET due the existing full-suite PDF diff worker race
  (980 pass, 1 fail, 1 skip; standalone 3x PASS). Production is UNEXECUTED.
- Four dirty P4 files were restored byte-exact; audits and Task 5 files were excluded.
