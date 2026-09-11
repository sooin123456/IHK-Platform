import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer } from "vite";

const { Upload: BrowserTusUpload } = createRequire(import.meta.url)(
  "tus-js-client/lib.es5/browser/index.js",
);

const uploadFactoryKey = "__projectFileUploadFakeTusFactory";
const uploadUrlStorageKey = "__projectFileUploadFakeTusUrlStorage";
globalThis[uploadFactoryKey] = null;
globalThis[uploadUrlStorageKey] = {
  events: [],
  async addUpload() {
    return "tus::fingerprint::new";
  },
  async findAllUploads() {
    return [];
  },
  async findUploadsByFingerprint() {
    return [];
  },
  async removeUpload(key) {
    this.events.push(["remove", key]);
  },
};

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      enforce: "pre",
      load(id) {
        if (id === "\0virtual:project-file-upload-tus")
          return `export const defaultOptions = { urlStorage: globalThis[${JSON.stringify(uploadUrlStorageKey)}] }; export class Upload { constructor(source, options) { return globalThis[${JSON.stringify(uploadFactoryKey)}](source, options); } }`;
      },
      name: "project-file-upload-tus",
      resolveId(source) {
        if (source === "tus-js-client")
          return "\0virtual:project-file-upload-tus";
      },
    },
  ],
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
  ssr: { noExternal: ["tus-js-client"] },
});

const uploadModule = await vite.ssrLoadModule(
  "/app/lukas/lib/project-file-upload.ts",
);

test.after(async () => {
  delete globalThis[uploadFactoryKey];
  delete globalThis[uploadUrlStorageKey];
  await vite.close();
});

const ownerId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const filename = "A-101.pdf";
const endpoint =
  "https://sample.storage.supabase.co/storage/v1/upload/resumable";
const previousPath = `${ownerId}/${projectId}/source-uploads/00000000-0000-4000-8000-000000000003.pdf`;
const alternatePath = `${ownerId}/${projectId}/source-uploads/00000000-0000-4000-8000-000000000007.pdf`;

function file() {
  return new File(["drawing"], filename, {
    lastModified: 1_777_777_777_000,
    type: "application/pdf",
  });
}

function previousUpload(overrides = {}) {
  return {
    creationTime: "Tue Sep 01 2026 09:00:00 GMT+0900",
    metadata: {
      bucketName: "lukas-qto",
      cacheControl: "3600",
      contentType: "application/pdf",
      objectName: previousPath,
    },
    size: file().size,
    uploadUrl: `${endpoint}/upload-id`,
    urlStorageKey: "tus::fingerprint::1",
    ...overrides,
  };
}

function fakeTus({
  findError = null,
  previous = [],
  responseSequence = null,
  resumeStatus = null,
}) {
  const observations = { events: [], options: null, resumed: null };
  globalThis[uploadFactoryKey] = (_source, options) => {
    observations.options = options;
    return {
      async findPreviousUploads() {
        observations.events.push("find");
        if (findError) throw findError;
        return previous;
      },
      resumeFromPreviousUpload(candidate) {
        observations.events.push("resume");
        observations.resumed = candidate;
      },
      start() {
        observations.events.push("start");
        const responses =
          responseSequence ??
          (resumeStatus === null
            ? []
            : [
                {
                  status: resumeStatus,
                  url: observations.resumed?.uploadUrl ?? endpoint,
                },
              ]);
        for (const response of responses)
          options.onAfterResponse?.(
            { getMethod: () => "HEAD", getURL: () => response.url },
            { getStatus: () => response.status },
          );
        options.onSuccess?.();
      },
    };
  };
  return observations;
}

// Keep the installed browser SDK's fingerprinting, storage lookup, file reader,
// and resumable state machine real; replace only persistent storage and HTTP.
function realBrowserTus() {
  const storage = globalThis[uploadUrlStorageKey];
  const originalStorage = { ...storage };
  const records = new Map();
  const sessions = new Map();
  const requests = [];
  const sentBodies = [];
  let failPatch = true;
  let storageSequence = 0;
  Object.assign(storage, {
    async addUpload(fingerprint, record) {
      const key = `memory-upload-${++storageSequence}`;
      records.set(key, { ...record, fingerprint, urlStorageKey: key });
      return key;
    },
    async findAllUploads() {
      return [...records.values()];
    },
    async findUploadsByFingerprint(fingerprint) {
      return [...records.values()].filter(
        (record) => record.fingerprint === fingerprint,
      );
    },
    async removeUpload(key) {
      records.delete(key);
    },
  });
  const httpStack = {
    createRequest(method, url) {
      const headers = new Map();
      return {
        getMethod: () => method,
        getURL: () => url,
        getHeader: (name) => headers.get(name.toLowerCase()),
        setHeader: (name, value) => headers.set(name.toLowerCase(), value),
        setProgressHandler() {},
        getUnderlyingObject: () => null,
        async abort() {},
        async send(body) {
          requests.push({ method, url });
          const responseHeaders = new Map();
          let status = 204;
          if (method === "POST") {
            const location = `${url}/session-${sessions.size + 1}`;
            sessions.set(location, {
              length: Number(headers.get("upload-length")),
              offset: 0,
            });
            responseHeaders.set("location", location);
            status = 201;
          } else {
            const session = sessions.get(url);
            assert.ok(
              session,
              "only a created test transport session may resume",
            );
            if (method === "PATCH") {
              if (failPatch) throw new Error("simulated interrupted PATCH");
              const bytes = Buffer.from(await body.arrayBuffer());
              sentBodies.push(bytes);
              session.offset += bytes.length;
            } else assert.equal(method, "HEAD");
            responseHeaders.set("upload-offset", String(session.offset));
            responseHeaders.set("upload-length", String(session.length));
          }
          return {
            getStatus: () => status,
            getHeader: (name) => responseHeaders.get(name.toLowerCase()),
            getBody: () => "",
            getUnderlyingObject: () => null,
          };
        },
      };
    },
  };
  globalThis[uploadFactoryKey] = (source, options) =>
    new BrowserTusUpload(source, { ...options, httpStack, retryDelays: null });
  return {
    records,
    requests,
    sentBodies,
    allowPatch() {
      failPatch = false;
    },
    restore() {
      Object.assign(storage, originalStorage);
    },
  };
}

