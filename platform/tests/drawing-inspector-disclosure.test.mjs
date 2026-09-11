import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
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
const { DrawingInspector } = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-inspector.tsx",
);

test.after(() => vite.close());

const ids = {
  actor: "00000000-0000-4000-8000-000000000301",
  layer: "00000000-0000-4000-8000-000000000302",
  object: "00000000-0000-4000-8000-000000000303",
  project: "00000000-0000-4000-8000-000000000304",
  revision: "00000000-0000-4000-8000-000000000305",
  schema: "00000000-0000-4000-8000-000000000306",
  style: "00000000-0000-4000-8000-000000000307",
  value: "00000000-0000-4000-8000-000000000308",
};

const state = {
  revisionId: ids.revision,
  layers: {
    [ids.layer]: {
      id: ids.layer,
      name: "기본 레이어",
      visible: true,
      locked: false,
      systemKind: "work",
      version: 1,
    },
  },
  objects: {
    [ids.object]: {
      id: ids.object,
      name: "회의실 원",
      layerId: ids.layer,
      geometry: { type: "circle", center: { x: 100, y: 100 }, radius: 50 },
      styleId: ids.style,
      style: {},
      version: 1,
    },
  },
  structure: {
    blockInstances: {},
    propertySchemas: {
      [ids.schema]: {
        id: ids.schema,
        revisionId: ids.revision,
        name: "공종",
        valueType: "text",
        enumOptions: [],
        appliesTo: ["circle"],
        required: false,
        version: 1,
      },
    },
    propertyValues: {
      [ids.value]: {
        id: ids.value,
        schemaId: ids.schema,
        objectId: ids.object,
        blockInstanceId: null,
        value: "인테리어",
        version: 1,
      },
    },
    styles: {
      [ids.style]: {
        id: ids.style,
        revisionId: ids.revision,
        name: "기본 선",
        value: {
          stroke: "#1e293b",
          strokeWidth: 2,
          fill: "#ffffff",
          fontSize: 14,
        },
        version: 1,
      },
    },
  },
};

function renderInspector(canEdit, selectedIds = [ids.object]) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: React.createElement(DrawingInspector, {
          actorId: ids.actor,
          canCreateQuantity: false,
          canEdit,
          canLinkIssues: false,
          hasUnconfirmedChanges: false,
          issueLinks: [],
          issues: [],
          onCommand() {},
          projectId: ids.project,
          quantityLineage: null,
          revisionStatus: "draft",
          selectedIds,
          state,
        }),
      },
    ],
    { initialEntries: ["/"] },
  );
  const markup = renderToStaticMarkup(
    React.createElement(RouterProvider, { router }),
  );
  router.dispose();
  return markup;
}

test("editable inspector presents basic object fields before collapsed advanced controls", () => {
  const markup = renderInspector(true);
  const basicForm = markup.indexOf('aria-label="기본 객체 속성"');
  const advanced = markup.indexOf("<details");

  assert.ok(basicForm >= 0, "basic object form should have an accessible name");
  assert.match(markup.slice(basicForm, advanced), /\[&amp;_input\]:min-w-0/);
  assert.match(markup.slice(basicForm, advanced), /\[&amp;_label\]:min-w-0/);
  assert.ok(
    advanced > basicForm,
    "advanced controls must follow the basic form",
  );
  assert.match(markup.slice(advanced), /고급 속성/);
  assert.match(markup.slice(advanced), /공유 스타일/);
  assert.match(markup.slice(advanced), /사용자 속성/);
  assert.doesNotMatch(
    markup.slice(advanced, markup.indexOf(">", advanced)),
    /open/,
  );
});

test("viewer sees selected values without receiving mutation forms", () => {
  const markup = renderInspector(false);
  const basicValues = markup.indexOf("회의실 원");
  const advanced = markup.indexOf("<details");

  assert.match(markup, /회의실 원/);
  assert.match(markup, /기본 레이어/);
  assert.match(markup, /#1e293b/);
  assert.match(markup, /인테리어/);
  assert.ok(advanced > basicValues, "read-only advanced values follow basics");
  assert.match(markup.slice(advanced), /사용자 속성/);
  assert.doesNotMatch(markup, /<form/);
  assert.doesNotMatch(markup, /속성 적용|사용자 속성 적용|이슈 연결/);
});

test("empty selection stays a concise selection prompt", () => {
  const markup = renderInspector(true, []);

  assert.match(markup, /객체를 선택하면 속성을 편집할 수 있습니다/);
  assert.doesNotMatch(markup, /<form|<details|공유 스타일|사용자 속성/);
});
