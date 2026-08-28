import assert from "node:assert/strict";
import test from "node:test";

import { resolveProjectFileDownload } from "../app/lukas/lib/project-file-download.server.ts";

const ids = {
  project: "40000000-0000-4000-8000-000000000001",
  file: "40000000-0000-4000-8000-000000000002",
};

function clientFor(file) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.equal(table, "lukas_qto_files");
      const filters = [];
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          filters.push([column, value]);
          return query;
        },
        async maybeSingle() {
          const matches =
            file && filters.every(([column, value]) => file[column] === value);
          return { data: matches ? file : null, error: null };
        },
      };
      return query;
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "lukas-qto");
        return {
          async createSignedUrl(path, ttl) {
            calls.push(["sign", path, ttl]);
            return {
              data: { signedUrl: `https://storage.test/${path}` },
              error: null,
            };
          },
        };
      },
    },
  };
}

test("on-demand project download signs only the exact immutable project file", async () => {
  const client = clientFor({
    id: ids.file,
    project_id: ids.project,
    storage_path: `projects/${ids.project}/original.ifc`,
    immutable: true,
  });
  const signedUrl = await resolveProjectFileDownload(client, {
    projectId: ids.project,
    fileId: ids.file,
  });
  assert.equal(
    signedUrl,
    `https://storage.test/projects/${ids.project}/original.ifc`,
  );
  assert.deepEqual(client.calls, [
    ["sign", `projects/${ids.project}/original.ifc`, 60],
  ]);
});

test("on-demand project download fails closed before signing when scope or immutability differs", async () => {
  for (const file of [
    null,
    {
      id: ids.file,
      project_id: "40000000-0000-4000-8000-000000000003",
      storage_path: "projects/other/original.ifc",
      immutable: true,
    },
    {
      id: ids.file,
      project_id: ids.project,
      storage_path: `projects/${ids.project}/mutable.ifc`,
      immutable: false,
    },
  ]) {
    const client = clientFor(file);
    await assert.rejects(
      resolveProjectFileDownload(client, {
        projectId: ids.project,
        fileId: ids.file,
      }),
      (error) => error instanceof Response && error.status === 404,
    );
    assert.deepEqual(client.calls, []);
  }
});
