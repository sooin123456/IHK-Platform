import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});

const styleEditor = await vite
  .ssrLoadModule("/app/lukas/components/drawing-styles-panel.tsx")
  .catch(() => ({}));
const { updateDrawingStyleCommand } = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-commands.ts",
);

test.after(() => vite.close());

const revisionId = "00000000-0000-4000-8000-000000000200";
const styleId = "00000000-0000-4000-8000-000000000201";
const actorId = "00000000-0000-4000-8000-000000000202";

function definition(patch = {}) {
  return {
    id: styleId,
    revisionId,
    name: "검토 주석",
    value: {
      stroke: "#112233",
      strokeWidth: 2,
      fill: "#44556680",
      fontSize: 14,
    },
    version: 1,
    ...patch,
  };
}

function state(style = definition()) {
  return {
    revisionId,
    layers: {},
    objects: {},
    structure: { blocks: {}, styles: { [style.id]: style } },
  };
}

test("native style colors update the HEX draft and preserve fill alpha", () => {
  const {
    applyDrawingStyleDraftNativeColor,
    createDrawingStyleDraft,
    editDrawingStyleDraft,
    setDrawingStyleDraftFillNone,
  } = styleEditor;
  assert.equal(typeof createDrawingStyleDraft, "function");
  assert.equal(typeof editDrawingStyleDraft, "function");
  assert.equal(typeof applyDrawingStyleDraftNativeColor, "function");
  assert.equal(typeof setDrawingStyleDraftFillNone, "function");

  let draft = createDrawingStyleDraft(definition());
  draft = applyDrawingStyleDraftNativeColor(draft, "stroke", "#aabbcc");
  assert.equal(draft.values.stroke, "#aabbcc");
  assert.equal(draft.nativeColors.stroke, "#aabbcc");

  draft = editDrawingStyleDraft(draft, "fill", "#12345680");
  assert.equal(draft.nativeColors.fill, "#123456");
  draft = applyDrawingStyleDraftNativeColor(draft, "fill", "#abcdef");
  assert.equal(draft.values.fill, "#abcdef80");
  assert.equal(draft.nativeColors.fill, "#abcdef");

  draft = setDrawingStyleDraftFillNone(draft, true);
  assert.equal(draft.values.fillNone, true);
  assert.equal(draft.values.fill, "#abcdef80");
  draft = setDrawingStyleDraftFillNone(draft, false);
  assert.equal(draft.values.fillNone, false);
  assert.equal(draft.values.fill, "#abcdef80");
});

test("style drafts rebase clean fields but preserve and flag a remotely changed dirty field", () => {
  const {
    createDrawingStyleDraft,
    editDrawingStyleDraft,
    reconcileDrawingStyleDraft,
  } = styleEditor;
  assert.equal(typeof reconcileDrawingStyleDraft, "function");

  const local = editDrawingStyleDraft(
    createDrawingStyleDraft(definition()),
    "stroke",
    "#aabbcc",
  );
  const unrelatedRemote = definition({
    version: 2,
    value: {
      ...definition().value,
      fill: "#77889940",
    },
  });
  const rebased = reconcileDrawingStyleDraft(local, unrelatedRemote);
  assert.equal(rebased.values.stroke, "#aabbcc");
  assert.equal(rebased.values.fill, "#77889940");
  assert.equal(rebased.nativeColors.fill, "#778899");
  assert.deepEqual(rebased.conflictedFields, []);
  assert.equal(rebased.styleVersion, 2);

  const conflictingRemote = definition({
    version: 3,
    value: {
      ...unrelatedRemote.value,
      stroke: "#000000",
    },
  });
  const conflicted = reconcileDrawingStyleDraft(rebased, conflictingRemote);
  assert.equal(conflicted.values.stroke, "#aabbcc");
  assert.equal(conflicted.values.fill, "#77889940");
  assert.deepEqual(conflicted.conflictedFields, ["stroke"]);
  assert.equal(conflicted.styleVersion, 3);

  const matchedLatest = editDrawingStyleDraft(conflicted, "stroke", "#000000");
  assert.deepEqual(matchedLatest.dirtyFields, []);
  assert.deepEqual(matchedLatest.conflictedFields, []);
});