test("actual browser SDK resumes a DWG across MIME reselection using its fingerprint-keyed URL storage", async () => {
  const sdk = realBrowserTus();
  try {
    const bytes = Buffer.from("AC1032same-original-body");
    const makeFile = (type) =>
      new File([bytes], "PLAN.DWG", { type, lastModified: 1_777_777_777_000 });
    let journaled;
    await assert.rejects(
      upload({
        file: makeFile("application/acad"),
        kind: "dwg",
        onStoragePath(metadata) {
          journaled = metadata;
        },
      }),
      /simulated interrupted PATCH/,
    );
    assert.equal(sdk.records.size, 1);
    sdk.allowPatch();
    const result = await upload({
      file: makeFile("image/vnd.dwg"),
      kind: "dwg",
      resumeStoragePath: journaled.storagePath,
    });
    assert.equal(result.storagePath, journaled.storagePath);
    assert.equal(
      sdk.requests.filter(({ method }) => method === "POST").length,
      1,
    );
    assert.equal(
      sdk.requests.filter(({ method }) => method === "HEAD").length,
      1,
    );
    assert.deepEqual(Buffer.concat(sdk.sentBodies), bytes);
  } finally {
    sdk.restore();
  }
});

test("actual browser SDK does not adopt DWG sessions with changed file identity, endpoint, or scope", async () => {
  const bytes = Buffer.from("AC1032same-original-body");
  const timestamp = 1_777_777_777_000;
  for (const change of [
    { label: "name", name: "OTHER.DWG" },
    { label: "size", bytes: Buffer.concat([bytes, Buffer.from("x")]) },
    { label: "mtime", lastModified: timestamp + 1 },
    { label: "endpoint", supabaseUrl: "https://another.supabase.co" },
    { label: "project", projectId: "00000000-0000-4000-8000-000000000099" },
    { label: "owner", ownerId: "00000000-0000-4000-8000-000000000098" },
  ]) {
    const sdk = realBrowserTus();
    try {
      let journaled;
      await assert.rejects(
        upload({
          file: new File([bytes], "PLAN.DWG", {
            type: "application/acad",
            lastModified: timestamp,
          }),
          kind: "dwg",
          onStoragePath(metadata) {
            journaled = metadata;
          },
        }),
        /simulated interrupted PATCH/,
      );
      sdk.allowPatch();
      const result = await upload({
        file: new File([change.bytes ?? bytes], change.name ?? "PLAN.DWG", {
          type: "image/vnd.dwg",
          lastModified: change.lastModified ?? timestamp,
        }),
        kind: "dwg",
        resumeStoragePath: journaled.storagePath,
        ...(change.supabaseUrl ? { supabaseUrl: change.supabaseUrl } : {}),
        ...(change.projectId ? { projectId: change.projectId } : {}),
        ...(change.ownerId ? { ownerId: change.ownerId } : {}),
      });
      assert.notEqual(result.storagePath, journaled.storagePath, change.label);
      assert.equal(
        sdk.requests.filter(({ method }) => method === "POST").length,
        2,
        change.label,
      );
      assert.equal(
        sdk.requests.filter(({ method }) => method === "HEAD").length,
        0,
        change.label,
      );
    } finally {
      sdk.restore();
    }
  }
});

test("non-DWG uploads retain the actual browser SDK default MIME-sensitive fingerprint", async () => {
  const sdk = realBrowserTus();
  try {
    let journaled;
    const makeFile = (type) =>
      new File(["generic source"], "source.bin", {
        type,
        lastModified: 1_777_777_777_000,
      });
    await assert.rejects(
      upload({
        file: makeFile("application/octet-stream"),
        kind: "other",
        onStoragePath(metadata) {
          journaled = metadata;
        },
      }),
      /simulated interrupted PATCH/,
    );
    sdk.allowPatch();
    const result = await upload({
      file: makeFile("application/custom"),
      kind: "other",
      resumeStoragePath: journaled.storagePath,
    });
    assert.notEqual(result.storagePath, journaled.storagePath);
    assert.equal(
      sdk.requests.filter(({ method }) => method === "POST").length,
      2,
    );
    assert.equal(
      sdk.requests.filter(({ method }) => method === "HEAD").length,
      0,
    );
  } finally {
    sdk.restore();
  }
});

