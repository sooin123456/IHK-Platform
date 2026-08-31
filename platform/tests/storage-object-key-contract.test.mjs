import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  isProjectStorageObjectPath,
  projectSourceUploadDirectory,
  storageObjectName,
  storageObjectPath,
} from "../app/lukas/lib/storage-object-key.server.ts";

const root = process.cwd();
const read = (file) => readFile(path.join(root, file), "utf8");
const ownerId = "4cb6b458-05cd-4c65-8f68-e3a6f529db0a";
const projectId = "b1243cfe-95be-488f-9360-1aac03a83952";
const objectId = "44c7ddc7-4391-4cdc-874a-1eba19bdf88e";

const uploadScreens = [
  {
    file: "app/lukas/screens/information-requirements.tsx",
    originalNamePattern:
      /original_filename:\s*idsFile\.name\s*\|\|\s*"requirements\.ids"/,
  },
  {
    file: "app/lukas/screens/material-control.tsx",
    originalNamePattern:
      /original_filename:\s*capturedFile\.name\s*\|\|\s*"field-evidence"/,
  },
  {
    file: "app/lukas/screens/suggestion-pilot.tsx",
    originalNamePattern:
      /original_filename:\s*payload\.name\s*\|\|\s*"suggestions\.json"/,
  },
];

