import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createServer } from "vite";

const handlers = [];
globalThis.Deno = {
  env: { get: () => undefined },
  serve(handler) {
    handlers.push(handler);
  },
};
const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: {
      "npm:@supabase/supabase-js@2.112.3": "@supabase/supabase-js",
    },
  },
  server: { middlewareMode: true },
});
const verifier = await vite.ssrLoadModule(
  "/supabase/functions/lukas-qto-upload-verify/index.ts",
);
delete globalThis.Deno;
test.after(() => vite.close());

const ids = {
  actor: "10000000-0000-4000-8000-000000000001",
  owner: "10000000-0000-4000-8000-000000000002",
  project: "10000000-0000-4000-8000-000000000003",
  object: "10000000-0000-4000-8000-000000000004",
  verification: "10000000-0000-4000-8000-000000000005",
};

function queryResult(result) {
  const query = {
    eq() {
      return query;
    },
    is() {
      return query;
    },
    maybeSingle: async () => result,
    select() {
      return query;
    },
    single: async () => result,
  };
  return query;
}

function uploadVerifierScenario({
  appRole,
  byteSize: requestedByteSize,
  chunks = [new TextEncoder().encode("%PDF-1.7\n")],
  existingVerification = null,
  insertErrorCode = null,
  kind = "pdf",
  membershipRole,
  originalFilename = kind === "dwg" ? "A-101.dwg" : "A-101.pdf",
  owner = false,
  requestContentType = kind === "pdf"
    ? "application/pdf"
    : "application/octet-stream",
  requestFields = {},
  storedByteSize,
  storedContentType = requestContentType,
} = {}) {
  const actualByteSize = chunks.reduce(
    (total, chunk) => total + chunk.byteLength,
    0,
  );
  const byteSize = requestedByteSize ?? actualByteSize;
  const extension = originalFilename.slice(originalFilename.lastIndexOf("."));
  let insertedRecord = null;
  let storageReads = 0;
  let streamCancels = 0;
  let verificationInserts = 0;
  const userClient = {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            app_metadata: appRole ? { role: appRole } : {},
            id: ids.actor,
            is_anonymous: false,
          },
        },
        error: null,
      }),
    },
    from(table) {
      if (table === "lukas_qto_projects")
        return queryResult({
          data: { id: ids.project, owner_id: owner ? ids.actor : ids.owner },
          error: null,
        });
      if (table === "lukas_qto_project_members")
        return queryResult({
          data: membershipRole ? { role: membershipRole } : null,
          error: null,
        });
      if (table === "lukas_qto_files")
        return queryResult({ data: null, error: null });
      throw new Error(`Unexpected user table: ${table}`);
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "lukas-qto");
        return {
          download(path) {
            assert.equal(
              path,
              `${owner ? ids.actor : ids.owner}/${ids.project}/source-uploads/${ids.object}${extension.toLowerCase()}`,
            );
            return {
              asStream: async () => {
                storageReads += 1;
                return {
                  data: new ReadableStream({
                    start(controller) {
                      for (const chunk of chunks) controller.enqueue(chunk);
                      controller.close();
                    },
                    cancel() {
                      streamCancels += 1;
                    },
                  }),
                  error: null,
                };
              },
            };
          },
          info: async () => ({
            data: {
              contentType: storedContentType,
              size: storedByteSize ?? byteSize,
            },
            error: null,
          }),
        };
      },
    },
  };
  const adminClient = {
    from(table) {
      assert.equal(table, "lukas_qto_verified_uploads");
      return {
        insert(record) {
          verificationInserts += 1;
          insertedRecord = record;
          return queryResult(
            insertErrorCode
              ? { data: null, error: { code: insertErrorCode } }
              : { data: { id: ids.verification }, error: null },
          );
        },
        select(columns) {
          const selected = new Set(
            String(columns)
              .split(",")
              .map((column) => column.trim()),
          );
          const data = existingVerification
            ? Object.fromEntries(
                Object.entries(existingVerification).filter(([column]) =>
                  selected.has(column),
                ),
              )
            : null;
          return queryResult({ data, error: null });
        },
      };
    },
  };
  const createClient = (_url, key) =>
    key === "service-key" ? adminClient : userClient;
  const getEnv = (name) =>
    ({
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      SUPABASE_URL: "https://example.supabase.co",
    })[name];
  const storageOwner = owner ? ids.actor : ids.owner;
  return {
    createClient,
    getEnv,
    request: new Request("https://example.test/upload-verify", {
      body: JSON.stringify({
        byteSize,
        contentType: requestContentType,
        kind,
        originalFilename,
        storagePath: `${storageOwner}/${ids.project}/source-uploads/${ids.object}${extension.toLowerCase()}`,
        ...requestFields,
      }),
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      method: "POST",
    }),
    storageReads: () => storageReads,
    streamCancels: () => streamCancels,
    insertedRecord: () => insertedRecord,
    verificationInserts: () => verificationInserts,
  };
}