function upload(overrides = {}) {
  return uploadModule.uploadProjectFileResumable({
    accessToken: "test-access-token",
    file: file(),
    kind: "pdf",
    ownerId,
    projectId,
    supabaseUrl: "https://sample.supabase.co",
    ...overrides,
  });
}

test("a matching persisted TUS session resumes and returns its actual object path", async () => {
  const candidate = previousUpload();
  const observations = fakeTus({ previous: [candidate], resumeStatus: 204 });

  const result = await upload({ resumeStoragePath: previousPath });

  assert.deepEqual(observations.events, ["find", "resume", "start"]);
  assert.equal(observations.resumed, candidate);
  assert.equal(result.storagePath, previousPath);
});

test("a stale TUS session falls back to the newly generated object path", async () => {
  const observations = fakeTus({
    previous: [previousUpload()],
    resumeStatus: 404,
  });

  const result = await upload({ resumeStoragePath: previousPath });

  assert.deepEqual(observations.events, ["find", "resume", "start"]);
  assert.notEqual(result.storagePath, previousPath);
  assert.match(
    result.storagePath,
    new RegExp(`^${ownerId}/${projectId}/source-uploads/[0-9a-f-]+\\.pdf$`),
  );
});

test("a retry HEAD for a fresh upload cannot restore a stale object path", async () => {
  const stale = previousUpload();
  const observations = fakeTus({
    previous: [stale],
    responseSequence: [
      { status: 404, url: stale.uploadUrl },
      { status: 204, url: `${endpoint}/fresh-upload-id` },
    ],
  });

  const result = await upload({ resumeStoragePath: previousPath });

  assert.deepEqual(observations.events, ["find", "resume", "start"]);
  assert.notEqual(result.storagePath, previousPath);
  assert.match(
    result.storagePath,
    new RegExp(`^${ownerId}/${projectId}/source-uploads/[0-9a-f-]+\\.pdf$`),
  );
});

test("foreign TUS origins and parallel sessions are ignored despite a trusted object path", async () => {
  const foreignUrl = previousUpload({
    uploadUrl: "https://attacker.example/upload-id",
  });
  const foreignParallelUpload = previousUpload({
    parallelUploadUrls: ["https://attacker.example/parallel-upload-id"],
  });
  const observations = fakeTus({
    previous: [foreignUrl, foreignParallelUpload],
  });

  const result = await upload({ resumeStoragePath: previousPath });

  assert.deepEqual(observations.events, ["find", "start"]);
  assert.equal(observations.resumed, null);
  assert.match(
    result.storagePath,
    new RegExp(`^${ownerId}/${projectId}/source-uploads/[0-9a-f-]+\\.pdf$`),
  );
});

test("a trusted foreign-project object path is rejected before TUS resume", async () => {
  const foreignProjectPath =
    "00000000-0000-4000-8000-000000000099/00000000-0000-4000-8000-000000000098/source-uploads/00000000-0000-4000-8000-000000000097.pdf";
  const foreignProject = previousUpload({
    metadata: {
      ...previousUpload().metadata,
      objectName: foreignProjectPath,
    },
  });
  const observations = fakeTus({ previous: [foreignProject] });

  const result = await upload({ resumeStoragePath: foreignProjectPath });

  assert.deepEqual(observations.events, ["find", "start"]);
  assert.equal(observations.resumed, null);
  assert.match(
    result.storagePath,
    new RegExp(`^${ownerId}/${projectId}/source-uploads/[0-9a-f-]+\\.pdf$`),
  );
});

test("malformed persisted TUS metadata is ignored instead of blocking a fresh upload", async () => {
  const observations = fakeTus({
    previous: [{ ...previousUpload(), metadata: undefined }],
  });

  const result = await upload();

  assert.deepEqual(observations.events, ["find", "start"]);
  assert.equal(observations.resumed, null);
  assert.match(
    result.storagePath,
    new RegExp(`^${ownerId}/${projectId}/source-uploads/[0-9a-f-]+\\.pdf$`),
  );
});

test("a numeric persisted object name is ignored and starts a fresh upload", async () => {
  const observations = fakeTus({
    previous: [
      previousUpload({
        metadata: { ...previousUpload().metadata, objectName: 7 },
      }),
    ],
  });

  const result = await upload({ resumeStoragePath: previousPath });

  assert.deepEqual(observations.events, ["find", "start"]);
  assert.equal(observations.resumed, null);
  assert.notEqual(result.storagePath, previousPath);
  assert.match(
    result.storagePath,
    new RegExp(`^${ownerId}/${projectId}/source-uploads/[0-9a-f-]+\\.pdf$`),
  );
});

