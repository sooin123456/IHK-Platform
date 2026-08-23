import assert from "node:assert/strict";
import test from "node:test";

const navigation = await import(
  "../app/lukas/lib/drawing-anchor-navigation.ts"
).catch(() => ({}));

const issueId = "123e4567-e89b-42d3-a456-426614174000";
const anchorId = "123e4567-e89b-42d3-a456-426614174001";
const fileId = "123e4567-e89b-42d3-a456-426614174002";

const ifcAnchor = {
  id: anchorId,
  issue_id: issueId,
  project_id: "123e4567-e89b-42d3-a456-426614174003",
  file_id: fileId,
  anchor_kind: "ifc_element",
  element_id: "42",
  ifc_global_id: "3ABCdefghijklmnopqrstu",
  camera_json: { position: [1, 2, 3], target: [4, 5, 6] },
  page_number: null,
  x: null,
  y: null,
  width: null,
  height: null,
};

test("an anchor deep link resolves only inside the requested issue and file", () => {
  assert.equal(typeof navigation.selectDrawingAnchorForView, "function");
  assert.equal(
    navigation.selectDrawingAnchorForView(
      [ifcAnchor],
      anchorId,
      issueId,
      fileId,
    ),
    ifcAnchor,
  );
  assert.equal(
    navigation.selectDrawingAnchorForView(
      [ifcAnchor],
      anchorId,
      "123e4567-e89b-42d3-a456-426614174099",
      fileId,
    ),
    null,
  );
  assert.equal(
    navigation.selectDrawingAnchorForView(
      [ifcAnchor],
      anchorId,
      issueId,
      "123e4567-e89b-42d3-a456-426614174099",
    ),
    null,
  );
  assert.equal(
    navigation.selectDrawingAnchorForView(
      [ifcAnchor],
      "not-a-uuid",
      issueId,
      fileId,
    ),
    null,
  );
});

test("anchor links preserve the exact issue, anchor, file, and IFC identity", () => {
  assert.equal(typeof navigation.drawingAnchorHref, "function");
  assert.equal(
    navigation.drawingAnchorHref(
      "123e4567-e89b-42d3-a456-426614174003",
      ifcAnchor,
    ),
    "/projects/123e4567-e89b-42d3-a456-426614174003/drawings/123e4567-e89b-42d3-a456-426614174002?issue=123e4567-e89b-42d3-a456-426614174000&anchor=123e4567-e89b-42d3-a456-426614174001&globalId=3ABCdefghijklmnopqrstu",
  );
});

test("a requested anchor never falls back to an unverified IFC identity", () => {
  assert.equal(typeof navigation.drawingLegacyGlobalId, "function");
  assert.equal(
    navigation.drawingLegacyGlobalId(null, "3ABCdefghijklmnopqrstu"),
    "3ABCdefghijklmnopqrstu",
  );
  assert.equal(
    navigation.drawingLegacyGlobalId("not-a-uuid", "3ABCdefghijklmnopqrstu"),
    null,
  );
  assert.equal(navigation.drawingLegacyGlobalId(anchorId, "forged"), null);
});

test("stored IFC and PDF evidence converts to exact viewer locations", () => {
  assert.equal(typeof navigation.drawingViewerAnchor, "function");
  assert.deepEqual(navigation.drawingViewerAnchor(ifcAnchor), {
    kind: "ifc_element",
    elementId: "42",
    ifcGlobalId: "3ABCdefghijklmnopqrstu",
    camera: { position: [1, 2, 3], target: [4, 5, 6] },
  });
  assert.deepEqual(
    navigation.drawingViewerAnchor({
      ...ifcAnchor,
      anchor_kind: "pdf_region",
      element_id: null,
      ifc_global_id: null,
      camera_json: null,
      page_number: 7,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
    }),
    {
      kind: "pdf_region",
      pageNumber: 7,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
    },
  );
  assert.equal(
    navigation.drawingViewerAnchor({
      ...ifcAnchor,
      camera_json: { position: [1, 2, "bad"], target: [4, 5, 6] },
    }),
    null,
  );
});
