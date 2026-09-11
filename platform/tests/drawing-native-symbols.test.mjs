import assert from "node:assert/strict";
import test from "node:test";

import {
  NativeDrawingSymbolSchema,
  getNativeDrawingSymbol,
  listNativeDrawingSymbols,
  nativeAssetCanonicalJson,
  nativeAssetSha256,
} from "../app/lukas/lib/drawing-native-symbols.ts";

const expectedKeys = [
  "door-double-1600",
  "door-single-800",
  "door-single-900",
  "door-single-1000",
  "door-sliding-1800",
  "furniture-bed-double-1600x2000",
  "furniture-bed-single-1000x2000",
  "furniture-cabinet-900x450",
  "furniture-chair-500x500",
  "furniture-desk-1200x600",
  "furniture-desk-1600x800",
  "furniture-meeting-table-4-seat-1800x900",
  "furniture-meeting-table-6-seat-2400x1000",
  "furniture-sofa-2-seat-1600x800",
  "furniture-sofa-3-seat-2200x800",
  "wall-l-partition-100",
  "wall-segment-100",
  "wall-segment-150",
  "wall-segment-200",
  "window-600",
  "window-900",
  "window-1200",
  "window-1500",
  "window-1800",
].sort();

test("catalog exposes 24 distinct, schema-valid symbols in all four classifications", () => {
  const symbols = listNativeDrawingSymbols();
  assert.equal(symbols.length, 24);
  assert.deepEqual(symbols.map(({ key }) => key).sort(), expectedKeys);
  assert.equal(new Set(symbols.map(({ key }) => key)).size, 24);
  assert.deepEqual(
    [...new Set(symbols.map(({ classification }) => classification))].sort(),
    ["door", "furniture", "wall", "window"],
  );

  for (const symbol of symbols) {
    assert.equal(
      NativeDrawingSymbolSchema.safeParse(symbol).success,
      true,
      symbol.key,
    );
    assert.ok(symbol.description.includes("mm"), symbol.key);
    assert.equal(symbol.provenance.author, "1HK");
    assert.equal(symbol.provenance.origin, "first-party-generated");
    assert.equal(symbol.provenance.license, "NOASSERTION");
    assert.equal(
      symbol.provenance.sourcePath,
      "platform/app/lukas/lib/drawing-native-assets.ts",
    );
    assert.ok(symbol.provenance.attribution.includes("1HK"));
    assert.ok(symbol.insertionPoint.x >= symbol.bounds.x);
    assert.ok(symbol.insertionPoint.y >= symbol.bounds.y);
    assert.ok(symbol.insertionPoint.x <= symbol.bounds.x + symbol.bounds.width);
    assert.ok(
      symbol.insertionPoint.y <= symbol.bounds.y + symbol.bounds.height,
    );
    assert.equal(
      new Set(symbol.primitives.map(({ localId }) => localId)).size,
      symbol.primitives.length,
    );
    for (const primitive of symbol.primitives)
      assert.equal(primitive.styleId, null);
  }
});

test("900 mm single door includes jambs, a leaf, and a sampled swing inside exact extents", () => {
  const door = getNativeDrawingSymbol("door-single-900");
  assert.deepEqual(door.bounds, { x: 0, y: 0, width: 900, height: 900 });
  assert.match(door.name, /900 mm/);
  assert.match(door.description, /not a host-connected semantic opening/i);
  assert.equal(
    door.primitives.filter(({ name }) => /jamb/i.test(name)).length,
    2,
  );
  assert.ok(
    door.primitives.some(
      ({ name, geometry }) => /leaf/i.test(name) && geometry.type === "line",
    ),
  );
  const swing = door.primitives.find(({ name }) => /swing/i.test(name));
  assert.equal(swing?.geometry.type, "polyline");
  assert.deepEqual(swing?.geometry.points.at(0), { x: 900, y: 0 });
  assert.deepEqual(swing?.geometry.points.at(-1), { x: 0, y: 900 });
});

test("1200 mm window has a dimensioned frame and divided panes", () => {
  const window = getNativeDrawingSymbol("window-1200");
  assert.deepEqual(window.bounds, { x: 0, y: 0, width: 1200, height: 150 });
  assert.match(window.name, /1200 mm/);
  assert.match(window.description, /not a host-connected semantic opening/i);
  assert.ok(
    window.primitives.some(
      ({ name, geometry }) =>
        /frame/i.test(name) && geometry.type === "rectangle",
    ),
  );
  assert.ok(
    window.primitives.filter(({ name }) => /pane/i.test(name)).length >= 2,
  );
});