for (const candidates of [
  [
    previousUpload(),
    previousUpload({
      metadata: { ...previousUpload().metadata, objectName: alternatePath },
    }),
  ],
  [
    previousUpload({
      metadata: { ...previousUpload().metadata, objectName: alternatePath },
    }),
    previousUpload(),
  ],
]) {
  test("only the journaled TUS candidate resumes regardless of candidate order", async () => {
    const observations = fakeTus({ previous: candidates, resumeStatus: 204 });

    const result = await upload({ resumeStoragePath: alternatePath });

    assert.deepEqual(observations.events, ["find", "resume", "start"]);
    assert.equal(observations.resumed.metadata.objectName, alternatePath);
    assert.equal(result.storagePath, alternatePath);
  });
}

test("a trusted path without its matching TUS candidate starts a fresh upload", async () => {
  const observations = fakeTus({ previous: [previousUpload()] });

  const result = await upload({ resumeStoragePath: alternatePath });

  assert.deepEqual(observations.events, ["find", "start"]);
  assert.equal(observations.resumed, null);
  assert.notEqual(result.storagePath, previousPath);
  assert.notEqual(result.storagePath, alternatePath);
  assert.match(
    result.storagePath,
    new RegExp(`^${ownerId}/${projectId}/source-uploads/[0-9a-f-]+\\.pdf$`),
  );
});

test("an otherwise-valid old TUS candidate is ignored without a trusted path", async () => {
  const observations = fakeTus({ previous: [previousUpload()] });

  const result = await upload();

  assert.deepEqual(observations.events, ["find", "start"]);
  assert.equal(observations.resumed, null);
  assert.notEqual(result.storagePath, previousPath);
  assert.match(
    result.storagePath,
    new RegExp(`^${ownerId}/${projectId}/source-uploads/[0-9a-f-]+\\.pdf$`),
  );
});

test("unavailable local resume storage does not block a fresh upload", async () => {
  const observations = fakeTus({
    findError: new Error("local storage is unavailable"),
  });

  const result = await upload();

  assert.deepEqual(observations.events, ["find", "start"]);
  assert.match(
    result.storagePath,
    new RegExp(`^${ownerId}/${projectId}/source-uploads/[0-9a-f-]+\\.pdf$`),
  );
});

test("the resolved source path is journaled before TUS starts and follows a stale fallback", async () => {
  const stale = previousUpload();
  const observations = fakeTus({
    previous: [stale],
    responseSequence: [
      { status: 404, url: stale.uploadUrl },
      { status: 204, url: `${endpoint}/fresh-upload-id` },
    ],
  });
  const journaled = [];

  const result = await upload({
    onStoragePath(metadata) {
      journaled.push({
        beforeStart: !observations.events.includes("start"),
        metadata,
      });
    },
    resumeStoragePath: previousPath,
  });

  assert.equal(journaled[0].beforeStart, true);
  assert.equal(journaled[0].metadata.storagePath, previousPath);
  assert.equal(journaled.at(-1).metadata.storagePath, result.storagePath);
  assert.notEqual(result.storagePath, previousPath);
});

test("a lost TUS creation response cannot strand file bytes before a resumable URL exists", async () => {
  const observations = fakeTus({});

  await upload();

  const bytesAcceptedBeforeLocation = observations.options
    .uploadDataDuringCreation
    ? file().size
    : 0;
  assert.equal(bytesAcceptedBeforeLocation, 0);
});

test("the TUS resume key is retained until the completed journal transition succeeds", async () => {
  const candidate = previousUpload();
  const observations = fakeTus({ previous: [candidate], resumeStatus: 204 });
  const storage = globalThis[uploadUrlStorageKey];
  storage.events.length = 0;

  await upload({
    onUploadComplete(metadata) {
      storage.events.push(["journal", metadata.storagePath]);
    },
    resumeStoragePath: previousPath,
  });

  assert.equal(observations.options.removeFingerprintOnSuccess, false);
  assert.deepEqual(storage.events, [
    ["journal", previousPath],
    ["remove", candidate.urlStorageKey],
  ]);
});

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  removeItem(key) {
    this.values.delete(key);
  }

  setItem(key, value) {
    this.values.set(key, value);
  }
}

class FailingStorage extends MemoryStorage {
  failure = null;

  setItem(key, value) {
    if (this.failure === "throw") throw new Error("storage unavailable");
    if (this.failure === "false") return false;
    return super.setItem(key, value);
  }
}

class SerialLockManager {
  active = false;
  tail = Promise.resolve();

