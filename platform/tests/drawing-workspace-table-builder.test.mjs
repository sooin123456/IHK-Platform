import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import { createDrawingDocumentState } from "../app/lukas/lib/drawing-commands.ts";
import {
  addDrawingTableDraftColumn,
  buildDrawingTableDraftPatch,
  buildDrawingTableDraftSubmission,
  createDrawingTableCreateDraft,
  createDrawingTableDraft,
  deleteDrawingTableDraftColumn,
  editDrawingTableDraft,
  editDrawingTableDraftCell,
  markDrawingTableDraftSubmitted,
  moveDrawingTableDraftColumn,
  markDrawingTableCreateDraftSubmitted,
  reconcileDrawingTableDraft,
  settleDrawingTableCreateDraft,
  settleDrawingTableDraft,
  updateDrawingTableDraftColumn,
} from "../app/lukas/lib/drawing-tables.ts";

const id = (suffix) =>
  `20000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

const ids = {
  actor: id(1),
  revision: id(2),
  page: id(3),
  canvas: id(4),
  layer: id(5),
  object: id(6),
  table: id(7),
  row: id(8),
  name: id(9),
  note: id(10),
  cost: id(11),
  property: id(12),
  added: id(13),
  rowRemote: id(14),
  objectRemote: id(15),
  propertyAll: id(16),
  propertyCircle: id(17),
};

const baseColumns = [
  {
    id: ids.name,
    name: "객체 이름",
    kind: "object_name",
    propertySchemaId: null,
  },
  {
    id: ids.note,
    name: "메모",
    kind: "text",
    propertySchemaId: null,
  },
  {
    id: ids.cost,
    name: "금액",
    kind: "number",
    propertySchemaId: null,
  },
];

function table(overrides = {}) {
  return {
    id: ids.table,
    revisionId: ids.revision,
    name: "창호 점검",
    columns: baseColumns,
    rows: [
      {
        id: ids.row,
        objectId: ids.object,
        blockInstanceId: null,
        cells: { [ids.note]: "현장 확인", [ids.cost]: 12 },
      },
    ],
    version: 1,
    ...overrides,
  };
}

function state(inputTable = table()) {
  return createDrawingDocumentState({
    revisionId: ids.revision,
    structure: {
      pages: {
        [ids.page]: {
          id: ids.page,
          revisionId: ids.revision,
          name: "A1",
          sortOrder: 0,
          version: 1,
        },
      },
      canvases: {
        [ids.canvas]: {
          id: ids.canvas,
          pageId: ids.page,
          name: "Paper",
          spaceKind: "paper",
          widthMillimeters: 210,
          heightMillimeters: 297,
          background: null,
          sortOrder: 0,
          version: 1,
        },
      },
      layers: {
        [ids.layer]: {
          id: ids.layer,
          canvasId: ids.canvas,
          name: "Work",
          visible: true,
          locked: false,
          systemKind: "work",
          sortOrder: 0,
          version: 1,
        },
      },
      objects: {
        [ids.object]: {
          id: ids.object,
          name: "Door 01",
          layerId: ids.layer,
          geometry: {
            type: "rectangle",
            origin: { x: 0, y: 0 },
            width: 10,
            height: 20,
            rotation: 0,
          },
          styleId: null,
          style: { stroke: "#112233", strokeWidth: 1, fill: null },
          version: 1,
        },
      },
      styles: {},
      blocks: {},
      blockInstances: {},
      propertySchemas: {
        [ids.property]: {
          id: ids.property,
          revisionId: ids.revision,
          name: "검토 상태",
          valueType: "enum",
          enumOptions: ["확인 필요", "완료"],
          appliesTo: ["rectangle"],
          required: false,
          version: 1,
        },
      },
      propertyValues: {},
      tables: { [inputTable.id]: inputTable },
    },
  });
}

test("table draft column actions retain existing IDs and allocate one ID only for an added column", () => {
  let draft = createDrawingTableDraft(table());
  draft = updateDrawingTableDraftColumn(draft, ids.note, { name: "비고" });
  draft = moveDrawingTableDraftColumn(draft, ids.cost, -1);
  assert.deepEqual(
    draft.columns.map(({ id: columnId, name }) => [columnId, name]),
    [
      [ids.name, "객체 이름"],
      [ids.cost, "금액"],
      [ids.note, "비고"],
    ],
  );

  let calls = 0;
  draft = addDrawingTableDraftColumn(draft, () => {
    calls += 1;
    return ids.added;
  });
  assert.equal(calls, 1);
  assert.deepEqual(
    draft.columns.map((column) => column.id),
    [ids.name, ids.cost, ids.note, ids.added],
  );
  assert.equal(draft.columns.at(-1).kind, "text");
  assert.equal(draft.columns.at(-1).propertySchemaId, null);
});

test("table draft refuses to delete the final column", () => {
  const oneColumn = createDrawingTableDraft(
    table({
      columns: [baseColumns[0]],
      rows: [{ ...table().rows[0], cells: {} }],
    }),
  );
  assert.throws(
    () => deleteDrawingTableDraftColumn(oneColumn, ids.name),
    /at least one|하나 이상의 열/i,
  );
});

test("one structure patch preserves rename and reorder cells but cleans deleted or retagged column cells", () => {
  const current = table();
  const renamedAndReordered = [
    baseColumns[2],
    { ...baseColumns[1], name: "비고" },
    baseColumns[0],
  ];
  assert.deepEqual(
    buildDrawingTableDraftPatch(current, "수정된 점검표", renamedAndReordered),
    {
      name: "수정된 점검표",
      columns: renamedAndReordered,
      rows: current.rows,
    },
  );

  const deleted = [baseColumns[0], baseColumns[2]];
  assert.deepEqual(
    buildDrawingTableDraftPatch(current, current.name, deleted).rows[0].cells,
    { [ids.cost]: 12 },
  );

  const typeChanged = [
    baseColumns[0],
    { ...baseColumns[1], kind: "number" },
    { ...baseColumns[2], kind: "object_type" },
  ];
  assert.deepEqual(
    buildDrawingTableDraftPatch(current, current.name, typeChanged).rows[0]
      .cells,
    {},
  );
});

test("row-only remote versions rebase into a dirty structure draft while remote structure changes conflict", () => {
  const original = table();
  const local = editDrawingTableDraft(createDrawingTableDraft(original), {
    name: "내 점검표",
    columns: [baseColumns[1], baseColumns[0], baseColumns[2]],
  });
  const rowOnly = table({
    version: 2,
    rows: [
      {
        ...original.rows[0],
        cells: { [ids.note]: "원격 행", [ids.cost]: 31 },
      },
    ],
  });
  const rebased = reconcileDrawingTableDraft(local, rowOnly);
  assert.equal(rebased.name, "내 점검표");
  assert.deepEqual(
    rebased.columns.map((column) => column.id),
    [ids.note, ids.name, ids.cost],
  );
  assert.equal(rebased.tableVersion, 2);
  assert.equal(rebased.conflicted, false);
  assert.deepEqual(
    buildDrawingTableDraftPatch(rowOnly, rebased.name, rebased.columns).rows,
    rowOnly.rows,
  );

  const remoteStructure = table({
    version: 3,
    name: "상대방 점검표",
    columns: [baseColumns[0], { ...baseColumns[1], name: "상대 비고" }],
  });
  const conflicted = reconcileDrawingTableDraft(rebased, remoteStructure);
  assert.equal(conflicted.name, "내 점검표");
  assert.deepEqual(conflicted.columns, rebased.columns);
  assert.equal(conflicted.tableVersion, 3);
  assert.equal(conflicted.conflicted, true);
});

test("a clean table draft adopts the latest remote structure", () => {
  const remote = table({
    version: 2,
    name: "상대방 점검표",
    columns: [baseColumns[0]],
    rows: [{ ...table().rows[0], cells: {} }],
  });
  const reconciled = reconcileDrawingTableDraft(
    createDrawingTableDraft(table()),
    remote,
  );
  assert.equal(reconciled.name, remote.name);
  assert.deepEqual(reconciled.columns, remote.columns);
  assert.equal(reconciled.conflicted, false);
});

test("row-only projections preserve touched controlled cells and adopt untouched and new canonical cells", () => {
  let draft = createDrawingTableDraft(table());
  draft = editDrawingTableDraftCell(draft, ids.row, ids.note, "내 메모");
  const remote = table({
    version: 2,
    rows: [
      {
        ...table().rows[0],
        cells: { [ids.note]: "상대 메모", [ids.cost]: 31 },
      },
      {
        id: ids.rowRemote,
        objectId: ids.objectRemote,
        blockInstanceId: null,
        cells: { [ids.note]: "새 행", [ids.cost]: 44 },
      },
    ],
  });
  const rebased = reconcileDrawingTableDraft(draft, remote);
  assert.equal(rebased.cellValues[ids.row][ids.note], "내 메모");
  assert.equal(rebased.cellValues[ids.row][ids.cost], "31");
  assert.deepEqual(rebased.cellValues[ids.rowRemote], {
    [ids.note]: "새 행",
    [ids.cost]: "44",
  });
  assert.deepEqual(rebased.touchedCellKeys, [`${ids.row}:${ids.note}`]);
  assert.equal(rebased.conflicted, true);

  const retagged = updateDrawingTableDraftColumn(rebased, ids.note, {
    kind: "number",
  });
  assert.equal(retagged.cellValues[ids.row][ids.note], "");
  assert.doesNotMatch(retagged.touchedCellKeys.join(" "), new RegExp(ids.note));
  const deleted = deleteDrawingTableDraftColumn(retagged, ids.note);
  assert.equal(ids.note in deleted.cellValues[ids.row], false);
});

test("a remotely deleted touched row conflicts without discarding its local cell draft", () => {
  const touched = editDrawingTableDraftCell(
    createDrawingTableDraft(table()),
    ids.row,
    ids.note,
    "삭제 전 내 메모",
  );
  const rebased = reconcileDrawingTableDraft(
    touched,
    table({ version: 2, rows: [] }),
  );
  assert.equal(rebased.conflicted, true);
  assert.equal(rebased.cellValues[ids.row][ids.note], "삭제 전 내 메모");
  assert.deepEqual(rebased.touchedCellKeys, [`${ids.row}:${ids.note}`]);

  const patch = buildDrawingTableDraftSubmission(
    table({ version: 2, rows: [] }),
    rebased,
  );
  assert.equal(patch.rows.length, 1);
  assert.deepEqual(patch.rows[0], {
    ...table().rows[0],
    cells: { [ids.note]: "삭제 전 내 메모", [ids.cost]: 12 },
  });
  const submitted = markDrawingTableDraftSubmitted(rebased, patch, true);
  const projected = table({ ...patch, version: 3 });
  const pending = settleDrawingTableDraft(submitted, projected, "pending");
  const settled = settleDrawingTableDraft(pending, projected, "settled");
  assert.equal(settled.conflicted, false);
  assert.equal(settled.submissionRejected, false);
  assert.deepEqual(settled.touchedCellKeys, []);
});

test("row-only target changes preserve the local property selection for explicit conflict resolution", () => {
  let draft = createDrawingTableDraft(table());
  draft = updateDrawingTableDraftColumn(draft, ids.cost, {
    kind: "property",
    propertySchemaId: ids.propertyCircle,
  });
  const remote = table({
    version: 2,
    rows: [
      {
        ...table().rows[0],
        objectId: ids.objectRemote,
        cells: { [ids.note]: "새 대상" },
      },
    ],
  });

  const rebased = reconcileDrawingTableDraft(draft, remote);
  assert.equal(
    rebased.columns.find((column) => column.id === ids.cost)?.propertySchemaId,
    ids.propertyCircle,
  );
  assert.equal(rebased.conflicted, false);
  assert.equal(ids.cost in rebased.cellValues[ids.row], false);
});

test("accepted submissions stay dirty until persistence settles and rejected submissions retain retryable input", () => {
  let draft = createDrawingTableDraft(table());
  draft = editDrawingTableDraft(draft, { name: "내 점검표" });
  draft = editDrawingTableDraftCell(draft, ids.row, ids.note, "제출 메모");
  const patch = buildDrawingTableDraftSubmission(table(), draft);

  const rejected = markDrawingTableDraftSubmitted(draft, patch, false);
  assert.equal(rejected.submission, null);
  assert.equal(rejected.submissionRejected, true);
  assert.equal(rejected.name, "내 점검표");
  assert.equal(rejected.cellValues[ids.row][ids.note], "제출 메모");

  const submitted = markDrawingTableDraftSubmitted(draft, patch, true);
  const projected = table({ ...patch, version: 2 });
  const pending = settleDrawingTableDraft(submitted, projected, "pending");
  assert.notEqual(pending.submission, null);
  assert.equal(pending.baselineName, "창호 점검");
  assert.equal(pending.cellValues[ids.row][ids.note], "제출 메모");

  const settled = settleDrawingTableDraft(pending, projected, "settled");
  assert.equal(settled.submission, null);
  assert.equal(settled.submissionRejected, false);
  assert.equal(settled.baselineName, "내 점검표");
  assert.deepEqual(settled.touchedCellKeys, []);

  const failed = settleDrawingTableDraft(submitted, table(), "failed");
  assert.equal(failed.submissionRejected, true);
  assert.equal(failed.conflicted, true);
  assert.equal(failed.name, "내 점검표");
  assert.equal(failed.cellValues[ids.row][ids.note], "제출 메모");
});

test("create-table drafts clear only after matching canonical persistence settles", () => {
  const named = { ...createDrawingTableCreateDraft(), name: "내 일람표" };
  const rejected = markDrawingTableCreateDraftSubmitted(
    named,
    ids.table,
    false,
  );
  assert.equal(rejected.name, "내 일람표");
  assert.equal(rejected.submission, null);
  assert.equal(rejected.submissionRejected, true);

  const submitted = markDrawingTableCreateDraftSubmitted(
    named,
    ids.table,
    true,
  );
  const waiting = settleDrawingTableCreateDraft(
    submitted,
    undefined,
    "settled",
  );
  assert.equal(waiting.name, "내 일람표");
  assert.notEqual(waiting.submission, null);

  const pending = settleDrawingTableCreateDraft(
    waiting,
    undefined,
    "pending",
  );
  const failed = settleDrawingTableCreateDraft(pending, undefined, "failed");
  assert.equal(failed.name, "내 일람표");
  assert.equal(failed.submission, null);
  assert.equal(failed.submissionRejected, true);

  const canonical = table({ name: "내 일람표" });
  const settled = settleDrawingTableCreateDraft(
    pending,
    canonical,
    "settled",
  );
  assert.deepEqual(settled, createDrawingTableCreateDraft());
});

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
after(() => vite.close());
const { DrawingTablesPanel } = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-tables-panel.tsx",
);

test("schedule column builder exposes all supported kinds and conflict actions only to editors", () => {
  const current = state(
    table({
      columns: [
        baseColumns[0],
        baseColumns[1],
        {
          ...baseColumns[2],
          name: "검토 상태",
          kind: "property",
          propertySchemaId: ids.property,
        },
      ],
      rows: [
        {
          ...table().rows[0],
          cells: { [ids.note]: "현장 확인" },
        },
      ],
    }),
  );
  const render = (canEdit) =>
    renderToStaticMarkup(
      createElement(DrawingTablesPanel, {
        actorId: ids.actor,
        canEdit,
        onCommand() {},
        selectedIds: [ids.object],
        state: current,
      }),
    );
  const viewer = render(false);
  assert.doesNotMatch(viewer, /<form|<input|<select|<button/);
  assert.doesNotMatch(viewer, /열 추가|열 삭제|열 위로 이동|열 아래로 이동/);

  const editor = render(true);
  for (const label of [
    "일람표 이름: 창호 점검",
    "열 이름: 객체 이름",
    "열 종류: 객체 이름",
    "열 위로 이동: 객체 이름",
    "열 아래로 이동: 객체 이름",
    "열 삭제: 객체 이름",
    "열 추가: 창호 점검",
    "일람표 저장",
  ])
    assert.match(editor, new RegExp(label));
  for (const value of [
    "object_name",
    "object_type",
    "text",
    "number",
    "property",
  ])
    assert.match(editor, new RegExp(`value="${value}"`));
  assert.match(editor, /검토 상태/);
});

test("schedule property options include only schemas applicable to every current row target", () => {
  const sharedSchema = {
    id: ids.propertyAll,
    revisionId: ids.revision,
    name: "공통 상태",
    valueType: "text",
    enumOptions: [],
    appliesTo: ["rectangle", "circle"],
    required: false,
    version: 1,
  };
  const circleSchema = {
    ...sharedSchema,
    id: ids.propertyCircle,
    name: "원형 전용",
    appliesTo: ["circle"],
  };
  const inputTable = table({
    columns: [
      {
        id: ids.cost,
        name: "공통 상태",
        kind: "property",
        propertySchemaId: ids.propertyAll,
      },
    ],
    rows: [
      { ...table().rows[0], cells: {} },
      {
        id: ids.rowRemote,
        objectId: ids.objectRemote,
        blockInstanceId: null,
        cells: {},
      },
    ],
  });
  const base = state(inputTable);
  const mixed = {
    ...base,
    objects: {
      ...base.objects,
      [ids.objectRemote]: {
        ...base.objects[ids.object],
        id: ids.objectRemote,
        name: "Circle 01",
        geometry: { type: "circle", center: { x: 0, y: 0 }, radius: 5 },
      },
    },
    structure: {
      ...base.structure,
      propertySchemas: {
        ...base.structure.propertySchemas,
        [ids.propertyAll]: sharedSchema,
        [ids.propertyCircle]: circleSchema,
      },
    },
  };
  const editor = renderToStaticMarkup(
    createElement(DrawingTablesPanel, {
      actorId: ids.actor,
      canEdit: true,
      onCommand() {
        return true;
      },
      selectedIds: [],
      state: mixed,
    }),
  );
  assert.match(editor, /공통 상태/);
  assert.doesNotMatch(editor, /검토 상태|원형 전용/);
});

test("an empty schedule offers every property schema", () => {
  const current = state(
    table({
      columns: [
        {
          id: ids.cost,
          name: "검토 상태",
          kind: "property",
          propertySchemaId: ids.property,
        },
      ],
      rows: [],
    }),
  );
  current.structure.propertySchemas[ids.propertyCircle] = {
    ...current.structure.propertySchemas[ids.property],
    id: ids.propertyCircle,
    name: "원형 전용",
    appliesTo: ["circle"],
  };

  const editor = renderToStaticMarkup(
    createElement(DrawingTablesPanel, {
      actorId: ids.actor,
      canEdit: true,
      onCommand() {
        return true;
      },
      selectedIds: [],
      state: current,
    }),
  );
  assert.match(editor, /검토 상태/);
  assert.match(editor, /원형 전용/);
  assert.doesNotMatch(editor, /현재 행에 적용 불가/);
});

test("an existing outbox conflict makes schedule controls mutation-free", () => {
  const markup = renderToStaticMarkup(
    createElement(DrawingTablesPanel, {
      actorId: ids.actor,
      canEdit: true,
      onCommand() {
        return true;
      },
      persistenceStatus: "conflicted",
      selectedIds: [ids.object],
      state: state(),
    }),
  );
  assert.match(markup, /저장 충돌/);
  assert.doesNotMatch(markup, /<form|<input|<select|<button/);
});
