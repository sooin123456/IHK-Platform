import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
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
    file: "app/lukas/screens/project.tsx",
    originalNamePattern: /original_filename:\s*originalFilename/,
  },
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

test("all upload screens use the common key builder and preserve File.name for display", async () => {
  for (const { file, originalNamePattern } of uploadScreens) {
    const source = await read(file);
    assert.match(source, /import \{ storageObjectPath \}/);
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