test("upload verifier pins its runtime dependency without requiring an import map", () => {
  const source = readFileSync(
    new URL(
      "../supabase/functions/lukas-qto-upload-verify/index.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /from "npm:@supabase\/supabase-js@2\.112\.3"/);
  assert.doesNotMatch(source, /from "@supabase\/supabase-js"/);
});

test("upload verifier registers one Edge handler", () => {
  assert.equal(handlers.length, 1);
  assert.equal(typeof handlers[0], "function");
});

test("upload verifier mirrors Admin/Editor upload authority and rejects read-only roles before Storage", async () => {
  assert.equal(typeof verifier.createUploadVerifyHandler, "function");
  const cases = [
    [{ owner: true }, 200],
    [{ appRole: "hangil_staff" }, 200],
    [{ membershipRole: "estimator" }, 200],
    [{ membershipRole: "reviewer" }, 403],
    [{ membershipRole: "approver" }, 403],
    [{ membershipRole: "site" }, 403],
    [{ membershipRole: "procurement" }, 403],
    [{ membershipRole: "viewer" }, 403],
  ];

  for (const [input, expectedStatus] of cases) {
    const scenario = uploadVerifierScenario(input);
    const handler = verifier.createUploadVerifyHandler({
      createClient: scenario.createClient,
      getEnv: scenario.getEnv,
    });
    const response = await handler(scenario.request);

    assert.equal(response.status, expectedStatus, JSON.stringify(input));
    if (expectedStatus === 200) {
      assert.deepEqual(await response.json(), {
        verificationId: ids.verification,
      });
      assert.equal(scenario.storageReads(), 1, JSON.stringify(input));
      assert.equal(scenario.verificationInserts(), 1, JSON.stringify(input));
    } else {
      assert.deepEqual(await response.json(), {
        error: "이 프로젝트의 파일을 올릴 권한이 없습니다.",
      });
      assert.equal(scenario.storageReads(), 0, JSON.stringify(input));
      assert.equal(scenario.verificationInserts(), 0, JSON.stringify(input));
    }
  }
});

test("upload verifier requires authoritative application/pdf MIME before reading PDF bytes", async () => {
  const cases = [
    {
      expectedError: "PDF 파일 형식 정보가 허용되지 않습니다.",
      requestContentType: "application/octet-stream",
    },
    {
      expectedError: "PDF 파일 형식 정보가 허용되지 않습니다.",
      storedContentType: "text/plain",
    },
    {
      expectedError:
        "PDF 저장소 파일 형식 정보를 확인할 수 없습니다. 파일을 다시 올려주세요.",
      storedContentType: null,
    },
  ];

  for (const input of cases) {
    const scenario = uploadVerifierScenario({ owner: true, ...input });
    const handler = verifier.createUploadVerifyHandler({
      createClient: scenario.createClient,
      getEnv: scenario.getEnv,
    });
    const response = await handler(scenario.request);

    assert.equal(response.status, 400, JSON.stringify(input));
    assert.deepEqual(await response.json(), { error: input.expectedError });
    assert.equal(scenario.storageReads(), 0, JSON.stringify(input));
    assert.equal(scenario.verificationInserts(), 0, JSON.stringify(input));
  }
});

test("upload verifier rejects non-PDF bytes during streaming and accepts a split %PDF- header", async () => {
  const invalid = uploadVerifierScenario({
    chunks: [
      new TextEncoder().encode("NOT-PDF"),
      new TextEncoder().encode(" payload that must not be trusted"),
    ],
    owner: true,
  });
  const invalidHandler = verifier.createUploadVerifyHandler({
    createClient: invalid.createClient,
    getEnv: invalid.getEnv,
  });
  const invalidResponse = await invalidHandler(invalid.request);

  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), {
    error: "PDF 파일 내용이 올바르지 않습니다.",
  });
  assert.equal(invalid.storageReads(), 1);
  assert.equal(invalid.streamCancels(), 1);
  assert.equal(invalid.verificationInserts(), 0);

  const valid = uploadVerifierScenario({
    chunks: [
      new TextEncoder().encode("%P"),
      new TextEncoder().encode("D"),
      new TextEncoder().encode("F-1.7\nrest"),
    ],
    owner: true,
  });
  const validHandler = verifier.createUploadVerifyHandler({
    createClient: valid.createClient,
    getEnv: valid.getEnv,
  });
  const validResponse = await validHandler(valid.request);

  assert.equal(validResponse.status, 200);
  assert.deepEqual(await validResponse.json(), {
    verificationId: ids.verification,
  });
  assert.equal(valid.streamCancels(), 0);
  assert.equal(valid.verificationInserts(), 1);
  assert.equal(valid.insertedRecord().dwg_header_version, null);
});

