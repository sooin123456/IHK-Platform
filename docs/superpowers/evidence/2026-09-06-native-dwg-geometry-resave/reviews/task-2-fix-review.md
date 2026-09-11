# Task 2 independent scoped fix re-review

Reviewer `/root/dwg_engine_fix_fresh_review`, astra/high; not a code author. **Approve**, both Important findings addressed. No new Critical/Important breakage or out-of-scope observations.

- Unknown rejection: complete pinned registry + extension dictionary/reactor traversal with reference-identity cycles at QualificationRunner292; fail-closed access309–325. SelectedDwgEdits102 runs before mutation and qualification writes.
- Vertex metadata: global nonzero LWPOLYLINE ID rejection at QualificationRunner299; eligible indexed vertex instances preserved at SelectedDwgEdits246. Defaults only for added trailing vertices and explicit removals; v1 gate unchanged.
- Regression coverage at SelectedDwgGeometrySelfTests80/248/299 covers correspondence, extensions/cycles, atomic target/model/block/paper ID rejection, and real binary ID-loss characterization. All five live/snapshot hashes match fix manifest. Reviewer did not rerun reported35/13/1 tests or build.
- Unknown/ID source rejection is in-memory after reading an actual source, not binary-input qualify coverage. Normal five-type write/readback and ID-loss characterization are actual binary tests. Full goal remains incomplete.
