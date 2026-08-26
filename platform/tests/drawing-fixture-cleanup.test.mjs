import assert from "node:assert/strict";
import test from "node:test";

import {
  destroyDrawingFixture,
  destroyDrawingP3Fixture,
} from "../e2e/utils/drawing-collaboration-fixture.ts";

test("drawing E2E cleanup attempts every resource and reports residue risk", async () => {
  const calls = [];
  const admin = {
    storage: {
      from(bucket) {
        assert.equal(bucket, "lukas-qto");
        return {
          async remove(paths) {
            calls.push(["storage", ...paths]);
            return { error: new Error("storage unavailable") };
          },
        };
      },
    },
    from(table) {
      assert.equal(table, "lukas_qto_projects");
      return {
        delete() {
          return {
            async eq(column, id) {
              calls.push(["project", column, id]);
              return { error: new Error("project locked") };
            },
          };
        },
      };
    },
    auth: {
      admin: {
        async deleteUser(id) {
          calls.push(["user", id]);
          return {
            error: id === "reviewer" ? new Error("auth timeout") : null,
          };
        },
      },
    },
  };
  const user = (id) => ({ id, email: `${id}@example.test` });

  await assert.rejects(
    destroyDrawingFixture({
      admin,
      owner: user("owner"),
      reviewer: user("reviewer"),
      viewer: user("viewer"),
      nonMember: user("nonmember"),
      projectId: "project-1",
      pdfFileId: "pdf-1",
      ifcFileId: "ifc-1",
      revisedPdfFileId: "pdf-2",
      revisedIfcFileId: "ifc-2",
      storagePaths: ["one.pdf", "two.ifc"],
    }),
    (error) =>
      error instanceof AggregateError &&
      error.errors.length === 3 &&
      /cleanup left possible residue/i.test(error.message),
  );

  assert.deepEqual(calls, [
    ["project", "id", "project-1"],
    ["storage", "one.pdf", "two.ifc"],
    ["user", "owner"],
    ["user", "reviewer"],
    ["user", "viewer"],
    ["user", "nonmember"],
  ]);
});

test("P3 cleanup attempts room and aggregate fixture teardown without masking either", async () => {
  const calls = [];
  const admin = {
    storage: {
      from() {
        return {
          async remove(paths) {
            calls.push(["storage", ...paths]);
            return { error: null };
          },
        };
      },
    },
    from() {
      return {
        delete() {
          return {
            async eq(_column, id) {
              calls.push(["project", id]);
              return { error: new Error("project cleanup failed") };
            },
          };
        },
      };
    },
    auth: {
      admin: {
        async deleteUser(id) {
          calls.push(["user", id]);
          return { error: null };
        },
      },
    },
  };
  const user = (id) => ({ id, email: `${id}@example.test` });
  const fixture = {
    admin,
    owner: user("owner"),
    editor: user("editor"),
    reviewer: user("reviewer"),
    viewer: user("viewer"),
    nonMember: user("nonmember"),
    projectId: "project-1",
    storagePaths: ["drawing.pdf", "model.ifc"],
  };

  await assert.rejects(
    destroyDrawingP3Fixture(
      fixture,
      "postgresql://not-used",
      async (received, url) => {
        calls.push(["rooms", received.projectId, url]);
        throw new AggregateError([
          new Error("room rows cleanup failed"),
          new Error("room connection cleanup failed"),
        ]);
      },
    ),
    (error) =>
      error instanceof AggregateError &&
      error.errors.length === 3 &&
      /room or fixture residue/i.test(error.message),
  );
  assert.deepEqual(calls, [
    ["rooms", "project-1", "postgresql://not-used"],
    ["project", "project-1"],
    ["storage", "drawing.pdf", "model.ifc"],
    ["user", "owner"],
    ["user", "editor"],
    ["user", "reviewer"],
    ["user", "viewer"],
    ["user", "nonmember"],
  ]);
});
