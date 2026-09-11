import type { DrawingBlockPrimitive } from "./drawing-workspace.types.ts";

export type NativeAssetProvenance = {
  author: "1HK";
  sourcePath: string;
  attribution: string;
  license: "NOASSERTION";
  origin: "first-party-generated";
};

export type NativeDrawingSymbolAsset = {
  schemaVersion: "1hk-native-symbol/1";
  key: string;
  version: 1;
  name: string;
  description: string;
  units: "mm";
  classification: "door" | "window" | "wall" | "furniture";
  recommendedLayer: string;
  insertionPoint: { x: number; y: number };
  bounds: { x: number; y: number; width: number; height: number };
  primitives: DrawingBlockPrimitive[];
  provenance: NativeAssetProvenance;
};

const sourcePath = "platform/app/lukas/lib/drawing-native-assets.ts";
const provenance: NativeAssetProvenance = {
  author: "1HK",
  sourcePath,
  attribution: "Original schematic drawing symbol authored by 1HK.",
  license: "NOASSERTION",
  origin: "first-party-generated",
};
const outline = { stroke: "#1f2937", strokeWidth: 10, fill: null } as const;
const fixture = { stroke: "#475569", strokeWidth: 8, fill: "#f8fafc" } as const;

function line(
  localId: string,
  name: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  style = outline,
): DrawingBlockPrimitive {
  return {
    localId,
    name,
    geometry: { type: "line", start, end },
    styleId: null,
    style,
  };
}

function polyline(
  localId: string,
  name: string,
  points: { x: number; y: number }[],
  closed = false,
  style = outline,
): DrawingBlockPrimitive {
  return {
    localId,
    name,
    geometry: { type: "polyline", points, closed },
    styleId: null,
    style,
  };
}

function rectangle(
  localId: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style = fixture,
): DrawingBlockPrimitive {
  return {
    localId,
    name,
    geometry: {
      type: "rectangle",
      origin: { x, y },
      width,
      height,
      rotation: 0,
    },
    styleId: null,
    style,
  };
}

function circle(
  localId: string,
  name: string,
  x: number,
  y: number,
  radius: number,
  style = fixture,
): DrawingBlockPrimitive {
  return {
    localId,
    name,
    geometry: { type: "circle", center: { x, y }, radius },
    styleId: null,
    style,
  };
}

function asset(
  key: string,
  name: string,
  description: string,
  classification: NativeDrawingSymbolAsset["classification"],
  recommendedLayer: string,
  width: number,
  height: number,
  primitives: DrawingBlockPrimitive[],
): NativeDrawingSymbolAsset {
  return {
    schemaVersion: "1hk-native-symbol/1",
    key,
    version: 1,
    name,
    description,
    units: "mm",
    classification,
    recommendedLayer,
    insertionPoint: { x: 0, y: 0 },
    bounds: { x: 0, y: 0, width, height },
    primitives,
    provenance,
  };
}

/** Committed 15° samples, quantized to one millionth of the leaf radius. */
const quarterSwingPointsPerMillion = [
  { x: 1_000_000, y: 0 },
  { x: 965_926, y: 258_819 },
  { x: 866_025, y: 500_000 },
  { x: 707_107, y: 707_107 },
  { x: 500_000, y: 866_025 },
  { x: 258_819, y: 965_926 },
  { x: 0, y: 1_000_000 },
] as const;

function quarterSwing(radius: number, mirrored = false) {
  return quarterSwingPointsPerMillion.map((point) => ({
    x: mirrored
      ? radius + ((1_000_000 - point.x) * radius) / 1_000_000
      : (point.x * radius) / 1_000_000,
    y: (point.y * radius) / 1_000_000,
  }));
}

function singleDoor(width: number) {
  return asset(
    `door-single-${width}`,
    `Single door ${width} mm`,
    `${width} mm single-door plan symbol with jambs, leaf, and sampled swing; schematic only, not a host-connected semantic opening.`,
    "door",
    "A-DOOR-SYMBOL",
    width,
    width,
    [
      line("jamb-left", "Left jamb", { x: 0, y: 0 }, { x: 0, y: 100 }),
      line(
        "jamb-right",
        "Right jamb",
        { x: width, y: 0 },
        { x: width, y: 100 },
      ),
      line("leaf", "Door leaf", { x: 0, y: 0 }, { x: 0, y: width }),
      polyline("swing", "Door swing", quarterSwing(width)),
    ],
  );
}