  request(_name, callback) {
    const result = this.tail.then(async () => {
      this.active = true;
      try {
        return await callback();
      } finally {
        this.active = false;
      }
    });
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

class LockAwareRacingStorage extends MemoryStorage {
  constructor(lockManager) {
    super();
    this.lockManager = lockManager;
  }

  getItem(key) {
    if (!this.lockManager.active) return null;
    return super.getItem(key);
  }
}

const uploadAId = "00000000-0000-4000-8000-000000000008";
const uploadBId = "00000000-0000-4000-8000-000000000009";

function pendingUpload(overrides = {}) {
  return {
    actorId: "00000000-0000-4000-8000-000000000004",
    byteSize: file().size,
    contentType: "application/pdf",
    kind: "pdf",
    originalFilename: filename,
    ownerId,
    projectId,
    returnTo: `/projects/${projectId}/workspaces/00000000-0000-4000-8000-000000000005`,
    revision: 0,
    storagePath: previousPath,
    uploadId: uploadAId,
    uploadComplete: true,
    verificationId: null,
    version: 1,
    ...overrides,
  };
}

test("DWG journal and TUS resume retain one normalized MIME across browser MIME changes", async () => {
  const storage = new MemoryStorage();
  const path = previousPath.replace(/\.pdf$/, ".dwg");
  const source = new File(["AC1032body"], "PLAN.DWG", {
    type: "application/acad",
  });
  const pending = await uploadModule.savePendingProjectUpload(
    pendingUpload({
      kind: "dwg",
      originalFilename: source.name,
      byteSize: source.size,
      contentType: "application/octet-stream",
      storagePath: path,
      returnTo: null,
      uploadComplete: false,
    }),
    storage,
  );
  assert.ok(pending);
  const restored = uploadModule.loadPendingProjectUpload(
    pending.actorId,
    ownerId,
    projectId,
    storage,
  );
  assert.equal(restored.storagePath, path);
  assert.equal(
    restored.contentType,
    uploadModule.projectUploadContentType("dwg", source.type),
  );
  const candidate = previousUpload({
    size: source.size,
    metadata: {
      bucketName: "lukas-qto",
      contentType: "application/octet-stream",
      objectName: path,
    },
  });
  const observations = fakeTus({ previous: [candidate], resumeStatus: 204 });
  const result = await upload({
    file: source,
    kind: "dwg",
    resumeStoragePath: restored.storagePath,
  });
  assert.equal(observations.resumed, candidate);
  assert.equal(
    observations.options.metadata.contentType,
    "application/octet-stream",
  );
  assert.equal(result.storagePath, path);
  assert.equal(result.contentType, "application/octet-stream");
});

test("DWG pending journals reject workspace return targets and noncanonical stored MIME", async () => {
  for (const extra of [
    { returnTo: `/projects/${projectId}/workspaces/${uploadAId}` },
    { contentType: "application/acad" },
  ]) {
    assert.equal(
      await uploadModule.savePendingProjectUpload(
        pendingUpload({
          kind: "dwg",
          originalFilename: "PLAN.dwg",
          storagePath: previousPath.replace(/\.pdf$/, ".dwg"),
          returnTo: null,
          contentType: "application/octet-stream",
          ...extra,
        }),
        new MemoryStorage(),
      ),
      null,
    );
  }
});

test("the pending-upload journal survives verification and is removed only after confirmed finalization", async () => {
  const storage = new MemoryStorage();
  const pending = await uploadModule.savePendingProjectUpload(
    pendingUpload(),
    storage,
  );

  assert.deepEqual(
    uploadModule.loadPendingProjectUpload(
      pending.actorId,
      ownerId,
      projectId,
      storage,
    ),
    pending,
  );

  const verified = await uploadModule.savePendingProjectUpload(
    {
      ...pending,
      verificationId: "00000000-0000-4000-8000-000000000006",
    },
    storage,
  );
  assert.deepEqual(
    uploadModule.loadPendingProjectUpload(
      pending.actorId,
      ownerId,
      projectId,
      storage,
    ),
    verified,
  );

  await uploadModule.clearPendingProjectUpload(
    pending.actorId,
    projectId,
    pending.uploadId,
    verified.revision,
    storage,
  );
  assert.equal(
    uploadModule.loadPendingProjectUpload(
      pending.actorId,
      ownerId,
      projectId,
      storage,
    ),
    null,
  );
});

for (const failure of ["throw", "false"]) {
  test(`required initial and completed journal writes fail closed when setItem ${failure === "throw" ? "throws" : "returns false"}`, async (t) => {
    const incomplete = pendingUpload({ uploadComplete: false });
    const transitions = [
      { before: null, name: "initial", pending: incomplete },
      {
        before: incomplete,
        name: "completed",
        pending: pendingUpload(),
      },
    ];

    for (const transition of transitions) {
      await t.test(transition.name, async () => {
        const storage = new FailingStorage();
        const key = uploadModule.pendingProjectUploadStorageKey(
          transition.pending.actorId,
          transition.pending.projectId,
        );
        if (transition.before)
          storage.values.set(key, JSON.stringify(transition.before));
        storage.failure = failure;

        assert.equal(
          await uploadModule.savePendingProjectUpload(
            transition.pending,
            storage,
          ),
          null,
        );
        assert.equal(
          storage.getItem(key),
          transition.before ? JSON.stringify(transition.before) : null,
        );
      });
    }
  });
}

for (const failure of ["throw", "false"]) {
  test(`verification journal writes fail closed before finalization when setItem ${failure === "throw" ? "throws" : "returns false"}`, async () => {
    const pending = pendingUpload();
    const storage = new FailingStorage();
    const saved = await uploadModule.savePendingProjectUpload(pending, storage);
    assert.ok(saved);
    storage.failure = failure;
    let finalizeCalls = 0;

    await assert.rejects(
      uploadModule.completePendingProjectUpload({
        finalize: async () => {
          finalizeCalls += 1;
          return `/projects/${projectId}`;
        },
        pending: saved,
        persist: (verified) =>
          uploadModule.savePendingProjectUpload(verified, storage),
        verify: async () => "00000000-0000-4000-8000-000000000006",
      }),
    );

    assert.equal(finalizeCalls, 0);
    assert.deepEqual(
      uploadModule.loadPendingProjectUpload(
        pending.actorId,
        pending.ownerId,
        pending.projectId,
        storage,
      ),
      saved,
    );
  });
}

test("pending-upload journals reject records without a durable upload identity", () => {
  const storage = new MemoryStorage();
  const { uploadId: _uploadId, ...identityless } = pendingUpload();
  const key = uploadModule.pendingProjectUploadStorageKey(
    identityless.actorId,
    identityless.projectId,
  );
  storage.setItem(key, JSON.stringify(identityless));

  assert.equal(
    uploadModule.loadPendingProjectUpload(
      identityless.actorId,
      identityless.ownerId,
      identityless.projectId,
      storage,
    ),
    null,
  );
  assert.equal(storage.getItem(key), null);
});

test("a stale tab cannot overwrite another upload identity's journal", async () => {
  const storage = new MemoryStorage();
  const uploadA = pendingUpload({ uploadComplete: false });
  const uploadB = pendingUpload({
    storagePath: `${ownerId}/${projectId}/source-uploads/00000000-0000-4000-8000-000000000010.pdf`,
    uploadComplete: false,
    uploadId: uploadBId,
  });
  const key = uploadModule.pendingProjectUploadStorageKey(
    uploadA.actorId,
    uploadA.projectId,
  );
  assert.ok(await uploadModule.savePendingProjectUpload(uploadA, storage));
  storage.setItem(key, JSON.stringify(uploadB));

  assert.equal(
    await uploadModule.savePendingProjectUpload(
      { ...uploadA, uploadComplete: true },
      storage,
    ),
    null,
  );
  assert.deepEqual(
    uploadModule.loadPendingProjectUpload(
      uploadB.actorId,
      uploadB.ownerId,
      uploadB.projectId,
      storage,
    ),
    uploadB,
  );
});

test("empty journal acquisition is serialized so only one tab can claim a project upload", async () => {
  const lockManager = new SerialLockManager();
  const storage = new LockAwareRacingStorage(lockManager);
  const uploadA = pendingUpload({ uploadComplete: false });
  const uploadB = pendingUpload({
    storagePath: `${ownerId}/${projectId}/source-uploads/00000000-0000-4000-8000-000000000010.pdf`,
    uploadComplete: false,
    uploadId: uploadBId,
  });
  const key = uploadModule.pendingProjectUploadStorageKey(
    uploadA.actorId,
    uploadA.projectId,
  );

  const results = await Promise.all([
    uploadModule.savePendingProjectUpload(uploadA, storage, lockManager),
    uploadModule.savePendingProjectUpload(uploadB, storage, lockManager),
  ]);

  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(JSON.parse(storage.values.get(key)).uploadId, uploadA.uploadId);
});

test("journal mutation fails closed when no cross-context lock is available", async () => {
  const storage = new MemoryStorage();

  assert.equal(
    await uploadModule.savePendingProjectUpload(
      pendingUpload({ uploadComplete: false }),
      storage,
      null,
    ),
    null,
  );
  assert.equal(storage.values.size, 0);
});

test("a stale same-upload writer cannot regress completion, verification, or journal revision", async () => {
  const storage = new MemoryStorage();
  const initial = await uploadModule.savePendingProjectUpload(
    pendingUpload({ uploadComplete: false }),
    storage,
  );
  assert.equal(initial.revision, 1);

  const completed = await uploadModule.savePendingProjectUpload(
    { ...initial, uploadComplete: true },
    storage,
  );
  const verified = await uploadModule.savePendingProjectUpload(
    {
      ...completed,
      verificationId: "00000000-0000-4000-8000-000000000006",
    },
    storage,
  );

  assert.equal(verified.revision, 3);
  assert.equal(
    await uploadModule.savePendingProjectUpload(
      {
        ...initial,
        uploadComplete: false,
        verificationId: null,
      },
      storage,
    ),
    null,
  );
  assert.deepEqual(
    uploadModule.loadPendingProjectUpload(
      verified.actorId,
      verified.ownerId,
      verified.projectId,
      storage,
    ),
    verified,
  );
});

test("clearing one upload compares identities and cannot delete another tab's journal", async () => {
  const storage = new MemoryStorage();
  const uploadB = pendingUpload({ uploadId: uploadBId });
  const key = uploadModule.pendingProjectUploadStorageKey(
    uploadB.actorId,
    uploadB.projectId,
  );
  storage.setItem(key, JSON.stringify(uploadB));

  await uploadModule.clearPendingProjectUpload(
    uploadB.actorId,
    uploadB.projectId,
    uploadAId,
    uploadB.revision,
    storage,
  );
  assert.deepEqual(
    uploadModule.loadPendingProjectUpload(
      uploadB.actorId,
      uploadB.ownerId,
      uploadB.projectId,
      storage,
    ),
    uploadB,
  );

  await uploadModule.clearPendingProjectUpload(
    uploadB.actorId,
    uploadB.projectId,
    uploadB.uploadId,
    uploadB.revision,
    storage,
  );
  assert.equal(storage.getItem(key), null);
});

test("clearing a journal requires the latest revision even when the upload identity matches", async () => {
  const storage = new MemoryStorage();
  const initial = await uploadModule.savePendingProjectUpload(
    pendingUpload({ uploadComplete: false }),
    storage,
  );
  const completed = await uploadModule.savePendingProjectUpload(
    { ...initial, uploadComplete: true },
    storage,
  );
  const key = uploadModule.pendingProjectUploadStorageKey(
    completed.actorId,
    completed.projectId,
  );

  assert.equal(
    await uploadModule.clearPendingProjectUpload(
      initial.actorId,
      initial.projectId,
      initial.uploadId,
      initial.revision,
      storage,
    ),
    false,
  );
  assert.deepEqual(
    uploadModule.loadPendingProjectUpload(
      completed.actorId,
      completed.ownerId,
      completed.projectId,
      storage,
    ),
    completed,
  );
  assert.equal(
    await uploadModule.clearPendingProjectUpload(
      completed.actorId,
      completed.projectId,
      completed.uploadId,
      completed.revision,
      storage,
    ),
    true,
  );
  assert.equal(storage.getItem(key), null);
});

test("malformed or cross-project pending uploads are discarded before recovery", () => {
  const storage = new MemoryStorage();
  const pending = pendingUpload({
    storagePath:
      "00000000-0000-4000-8000-000000000099/00000000-0000-4000-8000-000000000098/source-uploads/00000000-0000-4000-8000-000000000097.pdf",
  });
  const key = uploadModule.pendingProjectUploadStorageKey(
    pending.actorId,
    projectId,
  );
  storage.setItem(key, JSON.stringify(pending));

  assert.equal(
    uploadModule.loadPendingProjectUpload(
      pending.actorId,
      ownerId,
      projectId,
      storage,
    ),
    null,
  );
  assert.equal(storage.getItem(key), null);
});

test("browser finalization posts the journaled verification and accepts only the same project destination", async () => {
  const pending = pendingUpload({
    verificationId: "00000000-0000-4000-8000-000000000006",
  });
  const requests = [];
  const destination = `/projects/${projectId}/workspaces/00000000-0000-4000-8000-000000000005`;

  const result = await uploadModule.finalizePendingProjectUpload({
    actionUrl: `https://app.example/projects/${projectId}/files?kind=pdf`,
    fetchImpl: async (url, init) => {
      requests.push({ init, url });
      return Response.json({ destination });
    },
    pending,
  });

  assert.equal(result, destination);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    `https://app.example/projects/${projectId}/files?kind=pdf`,
  );
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.credentials, "same-origin");
  assert.equal(requests[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    returnTo: pending.returnTo,
    verificationId: pending.verificationId,
  });

  await assert.rejects(
    uploadModule.finalizePendingProjectUpload({
      actionUrl: `https://app.example/projects/${projectId}/files`,
      fetchImpl: async () =>
        Response.json({ destination: "https://attacker.example/collect" }),
      pending,
    }),
    /완료 주소/,
  );
});

