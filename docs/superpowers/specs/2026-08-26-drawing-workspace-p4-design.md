# 1HK Drawing Workspace P4 Architectural Objects Design

Date: 2026-08-26

Status: approved program scope refined for implementation. The user approved the full P0-P7 program and continuous subagent-driven execution. This phase implements P4 without another product approval gate.

## 1. Outcome

P4 turns the generic P3 editor into a building-aware workspace. Editors can author walls, hosted doors/windows, spaces, generic areas, grids, and arcs; inspect their building fields; derive deterministic length, area, perimeter, and count; and see room, door, and finish schedules. Every edit continues through the existing command, IndexedDB outbox, Yjs, Postgres operation, snapshot, review, and approval lineage.

Visible vertical slice:

`draw wall -> place hosted opening -> draw space -> inspect measurement -> view schedules -> collaborate/offline -> review snapshot`

PDF and IFC source rows, SHA-256 values, and bytes remain immutable. P4 creates only overlay objects and derived drawing evidence.

## 2. Chosen architecture and OSS policy

P4 extends the existing `DrawingGeometry` discriminated union and object/command pipeline. It does not add semantic object tables, a second CRDT tree, another React state manager, or another canvas engine.

Forking a whole planner is rejected because it would replace the proven React Router, Konva, operation, Yjs, RLS, issue, and approval boundaries. Storing semantic meaning only in free-form custom properties is also rejected because wall/opening integrity and deterministic measurement could not be enforced.

The implementation reuses the current Konva and P2 property/schedule seams. OpenPlan3D and Arcada Planner are MIT implementation references for wall-relative openings, segment projection, snapping, and interaction. Their application stores and shells are not imported.

Audited upstream references:

- OpenPlan3D commit `abb5267581d4ca8d4df00f23c94fb55954de9d40`, MIT.
- Arcada Planner commit `131817138b6e02424b9177891a478cfcc5d04904`, MIT.

Any copied or substantially adapted source records repository, commit, file, license, and modifications in `THIRD_PARTY_NOTICES.md`. No new P4 runtime dependency is required.

## 3. Canonical geometry

All coordinates and dimensions are millimetres in the existing world system. Every P4 variant carries `semanticVersion: 1` so an approved snapshot remains reproducible.

```ts
type DrawingWallGeometry = {
  type: "wall";
  semanticVersion: 1;
  start: Point;
  end: Point;
  thicknessMillimeters: number;
  heightMillimeters: number;
};

type DrawingOpeningGeometry = {
  type: "opening";
  semanticVersion: 1;
  hostWallId: string;
  offsetMillimeters: number;
  widthMillimeters: number;
  heightMillimeters: number;
  sillHeightMillimeters: number;
  openingKind: "door" | "window" | "void";
};

type DrawingSpaceGeometry = {
  type: "space";
  semanticVersion: 1;
  boundary: Point[];
  number: string;
  finishes: {
    floor: string | null;
    wall: string | null;
    ceiling: string | null;
  };
};

type DrawingAreaGeometry = {
  type: "area";
  semanticVersion: 1;
  boundary: Point[];
};

type DrawingGridGeometry = {
  type: "grid";
  semanticVersion: 1;
  start: Point;
  end: Point;
};

type DrawingArcGeometry = {
  type: "arc";
  semanticVersion: 1;
  center: Point;
  radius: number;
  startAngleDegrees: number;
  sweepAngleDegrees: number;
};
```

Validation is strict and rejects unknown keys. P4 numeric fields are finite, safely bounded, and have at most six decimal places. Wall/grid endpoints differ. Opening dimensions are positive; sill is non-negative; doors have sill `0`. Polygon boundaries contain 3-4096 points, omit a repeated closing point and adjacent duplicates, have non-zero signed area, and are simple under segment-intersection validation. Arc sweep is non-zero and has absolute value at most 360 degrees.

`DrawingObject.name` remains the wall/grid/area label, room name, and opening mark. Space number and finishes are fixed semantic fields because schedules must not depend on localized custom-property names.

P4 walls are straight centreline segments. Connected walls are multiple objects. All P4 variants are top-level objects; blocks remain limited to the original six P0/P1 primitive geometries.

## 4. Hosted opening integrity

An opening references an active wall in the same revision, project, page/canvas, and layer ownership graph. Its centre offset and half-width must fit inside the host length. A window sill plus height cannot exceed the wall height.

