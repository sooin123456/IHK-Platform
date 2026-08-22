import assert from "node:assert/strict";
import test from "node:test";

import { destroyDrawingFixture } from "../e2e/utils/drawing-collaboration-fixture.ts";

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
    ["storage", "one.pdf", "two.ifc"],
    ["project", "id", "project-1"],
    ["user", "owner"],
    ["user", "reviewer"],
    ["user", "viewer"],
    ["user", "nonmember"],
  ]);
});
