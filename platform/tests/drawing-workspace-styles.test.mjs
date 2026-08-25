import assert from "node:assert/strict";
import test from "node:test";

import {
  DRAWING_MIXED_STYLE_ID,
  createDrawingStyleResolutionCache,
  sharedDrawingStyleId,
} from "../app/lukas/lib/drawing-style-resolution.ts";
import {
  applyDrawingStyleSelection,
  createDrawingStyleCommand,
  deleteDrawingStyleCommand,
  detachDrawingStyleSelection,
  resetDrawingStyleOverrides,
  updateDrawingSelectionProperties,
  updateDrawingStyleCommand,
} from "../app/lukas/lib/drawing-commands.ts";

const ids = {
  style: "00000000-0000-4000-8000-000000000201",
  object: "00000000-0000-4000-8000-000000000202",
  second: "00000000-0000-4000-8000-000000000203",
  layer: "00000000-0000-4000-8000-000000000204",
};

function state() {
  const styles = {
    [ids.style]: {
      id: ids.style,
      revisionId: "00000000-0000-4000-8000-000000000200",
      name: "Electrical",
      value: { stroke: "#112233", strokeWidth: 2, fill: null, fontSize: 14 },
      version: 1,
    },
  };
  const object = (id, style = {}) => ({
    id,
    name: "Shape",
    layerId: ids.layer,
    geometry: { type: "rectangle", origin: { x: 0, y: 0 }, width: 10, height: 10, rotation: 0 },
    styleId: ids.style,
    style,
    version: 1,
  });
  return {
    revisionId: "00000000-0000-4000-8000-000000000200",
    layers: { [ids.layer]: { id: ids.layer, name: "Work", visible: true, locked: false, systemKind: "work", version: 1 } },
    objects: {
      [ids.object]: object(ids.object, { fill: "#ffffff" }),
      [ids.second]: object(ids.second),
    },
    structure: { styles },
  };
}

test("style resolution is memoized per definition version and invalidates on live definition changes", () => {
  const current = state();
  const resolver = createDrawingStyleResolutionCache(current.structure.styles);
  assert.deepEqual(resolver.resolve(current.objects[ids.object]), {
    stroke: "#112233", strokeWidth: 2, fill: "#ffffff", fontSize: 14,
  });
  assert.strictEqual(
    resolver.resolve(current.objects[ids.object]),
    resolver.resolve(current.objects[ids.object]),
  );
  assert.equal(resolver.resolveCount, 1);

  const updated = {
    ...current.structure.styles,
    [ids.style]: { ...current.structure.styles[ids.style], version: 2, value: { stroke: "#445566", strokeWidth: 3, fill: null } },
  };
  const next = createDrawingStyleResolutionCache(updated);
  assert.equal(next.resolve(current.objects[ids.second]).stroke, "#445566");
  assert.throws(
    () => createDrawingStyleResolutionCache({}).resolve(current.objects[ids.object]),
    /does not exist/i,
  );
});

test("apply, reset overrides, and detach preserve the effective style for every selected object", () => {
  const current = state();
  const applied = applyDrawingStyleSelection(current, [ids.object, ids.second], "actor", ids.style);
  assert.deepEqual(applied.updates.map((update) => update.patch), [
    { styleId: ids.style, style: {} },
    { styleId: ids.style, style: {} },
  ]);
  const reset = resetDrawingStyleOverrides(current, [ids.object], "actor");
  assert.deepEqual(reset.updates[0].patch, { style: {} });
  const detached = detachDrawingStyleSelection(current, [ids.object], "actor");
  assert.deepEqual(detached.updates[0].patch, {
    styleId: null,
    style: { stroke: "#112233", strokeWidth: 2, fill: "#ffffff", fontSize: 14 },
  });
});

test("style commands trim names, preserve definition updates as structure actions, and deny referenced deletion", () => {
  const current = state();
  const created = createDrawingStyleCommand(
    current,
    "actor",
    "  HVAC  ",
    { stroke: "#000000", strokeWidth: 1, fill: null },
    () => "00000000-0000-4000-8000-000000000205",
  );
  assert.deepEqual(created.actions[0], {
    kind: "put_style",
    entity: {
      id: "00000000-0000-4000-8000-000000000205",
      revisionId: current.revisionId,
      name: "HVAC",
      value: { stroke: "#000000", strokeWidth: 1, fill: null },
      version: 1,
    },
    baseVersion: null,
  });
  assert.throws(() => createDrawingStyleCommand(current, "actor", " Electrical ", { stroke: "#000000", strokeWidth: 1, fill: null }));
  const updated = updateDrawingStyleCommand(current, "actor", ids.style, {
    value: { stroke: "#445566", strokeWidth: 3, fill: "#ffffff" },
  });
  assert.equal(updated.actions[0].baseVersion, 1);
  assert.equal(updated.actions[0].entity.value.stroke, "#445566");
  assert.throws(() => deleteDrawingStyleCommand(current, "actor", ids.style), /referenced/i);
  const primitiveReference = {
    ...current,
    objects: {},
    structure: {
      ...current.structure,
      blocks: {
        "00000000-0000-4000-8000-000000000205": {
          id: "00000000-0000-4000-8000-000000000205",
          revisionId: current.revisionId,
          name: "Referenced block",
          primitives: [{
            localId: "circle", name: "Circle",
            geometry: current.objects[ids.object].geometry,
            styleId: ids.style, style: {},
          }],
          version: 1,
        },
      },
    },
  };
  assert.throws(() => deleteDrawingStyleCommand(primitiveReference, "actor", ids.style), /referenced/i);
});

test("font-size overrides are limited to text objects while normal style fields remain available", () => {
  const current = state();
  assert.throws(
    () => updateDrawingSelectionProperties(current, [ids.object], "actor", { fontSize: 18 }),
    /font size.*text/i,
  );
  const text = {
    ...current.objects[ids.object],
    geometry: { type: "text", origin: { x: 0, y: 0 }, width: 10, text: "Note" },
  };
  const update = updateDrawingSelectionProperties(
    { ...current, objects: { [ids.object]: text } },
    [ids.object], "actor", { fontSize: 18 },
  );
  assert.deepEqual(update.updates[0].patch.style, { fill: "#ffffff", fontSize: 18 });
});

test("style picker uses a stable mixed sentinel and tracks detach or external style replacement", () => {
  const current = state();
  assert.equal(sharedDrawingStyleId([current.objects[ids.object]]), ids.style);
  assert.equal(sharedDrawingStyleId([
    current.objects[ids.object],
    { ...current.objects[ids.second], styleId: null },
  ]), DRAWING_MIXED_STYLE_ID);
  assert.equal(sharedDrawingStyleId([{ ...current.objects[ids.object], styleId: null }]), "");
});

test("ten thousand references share one render-pass resolution and invalidate only for a new definition version", () => {
  const current = state();
  const resolver = createDrawingStyleResolutionCache(current.structure.styles);
  for (let index = 0; index < 10_000; index += 1) {
    resolver.resolve({ ...current.objects[ids.object], id: `object-${index}` });
  }
  assert.equal(resolver.resolveCount, 1);
  const updated = {
    [ids.style]: {
      ...current.structure.styles[ids.style],
      version: 2,
      value: { stroke: "#445566", strokeWidth: 2, fill: null },
    },
  };
  const next = createDrawingStyleResolutionCache(updated);
  assert.equal(next.resolve(current.objects[ids.second]).stroke, "#445566");
  assert.equal(next.resolveCount, 1);
});