test("Supabase Storage keys never expose Hangul, spaces, or reserved punctuation", () => {
  const examples = [
    ["권우설계_근린생활시설_260504.ifc", `${objectId}.ifc`],
    ["한글 공백 #최종본(수정).CSV", `${objectId}.csv`],
    ["../../도면🚧 01?.ids", `${objectId}.ids`],
    ["확장자 없음", objectId],
  ];

  for (const [originalFilename, expectedObjectName] of examples) {
    assert.equal(
      storageObjectName(originalFilename, objectId),
      expectedObjectName,
    );
    const key = storageObjectPath({
      ownerId,
      projectId,
      originalFilename,
      objectId,
    });
    assert.equal(key, `${ownerId}/${projectId}/${expectedObjectName}`);
    assert.match(key, /^[A-Za-z0-9][A-Za-z0-9._/-]*$/);
    assert.doesNotMatch(key, /[\u0080-\u{10ffff}\s?#()[\]]/u);
  }
});

test("optional Storage directories are validated instead of becoming arbitrary paths", () => {
  assert.equal(
    storageObjectPath({
      ownerId,
      projectId,
      originalFilename: "현장 사진.jpg",
      directory: "material-evidence",
      objectId,
    }),
    `${ownerId}/${projectId}/material-evidence/${objectId}.jpg`,
  );
  assert.throws(
    () =>
      storageObjectPath({
        ownerId,
        projectId,
        originalFilename: "모델.ifc",
        directory: "../다른 프로젝트",
        objectId,
      }),
    /저장 폴더 형식/,
  );
});

test("metadata finalization accepts only the generated object path for its project and filename", () => {
  const storagePath = storageObjectPath({
    directory: projectSourceUploadDirectory,
    ownerId,
    projectId,
    originalFilename: "권우설계_근린생활시설_260504.PDF",
    objectId,
  });

  assert.equal(
    isProjectStorageObjectPath({
      directory: projectSourceUploadDirectory,
      ownerId,
      projectId,
      originalFilename: "권우설계_근린생활시설_260504.PDF",
      storagePath,
    }),
    true,
  );
  assert.equal(
    isProjectStorageObjectPath({
      directory: projectSourceUploadDirectory,
      ownerId,
      projectId: "00000000-0000-4000-8000-000000000099",
      originalFilename: "권우설계_근린생활시설_260504.PDF",
      storagePath,
    }),
    false,
  );
  assert.equal(
    isProjectStorageObjectPath({
      directory: projectSourceUploadDirectory,
      ownerId,
      projectId,
      originalFilename: "권우설계_근린생활시설_260504.ifc",
      storagePath,
    }),
    false,
  );
});

test("legacy upload screens use the common key builder and preserve File.name for display", async () => {
  for (const { file, originalNamePattern } of uploadScreens) {
    const source = await read(file);
    assert.match(source, /import\s*\{[^}]*\bstorageObjectPath\b[^}]*\}\s*from/);
    assert.match(source, /storageObjectPath\(\{/);
    assert.doesNotMatch(source, /function safeFilename\(/);
    assert.match(
      source,
      originalNamePattern,
      `${file}: original_filename must preserve the uploaded File.name`,
    );
    assert.doesNotMatch(
      source,
      /original_filename:\s*storageObject(?:Name|Path)\(/,
      `${file}: the ASCII Storage key must not replace the displayed original filename`,
    );
  }
});

test("large project sources use resumable Storage upload and a service-only verification record", async () => {
  const [
    packageJson,
    projectScreen,
    uploadHelper,
    edgeVerifier,
    functionConfig,
    immutableStorageMigration,
    sourceInsertGateMigration,
  ] = await Promise.all([
    read("package.json"),
    read("app/lukas/screens/project.tsx"),
    read("app/lukas/lib/project-file-upload.ts"),
    read("supabase/functions/lukas-qto-upload-verify/index.ts"),
    read("supabase/config.toml"),
    read(
      "supabase/migrations/20260831012000_lukas_qto_source_storage_immutable.sql",
    ),
    read(
      "supabase/migrations/20260831015000_lukas_qto_verified_source_insert_gate.sql",
    ),
  ]);

  assert.match(packageJson, /"tus-js-client"/);
  assert.match(uploadHelper, /from\s+["']tus-js-client["']/);
  assert.match(uploadHelper, /chunkSize:\s*6\s*\*\s*1024\s*\*\s*1024/);
  assert.match(uploadHelper, /upload\/resumable/);
  assert.match(uploadHelper, /directory:\s*projectSourceUploadDirectory/);
  assert.match(uploadHelper, /const originalFilename = file\.name\.trim\(\)/);
  assert.doesNotMatch(uploadHelper, /['"]x-upsert['"]\s*:\s*['"]true['"]/);
  assert.match(
    projectScreen,
    /functions\.invoke\(["']lukas-qto-upload-verify["']/,
  );
  assert.match(
    projectScreen,
    /Authorization:\s*`Bearer \$\{session\.access_token\}`/,
  );
  assert.match(projectScreen, /upload_verification_id:\s*verificationId/);
  assert.match(projectScreen, /lukas_qto_finalize_verified_upload/);
  assert.doesNotMatch(projectScreen, /sha256:\s*uploaded\.sha256/);

  assert.match(edgeVerifier, /auth\.getUser\(accessToken\)/);
  assert.match(edgeVerifier, /createHash\(["']sha256["']\)/);
  assert.match(edgeVerifier, /\.download\(storagePath\)/);
  assert.match(edgeVerifier, /\.from\(["']lukas_qto_verified_uploads["']\)/);
  assert.match(edgeVerifier, /verificationId/);
  assert.match(edgeVerifier, /expires_at:\s*new Date/);
  assert.doesNotMatch(edgeVerifier, /SignJWT|attestation/);
  assert.doesNotMatch(edgeVerifier, /\.remove\(/);
  assert.match(
    functionConfig,
    /\[functions\.lukas-qto-upload-verify\]\s+verify_jwt\s*=\s*true/,
  );
  assert.match(
    immutableStorageMigration,
    /create table public\.lukas_qto_verified_uploads/,
  );
  assert.match(
    immutableStorageMigration,
    /create function public\.lukas_qto_finalize_verified_upload/,
  );
  assert.match(immutableStorageMigration, /as restrictive for delete/);
  assert.match(immutableStorageMigration, /as restrictive for update/);
  assert.doesNotMatch(
    immutableStorageMigration,
    /drop policy if exists "(?:lukas qto owners|hangil staff) delete source files"/,
  );
  assert.match(sourceInsertGateMigration, /as restrictive for insert/);
  assert.match(sourceInsertGateMigration, /kind\s*=\s*'other'/);
  assert.match(sourceInsertGateMigration, /<>\s*'source-uploads'/);
});
