import assert from "node:assert/strict";
import test from "node:test";

import {
  destroyDrawingFixture,
  destroyDrawingP3Fixture,
} from "../e2e/utils/drawing-collaboration-fixture.ts";

test("drawing E2E cleanup attempts every resource and reports residue risk", async () => {
  const calls = [];
  const admin = {
    async rpc(name, args) {
      assert.equal(name, "lukas_qto_purge_project");
      calls.push(["purge", args.p_project_id]);
      return {
        data: { status: "HELD", reason: "project locked" },
        error: null,
      };
    },
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
    from() {
      throw new Error("cleanup must not directly delete a project");
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
  const retentionClient = {
    async rpc(name, args) {
      calls.push([
        "retention",
        name,
        args.p_project_id ?? args.p_organization_id,
      ]);
      return { error: null };
    },
  };
  const user = (id) => ({ id, email: `${id}@example.test` });

  await assert.rejects(
    destroyDrawingFixture({
      admin,
      retentionClient,
      owner: user("owner"),
      reviewer: user("reviewer"),
      viewer: user("viewer"),
      nonMember: user("nonmember"),
      projectId: "project-1",
      organizationId: "organization-1",
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
    ["retention", "lukas_qto_set_retention_policy", "organization-1"],
    ["retention", "lukas_qto_request_project_deletion", "project-1"],
    ["purge", "project-1"],
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
    async rpc(name, args) {
      assert.equal(name, "lukas_qto_purge_project");
      calls.push(["purge", args.p_project_id]);
      return {
        data: { status: "HELD", reason: "project cleanup failed" },
        error: null,
      };
    },
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
    from(table) {
      if (table === "lukas_qto_files")
        return {
          select(columns) {
            assert.equal(columns, "storage_path");
            return {
              async eq(column, id) {
                calls.push(["file-paths", column, id]);
                return {
                  data: [
                    { storage_path: "drawing.pdf" },
                    { storage_path: "uploaded-report.csv" },
                    { storage_path: "uploaded-manifest.csv" },
                  ],
                  error: null,
                };
              },
            };
          },
        };
      throw new Error(`unexpected cleanup table: ${table}`);
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
  const retentionClient = {
    async rpc(name, args) {
      calls.push([
        "retention",
        name,
        args.p_project_id ?? args.p_organization_id,
      ]);
      return { error: null };
    },
  };
  const user = (id) => ({ id, email: `${id}@example.test` });
  const fixture = {
    admin,
    retentionClient,
    owner: user("owner"),
    editor: user("editor"),
    reviewer: user("reviewer"),
    viewer: user("viewer"),
    nonMember: user("nonmember"),
    projectId: "project-1",
    organizationId: "organization-1",
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
    ["file-paths", "project_id", "project-1"],
    ["retention", "lukas_qto_set_retention_policy", "organization-1"],
    ["retention", "lukas_qto_request_project_deletion", "project-1"],
    ["purge", "project-1"],
    [
      "storage",
      "drawing.pdf",
      "model.ifc",
      "uploaded-report.csv",
      "uploaded-manifest.csv",
    ],
    ["user", "owner"],
    ["user", "editor"],
    ["user", "reviewer"],
    ["user", "viewer"],
    ["user", "nonmember"],
  ]);
});