test("upload verifier derives a split DWG header and hashes the complete actual stream", async () => {
  const chunks = [
    new TextEncoder().encode("AC"),
    new TextEncoder().encode("10"),
    new TextEncoder().encode("32"),
    new Uint8Array([0, 1, 2, 3, 255]),
  ];
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  const scenario = uploadVerifierScenario({
    chunks,
    kind: "dwg",
    owner: true,
    requestFields: {
      dwgHeaderVersion: "AC0000",
      dwg_header_version: "forged",
    },
  });
  const handler = verifier.createUploadVerifyHandler({
    createClient: scenario.createClient,
    getEnv: scenario.getEnv,
  });

  const response = await handler(scenario.request);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    verificationId: ids.verification,
  });
  assert.equal(scenario.insertedRecord().dwg_header_version, "AC1032");
  assert.equal(
    scenario.insertedRecord().sha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.equal(scenario.insertedRecord().byte_size, bytes.byteLength);
  assert.equal(scenario.streamCancels(), 0);
});

test("upload verifier records a numeric AC header without claiming compatibility", async () => {
  const scenario = uploadVerifierScenario({
    chunks: [new TextEncoder().encode("AC9999unqualified-body")],
    kind: "dwg",
    owner: true,
  });
  const handler = verifier.createUploadVerifyHandler({
    createClient: scenario.createClient,
    getEnv: scenario.getEnv,
  });

  const response = await handler(scenario.request);

  assert.equal(response.status, 200);
  assert.equal(scenario.insertedRecord().dwg_header_version, "AC9999");
});

test("upload verifier requires exact DWG filename and authoritative octet-stream MIME", async () => {
  assert.equal(verifier.fileMatchesKind?.("dwg", "PLAN.DWG"), true);
  assert.equal(verifier.fileMatchesKind?.("dwg", "PLAN.DXF"), false);
  assert.equal(
    verifier.contentTypeMatchesKind?.("dwg", "application/octet-stream"),
    true,
  );
  assert.equal(
    verifier.contentTypeMatchesKind?.("dwg", "application/acad"),
    false,
  );
  assert.equal(
    verifier.authoritativeStoredContentType?.(
      "dwg",
      undefined,
      "application/octet-stream",
    ),
    null,
  );

  const cases = [
    { requestContentType: "application/acad" },
    { storedContentType: "application/acad" },
    { storedContentType: null },
  ];
  for (const input of cases) {
    const scenario = uploadVerifierScenario({
      chunks: [new TextEncoder().encode("AC1032body")],
      kind: "dwg",
      owner: true,
      ...input,
    });
    const handler = verifier.createUploadVerifyHandler({
      createClient: scenario.createClient,
      getEnv: scenario.getEnv,
    });

    const response = await handler(scenario.request);

    assert.equal(response.status, 400, JSON.stringify(input));
    assert.match((await response.json()).error, /^DWG /);
    assert.equal(scenario.storageReads(), 0, JSON.stringify(input));
    assert.equal(scenario.verificationInserts(), 0, JSON.stringify(input));
  }
});

test("upload verifier rejects malformed, non-ASCII, and short actual DWG headers", async () => {
  const unreadBody = new TextEncoder().encode("must-not-be-read");
  const cases = [
    [[new Uint8Array([0x41, 0x43, 0x31, 0x30, 0x58, 0x32]), unreadBody], 1],
    [[new Uint8Array([0x41, 0x43, 0x31, 0x30, 0x33, 0xff]), unreadBody], 1],
    [[new TextEncoder().encode("AC10")], 0],
  ];
  for (const [chunks, expectedCancels] of cases) {
    const scenario = uploadVerifierScenario({
      chunks,
      kind: "dwg",
      owner: true,
    });
    const handler = verifier.createUploadVerifyHandler({
      createClient: scenario.createClient,
      getEnv: scenario.getEnv,
    });

    const response = await handler(scenario.request);

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "DWG 파일 내용이 올바르지 않습니다.",
    });
    assert.equal(scenario.streamCancels(), expectedCancels);
    assert.equal(scenario.verificationInserts(), 0);
  }
});

