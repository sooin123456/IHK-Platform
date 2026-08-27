import assert from "node:assert/strict";
import test from "node:test";

import { loadDrawingRevisionSources } from "../app/lukas/lib/drawing-workspace.server.ts";
import {
  p5Ids,
  p5IfcSource,
  p5PdfSource,
  p5SourceRow,
} from "./fixtures/drawing-workspace-p5-database-fixtures.mjs";

test("source loader returns exact active PDF and IFC payloads", async () => {
  const calls = [];
  const rows = [p5SourceRow(p5PdfSource), p5SourceRow(p5IfcSource)];
  const client = {
    from(table) {
      calls.push(table);
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        order() {
          return query;
        },
        gt() {
          return query;
        },
        limit() {
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return query;
    },
  };
  const result = await loadDrawingRevisionSources(
    client,
    p5Ids.project,
    p5Ids.revision,
  );
  assert.deepEqual(result, [p5PdfSource, p5IfcSource]);
  assert.deepEqual(calls, ["lukas_drawing_object_sources"]);
});

test("source loader rejects cross-revision evidence", async () => {
  const bad = { ...p5SourceRow(p5PdfSource), revision_id: p5Ids.project };
  const client = {
    from() {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        order() {
          return query;
        },
        gt() {
          return query;
        },
        limit() {
          return Promise.resolve({ data: [bad], error: null });
        },
      };
      return query;
    },
  };
  await assert.rejects(
    loadDrawingRevisionSources(client, p5Ids.project, p5Ids.revision),
    /source metadata is invalid/i,
  );
});