test("browser finalization uses a dedicated JSON resource route instead of the rendered files page", () => {
  assert.equal(
    uploadModule.projectUploadFinalizationPath(projectId),
    `/projects/${projectId}/files/finalize-upload`,
  );
});

test("browser finalization preserves an expired-verification status for recovery", async () => {
  const pending = pendingUpload({
    verificationId: "00000000-0000-4000-8000-000000000006",
  });

  await assert.rejects(
    uploadModule.finalizePendingProjectUpload({
      actionUrl: `https://app.example/projects/${projectId}/files/finalize-upload`,
      fetchImpl: async () =>
        Response.json(
          { error: "파일 검증 시간이 만료됐습니다." },
          { status: 410 },
        ),
      pending,
    }),
    (error) =>
      error instanceof uploadModule.ProjectUploadFinalizationError &&
      error.status === 410,
  );
});

test("recovery persists the verifier identity before finalization and skips every uploaded byte", async () => {
  const pending = pendingUpload();
  const verificationId = "00000000-0000-4000-8000-000000000006";
  const events = [];

  const result = await uploadModule.completePendingProjectUpload({
    finalize: async (verified) => {
      events.push(["finalize", verified.verificationId]);
      return `/projects/${projectId}`;
    },
    pending,
    persist: (verified) => {
      events.push(["persist", verified.verificationId]);
      return true;
    },
    verify: async (metadata) => {
      events.push(["verify", metadata.storagePath]);
      assert.deepEqual(metadata, {
        byteSize: pending.byteSize,
        contentType: pending.contentType,
        kind: pending.kind,
        originalFilename: pending.originalFilename,
        storagePath: pending.storagePath,
      });
      return verificationId;
    },
  });

  assert.deepEqual(events, [
    ["verify", pending.storagePath],
    ["persist", verificationId],
    ["finalize", verificationId],
  ]);
  assert.equal(result.destination, `/projects/${projectId}`);
  assert.equal(result.pending.verificationId, verificationId);
  assert.equal(result.pending.storagePath, pending.storagePath);
});

