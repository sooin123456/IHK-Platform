import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
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

const titleServer = await vite
  .ssrLoadModule("/app/lukas/lib/drawing-document-title.server.ts")
  .catch(() => ({}));
const titleComponent = await vite
  .ssrLoadModule("/app/lukas/components/drawing-document-title.tsx")
  .catch(() => ({}));
const workspaceScreen = await vite
  .ssrLoadModule("/app/lukas/screens/drawing-workspace.tsx")
  .catch(() => ({}));

test.after(() => vite.close());

const ids = {
  project: "50000000-0000-4000-8000-000000000001",
  document: "50000000-0000-4000-8000-000000000002",
};

function titleClient({ data, error = null }) {
  const observations = [];
  const client = {
    from(table) {
      const call = { table, update: null, filters: [], select: null };
      observations.push(call);
      const chain = {
        update(value) {
          call.update = value;
          return chain;
        },
        eq(column, value) {
          call.filters.push([column, value]);
          return chain;
        },
        select(columns) {
          call.select = columns;
          return chain;
        },
        maybeSingle: async () => ({ data, error }),
      };
      return chain;
    },
  };
  return { client, observations };
}

function titleForm(entries = []) {
  const form = new FormData();
  for (const [name, value] of entries) form.append(name, value);
  return form;
}