One pure resolver returns host, centre, endpoints, and wall angle. Canvas bounds, hit testing, snapping, drag preview, export, and schedules use the same resolver. Opening drag projects the pointer onto the host and changes only `offsetMillimeters`. Translating a wall changes only the wall object; openings follow without rewriting their rows.

Shortening a wall is rejected if it invalidates an opening unless the same atomic command updates or removes that opening. Wall deletion is blocked by default. An explicit compound deletion removes hosted openings and their property/schedule references before the wall and remains undoable.

Clipboard paste preallocates new IDs and remaps `hostWallId` when the copied wall is present. An opening without a valid same-revision host is rejected. Cross-object semantic conflicts are never silently repaired by Yjs.

## 5. Authoring, rendering, and inspection

The pure tool controller gains `wall`, `opening`, `space`, `area`, `grid`, and `arc` sessions:

- Wall/grid: two points with existing snap and 45-degree constraint.
- Opening: one click on the nearest eligible wall; no host means no command.
- Space/area: reuse polygon interaction and complete an implicitly closed validated boundary.
- Arc: centre, radius/start point, then sweep/end point.

Tools are grouped under one accessible `건축 객체` toolbar/menu control instead of adding six permanently visible buttons. The command menu exposes the same actions. Tool completion emits one existing `add_objects` command.

Wall rendering uses centreline thickness. Openings render a clear-width door/window/void marker over the host; P4 does not claim Boolean wall cuts or parametric swing topology. Space/area render closed translucent polygons and deterministic centroid labels. Grid uses the object name as its accessible label. Arc rendering samples a path while retaining exact stored angles.

Selection, bounds, snap points, drag, clipboard, export, Awareness outlines, and hit testing support every P4 type. A focused semantic inspector edits wall dimensions, opening kind/offset/dimensions/sill, space number/finishes, and arc radius/angles. Multi-selection retains common name/layer/style/custom-property controls.

The preview route contains representative P4 objects so the visual change is immediate: connected walls, a door and window, one space, an area, a grid, and an arc. Preview peer selections and soft locks remain visible.

## 6. Deterministic measurement

Browser calculation is a preview. Server-loaded evidence uses one dependency-free fixed-point module over authoritative Postgres-loaded state.

Rule identifier: `P4_MEASUREMENT_V1`.

```ts
type DrawingMeasurement = {
  ruleVersion: "P4_MEASUREMENT_V1";
  lengthMillimeters: string | null;
  areaSquareMillimeters: string | null;
  count: "1";
};
```

The module quantizes P4 values to `0.000001 mm`, uses `BigInt`, integer square root, integer shoelace area, and one fixed rational PI constant. Formatting is locale-independent. Unavailable values are `null`, never zero.

V1 rules:

- Wall/grid: centreline/axis length.
- Opening: clear width and width × height opening area.
- Space/area: closed-boundary perimeter and polygon area.
- Arc: arc length.
- Every direct semantic object: count `1`.

The React server invokes the same module only after loading and authorizing the revision. It accepts no client measurement. Server results include revision ID, operation checkpoint, object ID, and rule version; the client uses them only while all four still match. No derived measurement row is stored in P4. P6 persists approved quantity links against a frozen revision and rule version.

## 7. Semantic schedules

`DrawingPropertyAppliesTo` gains every P4 type, preserving P2 revision-owned custom properties. P4 schedules themselves are fixed read-only derived projections, not new mutable `lukas_drawing_tables` rows:

- Room: number, object name, area m², count.
- Door: object name/mark, width, height, count for `openingKind="door"`.
- Finish: room number, object name, floor/wall/ceiling finish, area m².

Rows cover the full revision, sort deterministically with object ID as the final tie-breaker, and total fixed-point values before formatting. Existing P2 custom schedules continue unchanged below the semantic schedules. Organization-owned company template/library storage remains P7 and uses the same schema formats.

## 8. Command, collaboration, and history

P4 adds no operation discriminator. Changes use existing `add_objects`, `update_objects`, `delete_objects`, or reference-aware `mutate_objects_with_references` operations.