test("an incomplete upload journal never verifies or finalizes before TUS resumes", async () => {
  const pending = pendingUpload({ uploadComplete: false });
  let finalizeCalls = 0;
  let verifyCalls = 0;

  await assert.rejects(
    uploadModule.completePendingProjectUpload({
      finalize: async () => {
        finalizeCalls += 1;
        return `/projects/${projectId}`;
      },
      pending,
      persist: () => true,
      verify: async () => {
        verifyCalls += 1;
        return "00000000-0000-4000-8000-000000000006";
      },
    }),
    /업로드가 아직 완료되지 않았습니다/,
  );
  assert.equal(verifyCalls, 0);
  assert.equal(finalizeCalls, 0);
});

test("recovery with a persisted verification ID goes directly to idempotent finalization", async () => {
  const pending = pendingUpload({
    verificationId: "00000000-0000-4000-8000-000000000006",
  });
  let verifyCalls = 0;

  const result = await uploadModule.completePendingProjectUpload({
    finalize: async () => `/projects/${projectId}`,
    pending,
    persist: () => true,
    verify: async () => {
      verifyCalls += 1;
      throw new Error("verified recovery must not upload or hash again");
    },
  });

  assert.equal(result.destination, `/projects/${projectId}`);
  assert.equal(result.pending, pending);
  assert.equal(verifyCalls, 0);
});