function doubleDoor(width: number) {
  const leafWidth = width / 2;
  return asset(
    `door-double-${width}`,
    `Double door ${width} mm`,
    `${width} mm double-door plan symbol with jambs, paired leaves, and sampled swings; schematic only, not a host-connected semantic opening.`,
    "door",
    "A-DOOR-SYMBOL",
    width,
    leafWidth,
    [
      line("jamb-left", "Left jamb", { x: 0, y: 0 }, { x: 0, y: 100 }),
      line(
        "jamb-right",
        "Right jamb",
        { x: width, y: 0 },
        { x: width, y: 100 },
      ),
      line(
        "leaf-left",
        "Left door leaf",
        { x: 0, y: 0 },
        { x: 0, y: leafWidth },
      ),
      line(
        "leaf-right",
        "Right door leaf",
        { x: width, y: 0 },
        { x: width, y: leafWidth },
      ),
      polyline("swing-left", "Left door swing", quarterSwing(leafWidth)),
      polyline(
        "swing-right",
        "Right door swing",
        quarterSwing(leafWidth, true),
      ),
    ],
  );
}

function slidingDoor(width: number) {
  const overlap = 100;
  return asset(
    `door-sliding-${width}`,
    `Sliding door ${width} mm`,
    `${width} mm two-panel sliding-door plan symbol; schematic only, not a host-connected semantic opening.`,
    "door",
    "A-DOOR-SYMBOL",
    width,
    200,
    [
      rectangle("frame", "Sliding door frame", 0, 0, width, 200),
      rectangle(
        "panel-left",
        "Left sliding panel",
        0,
        25,
        width / 2 + overlap,
        125,
      ),
      rectangle(
        "panel-right",
        "Right sliding panel",
        width / 2 - overlap,
        50,
        width / 2 + overlap,
        125,
      ),
      line(
        "travel",
        "Panel travel",
        { x: width / 2 - 100, y: 190 },
        { x: width / 2 + 100, y: 190 },
      ),
    ],
  );
}

function windowSymbol(width: number) {
  const inset = 25;
  return asset(
    `window-${width}`,
    `Window ${width} mm`,
    `${width} mm wide by 150 mm deep divided window plan symbol; schematic only, not a host-connected semantic opening.`,
    "window",
    "A-WINDOW-SYMBOL",
    width,
    150,
    [
      rectangle("frame", "Window frame", 0, 0, width, 150),
      rectangle("pane-left", "Left pane", inset, inset, width / 2 - inset, 100),
      rectangle(
        "pane-right",
        "Right pane",
        width / 2,
        inset,
        width / 2 - inset,
        100,
      ),
      line(
        "mullion",
        "Center mullion",
        { x: width / 2, y: 0 },
        { x: width / 2, y: 150 },
      ),
    ],
  );
}

function wallSegment(thickness: number) {
  return asset(
    `wall-segment-${thickness}`,
    `Wall segment 1000 × ${thickness} mm`,
    `Straight schematic wall segment, 1000 mm long and ${thickness} mm thick.`,
    "wall",
    "A-WALL-SYMBOL",
    1000,
    thickness,
    [rectangle("body", "Wall body", 0, 0, 1000, thickness)],
  );
}

function desk(width: number, height: number) {
  return asset(
    `furniture-desk-${width}x${height}`,
    `Desk ${width} × ${height} mm`,
    `${width} × ${height} mm schematic desk footprint with modesty line.`,
    "furniture",
    "A-FURNITURE",
    width,
    height,
    [
      rectangle("top", "Desk top", 0, 0, width, height),
      line(
        "modesty",
        "Desk modesty line",
        { x: 100, y: height - 100 },
        { x: width - 100, y: height - 100 },
      ),
    ],
  );
}