test("upload verifier rejects a DWG whose actual streamed size differs from trusted metadata", async () => {
  const bytes = new TextEncoder().encode("AC1032body");
  const scenario = uploadVerifierScenario({
    byteSize: bytes.byteLength + 1,
    chunks: [bytes],
    kind: "dwg",
    owner: true,
  });
  const handler = verifier.createUploadVerifyHandler({
    createClient: scenario.createClient,
    getEnv: scenario.getEnv,
  });

  const response = await handler(scenario.request);

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "업로드된 파일 크기가 원본과 다릅니다.",
  });
  assert.equal(scenario.storageReads(), 1);
  assert.equal(scenario.verificationInserts(), 0);
});

test("upload verifier replays only exact service-derived DWG evidence", async () => {
  const bytes = new TextEncoder().encode("AC1032body");
  const storagePath = `${ids.actor}/${ids.project}/source-uploads/${ids.object}.dwg`;
  const evidence = {
    actor_id: ids.actor,
    byte_size: bytes.byteLength,
    consumed_file_id: null,
    content_type: "application/octet-stream",
    dwg_header_version: "AC1032",
    expires_at: "2999-01-01T00:00:00.000Z",
    id: ids.verification,
    kind: "dwg",
    original_filename: "A-101.dwg",
    project_id: ids.project,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    storage_path: storagePath,
  };

  for (const [dwgHeaderVersion, expectedStatus] of [
    ["AC1032", 200],
    ["AC1027", 409],
  ]) {
    const scenario = uploadVerifierScenario({
      chunks: [bytes],
      existingVerification: {
        ...evidence,
        dwg_header_version: dwgHeaderVersion,
      },
      insertErrorCode: "23505",
      kind: "dwg",
      owner: true,
    });
    const handler = verifier.createUploadVerifyHandler({
      createClient: scenario.createClient,
      getEnv: scenario.getEnv,
    });

    const response = await handler(scenario.request);

    assert.equal(response.status, expectedStatus, dwgHeaderVersion);
    assert.equal(scenario.insertedRecord().dwg_header_version, "AC1032");
    if (expectedStatus === 200)
      assert.deepEqual(await response.json(), {
        verificationId: ids.verification,
      });
    else
      assert.deepEqual(await response.json(), {
        error:
          "이 파일 경로의 검증 기록이 이미 사용됐습니다. 파일을 다시 올려주세요.",
      });
  }
});

test("upload verifier accepts exact DXF evidence and rejects DWG import", () => {
  assert.equal(verifier.fileMatchesKind?.("dxf", "PLAN.DXF"), true);
  assert.equal(verifier.fileMatchesKind?.("dxf", "PLAN.DWG"), false);
  assert.equal(
    verifier.contentTypeMatchesKind?.("dxf", "application/dxf"),
    true,
  );
  assert.equal(
    verifier.contentTypeMatchesKind?.("dxf", "application/pdf"),
    false,
  );
  assert.match(
    verifier.uploadKindMismatchMessage?.("dxf", "PLAN.DWG") ?? "",
    /DWG 원본.*선택.*직접.*가져올 수 없습니다.*DXF.*변환/,
  );
});

test("upload verifier keeps legacy other-kind DWG bytes in the generic evidence channel", () => {
  assert.equal(verifier.fileMatchesKind?.("other", "PLAN.DWG"), true);
  assert.equal(
    verifier.contentTypeMatchesKind?.("other", "application/octet-stream"),
    true,
  );
  assert.equal(verifier.uploadKindMismatchMessage?.("other", "PLAN.DWG"), null);
});

test("DXF verification never substitutes request MIME for missing Storage metadata", () => {
  assert.equal(
    verifier.authoritativeStoredContentType?.(
      "dxf",
      undefined,
      "application/dxf",
    ),
    null,
  );
  assert.equal(
    verifier.authoritativeStoredContentType?.("dxf", "", "application/dxf"),
    null,
  );
  assert.equal(
    verifier.authoritativeStoredContentType?.(
      "dxf",
      "x".repeat(256),
      "application/dxf",
    ),
    null,
  );
  assert.equal(
    verifier.authoritativeStoredContentType?.(
      "dxf",
      "application/x-dxf",
      "application/dxf",
    ),
    "application/x-dxf",
  );
  assert.equal(
    verifier.authoritativeStoredContentType?.(
      "other",
      undefined,
      "application/octet-stream",
    ),
    "application/octet-stream",
  );
});