test("an expired persisted verification is replaced atomically after reverify without uploading bytes", async () => {
  const oldVerificationId = "00000000-0000-4000-8000-000000000006";
  const newVerificationId = "00000000-0000-4000-8000-000000000007";
  const pending = pendingUpload({ verificationId: oldVerificationId });
  const events = [];

  const result = await uploadModule.completePendingProjectUpload({
    finalize: async (verified) => {
      events.push(["finalize", verified.verificationId]);
      if (verified.verificationId === oldVerificationId)
        throw new uploadModule.ProjectUploadFinalizationError("expired", 410);
      return `/projects/${projectId}`;
    },
    pending,
    persist: (verified) => {
      events.push(["persist", verified.verificationId]);
      return true;
    },
    verify: async (metadata) => {
      events.push(["verify", metadata.storagePath]);
      return newVerificationId;
    },
  });

  assert.deepEqual(events, [
    ["finalize", oldVerificationId],
    ["verify", pending.storagePath],
    ["persist", newVerificationId],
    ["finalize", newVerificationId],
  ]);
  assert.equal(result.pending.verificationId, newVerificationId);
});

test("an expired verification refresh may retain its service identity while advancing the journal revision", async () => {
  const storage = new MemoryStorage();
  const verificationId = "00000000-0000-4000-8000-000000000006";
  const pending = await uploadModule.savePendingProjectUpload(
    pendingUpload({ verificationId }),
    storage,
  );
  let finalizeCalls = 0;

  const result = await uploadModule.completePendingProjectUpload({
    finalize: async () => {
      finalizeCalls += 1;
      if (finalizeCalls === 1)
        throw new uploadModule.ProjectUploadFinalizationError("expired", 410);
      return `/projects/${projectId}`;
    },
    pending,
    persist: (nextPending, transition) =>
      uploadModule.savePendingProjectUpload(
        nextPending,
        storage,
        undefined,
        transition,
      ),
    verify: async () => verificationId,
  });

  assert.equal(finalizeCalls, 2);
  assert.equal(result.pending.verificationId, verificationId);
  assert.equal(result.pending.revision, pending.revision + 1);
  assert.deepEqual(
    uploadModule.loadPendingProjectUpload(
      pending.actorId,
      pending.ownerId,
      pending.projectId,
      storage,
    ),
    result.pending,
  );
});

test("a failed reverify retains the expired verification journal for the next recovery", async () => {
  const storage = new MemoryStorage();
  const oldVerificationId = "00000000-0000-4000-8000-000000000006";
  const pending = await uploadModule.savePendingProjectUpload(
    pendingUpload({ verificationId: oldVerificationId }),
    storage,
  );

  await assert.rejects(
    uploadModule.completePendingProjectUpload({
      finalize: async () => {
        throw new uploadModule.ProjectUploadFinalizationError("expired", 410);
      },
      pending,
      persist: (nextPending, transition) =>
        uploadModule.savePendingProjectUpload(
          nextPending,
          storage,
          undefined,
          transition,
        ),
      verify: async () => {
        throw new Error("verifier unavailable");
      },
    }),
    /verifier unavailable/,
  );

  assert.deepEqual(
    uploadModule.loadPendingProjectUpload(
      pending.actorId,
      pending.ownerId,
      pending.projectId,
      storage,
    ),
    pending,
  );
});
