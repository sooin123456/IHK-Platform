import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
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
const entry = await vite.ssrLoadModule("/app/lukas/lib/drawing-entry.ts");
const upload = await vite.ssrLoadModule(
  "/app/lukas/lib/project-file-upload.ts",
);
const schemas = await vite.ssrLoadModule(
  "/app/lukas/lib/project-file-verification.server.ts",
);
test.after(() => vite.close());
const id = "00000000-0000-4000-8000-000000000001";

test("DWG is a distinct extension-checked source with native workspace destinations", () => {
  assert.ok(entry.projectFileKinds.includes("dwg"));
  assert.equal(entry.fileMatchesProjectKind("dwg", " PLAN.DWG "), true);
  assert.equal(entry.fileMatchesProjectKind("dwg", "PLAN.dxf"), false);
  assert.equal(
    entry.contentTypeMatchesProjectKind("dwg", "application/acad"),
    false,
  );
  assert.equal(
    entry.contentTypeMatchesProjectKind("dwg", "application/octet-stream"),
    true,
  );
  assert.equal(entry.fileMatchesProjectKind("other", "legacy.dwg"), true);
  assert.equal(
    entry.projectUploadDestination({
      fileId: id,
      kind: "dwg",
      projectId: id,
      returnPath: `/projects/${id}/files`,
      returnTo: `/projects/${id}/workspaces/${id}`,
    }),
    `/projects/${id}/workspaces/${id}?dwgSourceFileId=${id}`,
  );
  assert.equal(
    entry.projectUploadDestination({
      fileId: id,
      kind: "dwg",
      projectId: id,
      returnPath: `/projects/${id}/files`,
    }),
    `/projects/${id}/workspaces/new?sourceFileId=${id}`,
  );
  assert.equal(
    entry.drawingWorkspaceDwgUploadPath(id, id),
    `/projects/${id}/files?kind=dwg&returnTo=%2Fprojects%2F${id}%2Fworkspaces%2F${id}#upload`,
  );
});

test("DWG browser MIME is normalized before immutable direct storage and metadata", async () => {
  for (const browserContentType of [
    "application/acad",
    "image/vnd.dwg",
    "",
    "application/octet-stream",
  ]) {
    const file = new File(["AC1032body"], "PLAN.DWG", {
      type: browserContentType,
    });
    let called = false;
    const metadata = await upload.uploadProjectFileDirect({
      file,
      kind: "dwg",
      ownerId: id,
      projectId: id,
      async upload(path, source, options) {
        called = true;
        assert.equal(source, file);
        assert.match(path, /\.dwg$/);
        assert.deepEqual(options, {
          contentType: "application/octet-stream",
          upsert: false,
        });
        return { error: null };
      },
    });
    assert.equal(called, true);
    assert.equal(metadata.contentType, "application/octet-stream");
    assert.equal(
      upload.projectUploadContentType("dwg", browserContentType),
      "application/octet-stream",
    );
  }
  assert.equal(
    upload.projectUploadContentType("pdf", "application/pdf"),
    "application/pdf",
  );
  assert.equal(
    upload.projectUploadContentType("other", ""),
    "application/octet-stream",
  );
});

const verified = {
  actor_id: id,
  byte_size: 9,
  consumed_file_id: null,
  content_type: "application/octet-stream",
  expires_at: "2099-01-01T00:00:00Z",
  id,
  kind: "dwg",
  original_filename: "PLAN.DWG",
  project_id: id,
  sha256: "a".repeat(64),
  storage_path: "source/path",
};
const finalized = {
  byteSize: 9,
  contentType: "application/octet-stream",
  fileId: id,
  kind: "dwg",
  originalFilename: "PLAN.DWG",
  previousByteSize: null,
  previousFileId: null,
  previousSha256: null,
  previousStoragePath: null,
  sha256: "a".repeat(64),
  storagePath: "source/path",
};
for (const [name, schema, base, field] of [
  [
    "verified",
    schemas.verifiedProjectUploadSchema,
    verified,
    "dwg_header_version",
  ],
  [
    "finalized",
    schemas.finalizedProjectUploadSchema,
    finalized,
    "dwgHeaderVersion",
  ],
]) {
  test(`${name} evidence requires a DWG header and rejects version claims for every other kind`, () => {
    for (const version of ["AC1032", "AC0000"]) {
      const parsed = schema.parse({ ...base, [field]: version });
      assert.equal(parsed[field], version);
    }
    for (const version of [
      undefined,
      null,
      "AC103",
      "AC10320",
      "ac1032",
      "AC１２３４",
      "AC1032\n",
      1032,
    ])
      assert.equal(
        schema.safeParse({ ...base, [field]: version }).success,
        false,
        String(version),
      );
    for (const kind of entry.projectFileKinds.filter(
      (kind) => kind !== "dwg",
    )) {
      assert.equal(schema.safeParse({ ...base, kind }).success, true, kind);
      assert.equal(
        schema.safeParse({ ...base, kind, [field]: null }).success,
        true,
        kind,
      );
      assert.equal(
        schema.safeParse({ ...base, kind, [field]: "AC1032" }).success,
        false,
        kind,
      );
    }
  });
}