function renderTitle(props) {
  const Component = titleComponent.DrawingDocumentTitle;
  const router = createMemoryRouter(
    [{ path: "/", element: createElement(Component, props) }],
    { initialEntries: ["/"] },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

test("renameDrawingDocument scopes the compare-and-set update to the canonical project and document", async () => {
  const fixture = titleClient({
    data: { id: ids.document, title: "A-101 평면" },
  });

  const result = await titleServer.renameDrawingDocument(fixture.client, {
    projectId: ids.project,
    documentId: ids.document,
    expectedTitle: "새 도면",
    title: " A-101 평면 ",
  });

  assert.deepEqual(result, { id: ids.document, title: "A-101 평면" });
  assert.deepEqual(fixture.observations, [
    {
      table: "lukas_drawing_documents",
      update: { title: "A-101 평면" },
      filters: [
        ["project_id", ids.project],
        ["id", ids.document],
        ["title", "새 도면"],
      ],
      select: "id,title",
    },
  ]);
});

test("title mutation parser rejects empty, oversized, duplicate, and unexpected fields", () => {
  const valid = [
    ["intent", "rename_drawing_document"],
    ["expectedTitle", "새 도면"],
    ["title", "A-101 평면"],
  ];
  assert.deepEqual(
    titleServer.parseDrawingDocumentTitleForm(titleForm(valid)),
    {
      intent: "rename_drawing_document",
      expectedTitle: "새 도면",
      title: "A-101 평면",
    },
  );
  for (const entries of [
    [valid[0], valid[1], ["title", "   "]],
    [valid[0], valid[1], ["title", "가".repeat(161)]],
    [...valid, ["title", "두 번째 이름"]],
    [...valid, ["projectId", ids.project]],
    [["intent", "rename_document"], valid[1], valid[2]],
  ])
    assert.throws(
      () => titleServer.parseDrawingDocumentTitleForm(titleForm(entries)),
      { name: "ZodError" },
    );
});

test("compare-and-set accepts a historical 240-character title while new titles remain bounded to 160", async () => {
  const historicalTitle = "기".repeat(240);
  const fixture = titleClient({
    data: { id: ids.document, title: "새 제목" },
  });
  assert.deepEqual(
    titleServer.parseDrawingDocumentTitleForm(
      titleForm([
        ["intent", "rename_drawing_document"],
        ["expectedTitle", historicalTitle],
        ["title", "새 제목"],
      ]),
    ),
    {
      intent: "rename_drawing_document",
      expectedTitle: historicalTitle,
      title: "새 제목",
    },
  );
  await titleServer.renameDrawingDocument(fixture.client, {
    projectId: ids.project,
    documentId: ids.document,
    expectedTitle: historicalTitle,
    title: "새 제목",
  });
  assert.deepEqual(fixture.observations[0].filters.at(-1), [
    "title",
    historicalTitle,
  ]);
  assert.throws(() =>
    titleServer.parseDrawingDocumentTitleForm(
      titleForm([
        ["intent", "rename_drawing_document"],
        ["expectedTitle", historicalTitle],
        ["title", "신".repeat(161)],
      ]),
    ),
  );
});

test("renameDrawingDocument exposes compare conflicts and rejected database writes", async () => {
  await assert.rejects(
    titleServer.renameDrawingDocument(titleClient({ data: null }).client, {
      projectId: ids.project,
      documentId: ids.document,
      expectedTitle: "새 도면",
      title: "A-101 평면",
    }),
    { name: "DrawingWorkspaceConflictError" },
  );
  await assert.rejects(
    titleServer.renameDrawingDocument(
      titleClient({
        data: null,
        error: { code: "42501", message: "raw policy detail" },
      }).client,
      {
        projectId: ids.project,
        documentId: ids.document,
        expectedTitle: "새 도면",
        title: "A-101 평면",
      },
    ),
    { name: "DrawingWorkspaceRejectedError" },
  );
});

test("title scope permits only editable draft capabilities", () => {
  for (const capability of ["admin", "editor"])
    assert.doesNotThrow(() =>
      titleServer.assertDrawingDocumentTitleScope(capability, "draft"),
    );
  for (const [capability, status] of [
    ["viewer", "draft"],
    ["reviewer", "draft"],
    ["editor", "review_requested"],
    ["admin", "approved"],
  ])
    assert.throws(
      () => titleServer.assertDrawingDocumentTitleScope(capability, status),
      { name: /DrawingWorkspace(Rejected|Conflict)Error/ },
    );
});

test("editable draft title renders an accessible native edit form in the h1 area", () => {
  const html = renderTitle({
    title: "새 도면",
    canRename: true,
  });
  assert.match(html, /<h1[^>]*>새 도면<\/h1>/);
  assert.match(html, /<summary[^>]*>.*도면 이름 변경.*<\/summary>/s);
  assert.match(
    html,
    /<label[^>]*for="drawing-document-title">도면 이름<\/label>/,
  );
  assert.match(
    html,
    /<input(?=[^>]*name="expectedTitle")(?=[^>]*type="hidden")(?=[^>]*value="새 도면")[^>]*>/,
  );
  assert.match(html, /id="drawing-document-title"[^>]*name="title"/);
  assert.match(html, /<button[^>]*type="submit"[^>]*>이름 저장<\/button>/);
  assert.match(html, /<button[^>]*type="button"[^>]*>취소<\/button>/);
});

test("a failed dirty draft survives a concurrent server title change", () => {
  assert.equal(
    titleComponent.drawingDocumentTitleDraftAfterExternalTitle({
      currentDraft: "제출했지만 충돌한 이름",
      externalTitle: "다른 사용자의 이름",
      dirty: true,
    }),
    "제출했지만 충돌한 이름",
  );
  assert.equal(
    titleComponent.drawingDocumentTitleDraftAfterExternalTitle({
      currentDraft: "이전 이름",
      externalTitle: "저장된 이름",
      dirty: false,
    }),
    "저장된 이름",
  );
});

test("programmatic save or cancel closure restores focus to the disclosure summary", () => {
  let open = true;
  let focused = 0;
  titleComponent.closeDrawingDocumentTitleEditor(
    {
      removeAttribute(name) {
        assert.equal(name, "open");
        open = false;
      },
    },
    { focus: () => focused++ },
  );
  assert.equal(open, false);
  assert.equal(focused, 1);
});

test("workspace rename action boundary rejects Viewer and non-draft scopes before UPDATE", async () => {
  for (const [capability, status] of [
    ["viewer", "draft"],
    ["editor", "review_requested"],
  ]) {
    const fixture = titleClient({
      data: { id: ids.document, title: "변경 이름" },
    });
    await assert.rejects(
      titleServer.renameDrawingDocumentFromWorkspaceAction({
        client: fixture.client,
        capability,
        form: titleForm([
          ["intent", "rename_drawing_document"],
          ["expectedTitle", "새 도면"],
          ["title", "변경 이름"],
        ]),
        projectId: ids.project,
        workspace: {
          document: {
            id: ids.document,
            revision: { status },
          },
        },
      }),
      { name: /DrawingWorkspace(Rejected|Conflict)Error/ },
    );
    assert.deepEqual(fixture.observations, []);
  }
});

test("a conflicted rename revalidates the canonical title even when React Router defaults to false", () => {
  const formData = titleForm([
    ["intent", "rename_drawing_document"],
    ["expectedTitle", "새 도면"],
    ["title", "충돌한 이름"],
  ]);
  assert.equal(
    workspaceScreen.shouldRevalidate({
      actionStatus: 409,
      currentUrl: new URL(
        `http://app.test/projects/${ids.project}/workspaces/${ids.document}`,
      ),
      defaultShouldRevalidate: false,
      formData,
      nextUrl: new URL(
        `http://app.test/projects/${ids.project}/workspaces/${ids.document}`,
      ),
    }),
    true,
  );
  formData.set("intent", "relink_anchor");
  assert.equal(
    workspaceScreen.shouldRevalidate({
      actionStatus: 409,
      currentUrl: new URL("http://app.test/current"),
      defaultShouldRevalidate: false,
      formData,
      nextUrl: new URL("http://app.test/current"),
    }),
    false,
  );
});

test("preview, Viewer, and non-draft headers do not offer title editing", () => {
  for (const props of [
    { title: "미리보기 도면", canRename: false, previewMode: true },
    { title: "Viewer 도면", canRename: false },
    { title: "승인 도면", canRename: false },
  ]) {
    const html = renderTitle(props);
    assert.match(html, new RegExp(`<h1[^>]*>${props.title}</h1>`));
    assert.doesNotMatch(html, /도면 이름 변경|이름 저장/);
  }
});