test("1200 by 600 desk preserves its declared footprint", () => {
  const desk = getNativeDrawingSymbol("furniture-desk-1200x600");
  assert.deepEqual(desk.bounds, { x: 0, y: 0, width: 1200, height: 600 });
  assert.match(desk.name, /1200 × 600 mm/);
  assert.ok(
    desk.primitives.some(
      ({ name, geometry }) =>
        /top/i.test(name) && geometry.type === "rectangle",
    ),
  );
});

test("strict schema rejects unknown fields, nonfinite geometry, duplicate IDs, dangling styles, and false extents", () => {
  const base = getNativeDrawingSymbol("furniture-desk-1200x600");
  assert.equal(
    NativeDrawingSymbolSchema.safeParse({ ...base, surprise: true }).success,
    false,
  );
  assert.equal(
    NativeDrawingSymbolSchema.safeParse({
      ...base,
      primitives: [
        {
          ...base.primitives[0],
          geometry: { ...base.primitives[0].geometry, width: Number.NaN },
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    NativeDrawingSymbolSchema.safeParse({
      ...base,
      primitives: [base.primitives[0], base.primitives[0]],
    }).success,
    false,
  );
  assert.equal(
    NativeDrawingSymbolSchema.safeParse({
      ...base,
      primitives: [
        {
          ...base.primitives[0],
          styleId: "00000000-0000-4000-8000-000000000001",
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    NativeDrawingSymbolSchema.safeParse({
      ...base,
      bounds: { ...base.bounds, width: 1199 },
    }).success,
    false,
  );
});

test("strict schema rejects empty, zero-sized, and out-of-bounds insertion assets", () => {
  const base = getNativeDrawingSymbol("furniture-desk-1200x600");
  assert.equal(
    NativeDrawingSymbolSchema.safeParse({ ...base, primitives: [] }).success,
    false,
  );
  assert.equal(
    NativeDrawingSymbolSchema.safeParse({
      ...base,
      bounds: { ...base.bounds, width: 0 },
    }).success,
    false,
  );
  assert.equal(
    NativeDrawingSymbolSchema.safeParse({
      ...base,
      insertionPoint: { x: 1201, y: 300 },
    }).success,
    false,
  );
});

test("catalog getters return independent copies and reject unknown keys", () => {
  const first = getNativeDrawingSymbol("furniture-desk-1200x600");
  first.name = "mutated";
  first.primitives[0].name = "mutated";
  const second = getNativeDrawingSymbol("furniture-desk-1200x600");
  assert.notEqual(second.name, "mutated");
  assert.notEqual(second.primitives[0].name, "mutated");

  const listed = listNativeDrawingSymbols();
  listed.pop();
  listed[0].bounds.width = 1;
  assert.equal(listNativeDrawingSymbols().length, 24);
  assert.notEqual(listNativeDrawingSymbols()[0].bounds.width, 1);
  assert.throws(
    () => getNativeDrawingSymbol("unknown"),
    /Unknown native drawing symbol/,
  );
});

test("representative key and version pairs retain their independently verified release hashes", async () => {
  const expectedHashes = {
    "door-single-900":
      "900ced1a4b2b4b2b218e55d4f34f24ce8c15db66a3d57d62104fec82e8339182",
    "door-double-1600":
      "1b7d9b9c5cbb29071edd2d83ae46445bae194c5460c11c8dce68c4df08984e9c",
    "furniture-desk-1200x600":
      "6d5b05ef2f5efdf02d4dfd2c16be445e4590f45c92b2bd3b7c51a0a1e693cd63",
  };

  for (const [key, expectedHash] of Object.entries(expectedHashes)) {
    const symbol = getNativeDrawingSymbol(key);
    assert.equal(symbol.version, 1);
    assert.equal(await nativeAssetSha256(symbol), expectedHash, key);
  }
});

test("canonical JSON is strict and SHA-256 matches independent vectors", async () => {
  assert.equal(
    nativeAssetCanonicalJson({ b: [true, null], a: 1 }),
    '{"a":1,"b":[true,null]}',
  );
  assert.equal(
    await nativeAssetSha256({ b: [true, null], a: 1 }),
    "1cc69c7fa23616ca2ec3ee70d24390a6225c8832db8a4c814c7e0e7f942f8668",
  );
  assert.equal(
    await nativeAssetSha256(null),
    "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b",
  );

  const cyclic = {};
  cyclic.self = cyclic;
  const sparse = [];
  sparse.length = 1;
  const decoratedArray = [];
  Object.defineProperty(decoratedArray, "hidden", { value: 1 });
  let getterCalls = 0;
  const getter = Object.defineProperty({}, "value", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 1;
    },
  });
  for (const invalid of [
    undefined,
    1n,
    Symbol("x"),
    () => 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    sparse,
    decoratedArray,
    cyclic,
    new Date(0),
    new Map(),
    getter,
  ]) {
    assert.throws(() => nativeAssetCanonicalJson(invalid), /canonical JSON/i);
  }
  assert.equal(getterCalls, 0);
});
