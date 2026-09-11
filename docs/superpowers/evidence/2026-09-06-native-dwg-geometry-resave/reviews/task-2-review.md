# Task 2 scoped review

Reviewer `/root/dwg_engine_scope_review`, astra/high. Read-only review of seven hash-matched immutable current-vs-dirty-baseline files. **Needs fixes**.

1. P1 / Important: `QualificationRunner.cs:288` rejects block unknown entities and RootDictionary descendants but misses per-CadObject XDictionary extension dictionaries. Retained UnknownNonGraphicalObject can reach the payload-stripping writer. Traverse retained objects and extension dictionaries with cycle protection; regress an ordinary entity's unknown extension dictionary before earlier mutation/output.
2. P2 / Important: `SelectedDwgEdits.cs:243` clears/recreates all lightweight-polyline vertices with only Location, losing nonzero Vertex.Id even for closure-only edits. Retain per-vertex metadata where correspondence exists, or reject unsafe cases. Regress closure-only and same-count movement with nonzero IDs.

Strict versioned parser, full-batch prospective validation, whole-document point budget, raw ARC behavior, and actual readback tests otherwise sound. No independent runtime reproduction by reviewer. Unknown tests are in-memory only; same-engine synthetic readbacks are not recipient/Auth/delivery qualification. No production caller is an explicit next-unit dependency, not this unit's defect.