- The reducer validates the final semantic graph after each atomic batch.
- Inverses include openings and affected property/table references.
- Move/copy/paste/undo/redo/revert/checkpoint restore preserve semantic fields and host IDs.
- Yjs continues to carry immutable operation envelopes; no semantic data enters Awareness.
- IndexedDB outbox and y-indexeddb retain semantic operations offline.
- A wall edit that invalidates an opening becomes an existing conflicted operation.
- Review freeze snapshots include semantic geometry and schedules without changing source bytes.

The collaboration document/envelope shape does not change, so its schema version remains `1`. Web and the single collaboration replica must be deployed together because an old binary imports the older geometry union.

## 9. Database and authorization

One forward Supabase CLI-generated migration:

1. Expands `lukas_drawing_objects.object_type` to twelve variants.
2. Replaces strict geometry validation with P4-aware exact-key, precision, polygon, and range checks.
3. Extends property applicability validation.
4. Keeps block primitive validation limited to the original six types.
5. Adds a generated nullable `host_object_id`, composite self-FK/index, and final semantic host guard.
6. Rejects host delete/invalid shrink and validates the final semantic graph inside the latest wrapped operation RPC.
7. Preserves idempotency, result versions, RLS, source constraints, approval guards, snapshot v2, and private collaboration isolation.

No public table or measurement RPC is added. Admin/editor can mutate P4 objects only on draft revisions. Reviewer/commenter/viewer can read authorized server-derived schedules and measurements but cannot author objects. Non-members cannot load the revision. UI, server action, RPC/RLS, and Hocuspocus retain the same capability mapping.

## 10. Error handling and performance

Invalid polygon, unsafe precision, zero-length wall/grid, invalid arc sweep, missing/foreign host, out-of-wall opening, and excessive dimensions fail before publication and again in Postgres. An opening placement without a host remains transient and emits no operation. A failed server measurement leaves a clearly labelled unconfirmed browser preview.

Resolved openings and sampled arcs are memoized by object ID/version in the canvas adapter, never stored as second canonical state. Full fixed-point polygon measurement does not run on every pointer move. P4 records, but does not claim, a measured 10,000 mixed-object baseline with browser, hardware, viewport, object mix, and cold/warm conditions; 10,000-object 60 fps remains the P7 gate.

Native labels and keyboard operation cover tools, inspector fields, measurement status, and schedules. Colour is not the only signal for object kind, selection, locks, or stale/unconfirmed measurement.

## 11. Release gates

P4 local completion requires:

1. Author wall, hosted door, hosted window, space, area, grid, and arc in the browser.
2. Move a wall and preserve hosted opening placement; reject invalid shrink; explicitly delete host and openings atomically.
3. Reject degenerate/self-intersecting polygons and invalid host/fit in TypeScript and Postgres.
4. Match browser preview and server V1 length/area/perimeter/count on controlled fixtures.
5. Show deterministic read-only room, door, and finish schedules.
6. Retain semantic fields through reload, reconnect, undo, redo, restore, and approved-child-draft creation.
7. Reflect semantic create/move/lock in two browsers and retain 100 offline operations with zero ID loss.
8. Prove Viewer/reviewer mutation denial, non-member load denial, and editor draft-only mutation across DB/RPC/WebSocket.
9. Prove approved revision mutation remains blocked and PDF/IFC SHA-256 remains identical.
10. Pass P0-P3 Drawing Workspace, PDF/IFC review, quantity, approval, and Revit download regressions.
11. Pass license/notice checks for adapted MIT source and add no copyleft/source-available code.
12. Capture desktop/tablet P4 previews and record the mixed-object performance baseline without invented production evidence.

Hosted Supabase, collaboration deployment, real multi-user p95, and field-user results remain `PRODUCTION UNEXECUTED` until real authorities exist. P4 local completion cannot claim the P0-P7 goal complete.

## 12. Explicit non-goals

- Curved/compound walls, automatic wall joins, Boolean cleanup, parametric swings, roofs, stairs, furniture, or 3D extrusion.
- Automatic room detection, topology healing, continuous room recomputation, or automatic approval.
- Persisted measurement caches or mutable semantic schedule rows.
- P5 IFC cross-selection/revision overlay, P6 quantity/rate/BOQ/material/carbon links, or P7 organization libraries/multi-instance fanout.
- Source PDF/IFC mutation, native DWG editing, or AI recognition/classification.

These exclusions narrow P4; they do not narrow the approved P0-P7 objective.