test("style conflicts survive unrelated projections and clear when canonical converges", () => {
  const {
    createDrawingStyleDraft,
    editDrawingStyleDraft,
    reconcileDrawingStyleDraft,
  } = styleEditor;
  const local = editDrawingStyleDraft(
    createDrawingStyleDraft(definition()),
    "stroke",
    "#aabbcc",
  );
  const conflicted = reconcileDrawingStyleDraft(
    local,
    definition({
      version: 2,
      value: { ...definition().value, stroke: "#000000" },
    }),
  );
  assert.deepEqual(conflicted.conflictedFields, ["stroke"]);

  const unrelatedProjection = reconcileDrawingStyleDraft(
    conflicted,
    definition({
      version: 3,
      value: {
        ...definition().value,
        stroke: "#000000",
        fill: "#77889940",
      },
    }),
  );
  assert.equal(unrelatedProjection.values.stroke, "#aabbcc");
  assert.deepEqual(unrelatedProjection.dirtyFields, ["stroke"]);
  assert.deepEqual(unrelatedProjection.conflictedFields, ["stroke"]);

  const converged = reconcileDrawingStyleDraft(
    unrelatedProjection,
    definition({
      version: 4,
      value: {
        ...definition().value,
        stroke: "#aabbcc",
        fill: "#77889940",
      },
    }),
  );
  assert.equal(converged.values.stroke, "#aabbcc");
  assert.deepEqual(converged.dirtyFields, []);
  assert.deepEqual(converged.conflictedFields, []);
});

test("a clean style draft adopts the latest remote definition", () => {
  const { createDrawingStyleDraft, reconcileDrawingStyleDraft } = styleEditor;
  const remote = definition({
    name: "원격 주석",
    value: {
      stroke: "#abcdef",
      strokeWidth: 4,
      fill: null,
    },
    version: 2,
  });
  const reconciled = reconcileDrawingStyleDraft(
    createDrawingStyleDraft(definition()),
    remote,
  );
  assert.equal(reconciled.values.name, "원격 주석");
  assert.equal(reconciled.values.stroke, "#abcdef");
  assert.equal(reconciled.values.strokeWidth, "4");
  assert.equal(reconciled.values.fillNone, true);
  assert.equal(reconciled.values.fontSize, "");
  assert.deepEqual(reconciled.dirtyFields, []);
});

test("style draft submission validates the real model and emits one version-aware put_style", () => {
  const {
    buildDrawingStyleDraftSubmission,
    createDrawingStyleDraft,
    editDrawingStyleDraft,
    setDrawingStyleDraftFillNone,
  } = styleEditor;
  assert.equal(typeof buildDrawingStyleDraftSubmission, "function");

  let draft = createDrawingStyleDraft(definition());
  draft = editDrawingStyleDraft(draft, "name", "검토 주석 변경");
  draft = editDrawingStyleDraft(draft, "strokeWidth", "3.5");
  draft = editDrawingStyleDraft(draft, "fontSize", "18");
  draft = setDrawingStyleDraftFillNone(draft, true);
  const patch = buildDrawingStyleDraftSubmission(draft);
  assert.deepEqual(patch, {
    name: "검토 주석 변경",
    value: {
      stroke: "#112233",
      strokeWidth: 3.5,
      fill: null,
      fontSize: 18,
    },
  });

  const command = updateDrawingStyleCommand(state(), actorId, styleId, patch);
  assert.equal(command.actions.length, 1);
  assert.equal(command.actions[0].kind, "put_style");
  assert.equal(command.actions[0].baseVersion, 1);
  assert.deepEqual(command.actions[0].entity.value, patch.value);

  const invalidWidth = editDrawingStyleDraft(draft, "strokeWidth", "0");
  assert.throws(() => buildDrawingStyleDraftSubmission(invalidWidth));
  const invalidFont = editDrawingStyleDraft(draft, "fontSize", "10001");
  assert.throws(() => buildDrawingStyleDraftSubmission(invalidFont));
  const invalidFill = editDrawingStyleDraft(
    setDrawingStyleDraftFillNone(draft, false),
    "fill",
    "#12345",
  );
  assert.throws(() => buildDrawingStyleDraftSubmission(invalidFill));
});