function meetingTable(seats: 4 | 6, width: number, height: number) {
  const chairRadius = 125;
  const chairXs =
    seats === 4
      ? [width * 0.3, width * 0.7]
      : [width * 0.2, width * 0.5, width * 0.8];
  return asset(
    `furniture-meeting-table-${seats}-seat-${width}x${height}`,
    `${seats}-seat meeting table ${width} × ${height} mm`,
    `${width} × ${height} mm schematic meeting-table footprint for ${seats} seats.`,
    "furniture",
    "A-FURNITURE",
    width,
    height,
    [
      rectangle(
        "top",
        "Meeting table top",
        0,
        chairRadius,
        width,
        height - chairRadius * 2,
      ),
      ...chairXs.flatMap((x, index) => [
        circle(
          `chair-top-${index + 1}`,
          `Top chair ${index + 1}`,
          x,
          chairRadius,
          chairRadius,
        ),
        circle(
          `chair-bottom-${index + 1}`,
          `Bottom chair ${index + 1}`,
          x,
          height - chairRadius,
          chairRadius,
        ),
      ]),
    ],
  );
}

function sofa(seats: 2 | 3, width: number) {
  const seatWidth = (width - 200) / seats;
  return asset(
    `furniture-sofa-${seats}-seat-${width}x800`,
    `${seats}-seat sofa ${width} × 800 mm`,
    `${width} × 800 mm schematic ${seats}-seat sofa footprint.`,
    "furniture",
    "A-FURNITURE",
    width,
    800,
    [
      rectangle("outline", "Sofa outline", 0, 0, width, 800),
      rectangle("back", "Sofa back", 100, 75, width - 200, 150),
      ...Array.from({ length: seats }, (_, index) =>
        rectangle(
          `seat-${index + 1}`,
          `Seat ${index + 1}`,
          100 + index * seatWidth,
          250,
          seatWidth,
          425,
        ),
      ),
    ],
  );
}

function bed(kind: "single" | "double", width: number) {
  return asset(
    `furniture-bed-${kind}-${width}x2000`,
    `${kind === "single" ? "Single" : "Double"} bed ${width} × 2000 mm`,
    `${width} × 2000 mm schematic ${kind}-bed footprint with pillow zone.`,
    "furniture",
    "A-FURNITURE",
    width,
    2000,
    [
      rectangle("frame", "Bed frame", 0, 0, width, 2000),
      rectangle("pillow", "Pillow zone", 100, 100, width - 200, 400),
      line("blanket", "Blanket edge", { x: 0, y: 700 }, { x: width, y: 700 }),
    ],
  );
}

export const NATIVE_DRAWING_SYMBOL_ASSETS: readonly NativeDrawingSymbolAsset[] =
  [
    singleDoor(800),
    singleDoor(900),
    singleDoor(1000),
    doubleDoor(1600),
    slidingDoor(1800),
    windowSymbol(600),
    windowSymbol(900),
    windowSymbol(1200),
    windowSymbol(1500),
    windowSymbol(1800),
    wallSegment(100),
    wallSegment(150),
    wallSegment(200),
    asset(
      "wall-l-partition-100",
      "L partition 100 mm thick",
      "Schematic L partition with two 1000 mm legs, each 100 mm thick.",
      "wall",
      "A-WALL-SYMBOL",
      1000,
      1000,
      [
        rectangle("horizontal", "Horizontal partition leg", 0, 0, 1000, 100),
        rectangle("vertical", "Vertical partition leg", 0, 0, 100, 1000),
      ],
    ),
    desk(1200, 600),
    desk(1600, 800),
    asset(
      "furniture-chair-500x500",
      "Chair 500 × 500 mm",
      "500 × 500 mm schematic chair footprint.",
      "furniture",
      "A-FURNITURE",
      500,
      500,
      [
        rectangle("seat", "Chair seat", 0, 0, 500, 500),
        line("back", "Chair back", { x: 50, y: 75 }, { x: 450, y: 75 }),
      ],
    ),
    meetingTable(4, 1800, 900),
    meetingTable(6, 2400, 1000),
    sofa(2, 1600),
    sofa(3, 2200),
    asset(
      "furniture-cabinet-900x450",
      "Cabinet 900 × 450 mm",
      "900 × 450 mm schematic cabinet footprint with two doors.",
      "furniture",
      "A-FURNITURE",
      900,
      450,
      [
        rectangle("case", "Cabinet case", 0, 0, 900, 450),
        line(
          "door-split",
          "Cabinet door split",
          { x: 450, y: 0 },
          { x: 450, y: 450 },
        ),
        circle("pull-left", "Left pull", 400, 225, 20),
        circle("pull-right", "Right pull", 500, 225, 20),
      ],
    ),
    bed("single", 1000),
    bed("double", 1600),
  ];