test("accepted style submissions remain local until matching canonical persistence settles", () => {
  const {
    buildDrawingStyleDraftSubmission,
    createDrawingStyleDraft,
    editDrawingStyleDraft,
    markDrawingStyleDraftSubmitted,
    settleDrawingStyleDraft,
  } = styleEditor;
  assert.equal(typeof markDrawingStyleDraftSubmitted, "function");
  assert.equal(typeof settleDrawingStyleDraft, "function");

  const draft = editDrawingStyleDraft(
    createDrawingStyleDraft(definition()),
    "name",
    "내 주석",
  );
  const patch = buildDrawingStyleDraftSubmission(draft);

  const rejected = markDrawingStyleDraftSubmitted(draft, patch, false);
  assert.equal(rejected.submission, null);
  assert.equal(rejected.submissionRejected, true);
  assert.equal(rejected.values.name, "내 주석");
  assert.deepEqual(rejected.dirtyFields, ["name"]);

  const submitted = markDrawingStyleDraftSubmitted(draft, patch, true);
  assert.notEqual(submitted.submission, null);
  assert.equal(submitted.values.name, "내 주석");
  assert.equal(submitted.baselineValues.name, "검토 주석");

  const projected = definition({ ...patch, version: 2 });
  const pending = settleDrawingStyleDraft(submitted, projected, "pending");
  assert.notEqual(pending.submission, null);
  assert.equal(pending.values.name, "내 주석");

  const settled = settleDrawingStyleDraft(pending, projected, "settled");
  assert.equal(settled.submission, null);
  assert.equal(settled.submissionRejected, false);
  assert.equal(settled.baselineValues.name, "내 주석");
  assert.deepEqual(settled.dirtyFields, []);

  const failed = settleDrawingStyleDraft(submitted, definition(), "failed");
  assert.equal(failed.submission, null);
  assert.equal(failed.submissionRejected, true);
  assert.deepEqual(failed.conflictedFields, ["name"]);
  assert.equal(failed.values.name, "내 주석");
});

test("editors receive visible paired color controls and the complete supported style fields", () => {
  const { DrawingStylesPanel } = styleEditor;
  assert.equal(typeof DrawingStylesPanel, "function");
  const markup = renderToStaticMarkup(
    createElement(DrawingStylesPanel, {
      actorId,
      canEdit: true,
      onCommand() {
        return true;
      },
      state: state(),
    }),
  );
  assert.match(markup, /type="color"/);
  assert.match(markup, /선 색상 HEX/);
  assert.match(markup, /채우기 \/ 텍스트 색상 HEX/);
  assert.match(markup, /name="fillNone"/);
  assert.match(markup, /채우기 없음/);
  assert.match(markup, /name="strokeWidth"/);
  assert.match(markup, /name="fontSize"/);
  assert.match(markup, /value="#445566"/);
  assert.match(markup, /value="#44556680"/);
  assert.doesNotMatch(markup, /type="hidden"/);
});

test("style number inputs accept every positive canonical value", () => {
  const { DrawingStylesPanel } = styleEditor;
  const tiny = definition({
    value: {
      ...definition().value,
      strokeWidth: 1e-7,
      fontSize: 1e-7,
    },
  });
  const markup = renderToStaticMarkup(
    createElement(DrawingStylesPanel, {
      actorId,
      canEdit: true,
      onCommand() {
        return true;
      },
      state: state(tiny),
    }),
  );
  assert.match(markup, /name="strokeWidth"[^>]*value="1e-7"/);
  assert.match(markup, /name="fontSize"[^>]*value="1e-7"/);
  assert.doesNotMatch(markup, /min="0\.000001"/);
});

test("an existing outbox conflict makes style controls mutation-free", () => {
  const { DrawingStylesPanel } = styleEditor;
  const markup = renderToStaticMarkup(
    createElement(DrawingStylesPanel, {
      actorId,
      canEdit: true,
      onCommand() {
        return true;
      },
      persistenceStatus: "conflicted",
      state: state(),
    }),
  );
  assert.match(markup, /저장 충돌/);
  assert.doesNotMatch(markup, /<form|<input|<button/);
});

test("viewers receive labeled style values and no mutation controls", () => {
  const { DrawingStylesPanel } = styleEditor;
  const markup = renderToStaticMarkup(
    createElement(DrawingStylesPanel, {
      actorId,
      canEdit: false,
      onCommand() {
        return false;
      },
      state: state(),
    }),
  );
  assert.match(markup, /<dl/);
  assert.match(markup, /선 색상/);
  assert.match(markup, /#112233/);
  assert.match(markup, /선 두께/);
  assert.match(markup, /채우기 \/ 텍스트 색상/);
  assert.match(markup, /#44556680/);
  assert.match(markup, /글꼴 크기/);
  assert.doesNotMatch(markup, /<form|<input|<button/);
  assert.doesNotMatch(markup, /스타일 추가|스타일 저장|스타일 삭제/);
});
