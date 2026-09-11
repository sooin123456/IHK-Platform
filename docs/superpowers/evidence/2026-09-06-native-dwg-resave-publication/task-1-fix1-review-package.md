# Task1 fix1 exact delta

No commits. Compare exact files reviewed against current files.

## platform/native-dwg-worker/src/supabase.ts

diff --git a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-1-fix1-supabase.ts b/platform/native-dwg-worker/src/supabase.ts
index 391fc81..704acf3 100644
--- a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-1-fix1-supabase.ts
+++ b/platform/native-dwg-worker/src/supabase.ts
@@ -334,25 +334,24 @@ function createStorageTransport(
               ...headers,
               "cache-control": "max-age=0",
               "content-type":
                 parsed.kind === "dwg"
                   ? "application/octet-stream"
                   : "application/json",
               "x-upsert": "false",
             },
             body: body as unknown as BodyInit,
             signal: scoped.signal,
           });
         } catch {
-          if (profile.imported) throw new NativeDwgConfirmedUploadError();
           throw new NativeDwgUncertainUploadError();
         }
         let response: Response;
         let responseBytes: Uint8Array;
         try {
           response = await pending;
           responseBytes = await readBoundedBody(
             response,
             NATIVE_DWG_WORKER_LIMITS.processOutputBytes,
           );
         } catch {
           throw new NativeDwgUncertainUploadError();
@@ -363,25 +362,31 @@ function createStorageTransport(
           const error = JSON.parse(
             Buffer.from(responseBytes).toString("utf8"),
           ) as Record<string, unknown>;
           errorCode = error.code ?? error.error;
         } catch {
           errorCode = undefined;
         }
         if (
           (response.status === 400 || response.status === 409) &&
           (errorCode === "Duplicate" || errorCode === "ResourceAlreadyExists")
         )
           return "exists";
-        if (profile.imported) throw new NativeDwgConfirmedUploadError();
+        if (
+          profile.imported &&
+          response.status === 401 &&
+          errorCode === "InvalidJWT"
+        )
+          throw new NativeDwgConfirmedUploadError();
+        if (profile.imported) throw new NativeDwgUncertainUploadError();
         throw new Error("Native DWG upload failed.");
       } finally {
         scoped.dispose();
       }
     },
     async read(input: {
       kind: string;
       path: string;
       signal: AbortSignal;
     }): Promise<Uint8Array> {
       const scoped = scopedStorageSignal(input.signal);
       try {

## platform/tests/drawing-native-dwg-resave-storage.test.mjs

diff --git a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-1-fix1-drawing-native-dwg-resave-storage.test.mjs b/platform/tests/drawing-native-dwg-resave-storage.test.mjs
index e1d290b..84da008 100644
--- a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-1-fix1-drawing-native-dwg-resave-storage.test.mjs
+++ b/platform/tests/drawing-native-dwg-resave-storage.test.mjs
@@ -91,124 +91,176 @@ test("imported Storage uploads immutable copied bytes without upsert and reads f
     assert.deepEqual(
       Buffer.from(
         await transport.read({ kind: "dwg", path, signal: signal() }),
       ),
       expected,
     );
   } finally {
     for (const socket of sockets) socket.destroy();
     await new Promise((resolve) => server.close(resolve));
   }
 });
 
-test("classifies duplicate, definite refusal, disconnect and response-body uncertainty", async () => {
+test("only duplicate and fully consumed 401 InvalidJWT have definite HTTP settlement", async () => {
   const {
     createNativeDwgResaveStorageTransport: createTransport,
     NativeDwgConfirmedUploadError,
     NativeDwgUncertainUploadError,
   } = api();
   let mode = "duplicate";
   const sockets = new Set();
   const server = createServer(async (request, response) => {
     for await (const _chunk of request) void _chunk;
     if (mode === "disconnect") return request.socket.destroy();
     if (mode === "body-failure") {
       response.writeHead(200, { "content-type": "application/json" });
       response.write("{");
       return response.socket.destroy();
     }
     if (mode === "oversized-body") {
       response.writeHead(200, { "content-type": "application/json" });
       return response.end(Buffer.alloc(65537));
     }
-    const status = mode === "duplicate" ? 409 : 503;
+    const replies = {
+      duplicate: [409, '{"code":"Duplicate"}'],
+      "invalid-jwt": [401, '{"code":"InvalidJWT"}'],
+      "server-error": [503, '{"code":"InternalError"}'],
+      "unknown-client-error": [403, '{"code":"AccessDenied"}'],
+      "status-mismatch": [400, '{"code":"InvalidJWT"}'],
+      malformed: [401, "not-json"],
+    };
+    const [status, body] = replies[mode];
     response.writeHead(status, { "content-type": "application/json" });
-    response.write(
-      mode === "duplicate" ? '{"code":"Dupli' : '{"code":"Other",',
-    );
-    setImmediate(() =>
-      response.end(mode === "duplicate" ? 'cate"}' : '"message":"no"}'),
-    );
+    response.write(body.slice(0, 5));
+    setImmediate(() => response.end(body.slice(5)));
   });
   server.on("connection", (socket) => {
     sockets.add(socket);
     socket.on("close", () => sockets.delete(socket));
   });
   await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
   const address = server.address();
   assert.notEqual(address, null);
   const bytes = Buffer.from("{}");
   const input = {
     kind: "report",
     path: pathFor("report", bytes),
     bytes,
     signal: signal(),
   };
   try {
     const transport = createTransport({
       supabaseUrl: `http://127.0.0.1:${address.port}`,
       serviceRoleKey: "service-secret",
     });
     assert.equal(await transport.upload(input), "exists");
-    mode = "refusal";
+    mode = "invalid-jwt";
     await assert.rejects(
       transport.upload(input),
       NativeDwgConfirmedUploadError,
     );
     for (const uncertainMode of [
+      "server-error",
+      "unknown-client-error",
+      "status-mismatch",
+      "malformed",
       "disconnect",
       "body-failure",
       "oversized-body",
     ]) {
       mode = uncertainMode;
       await assert.rejects(
         transport.upload(input),
         NativeDwgUncertainUploadError,
       );
     }
   } finally {
     for (const socket of sockets) socket.destroy();
     await new Promise((resolve) => server.close(resolve));
   }
 });
 
-test("distinguishes definite pre-send throws from rejected POST promises", async () => {
+test("a synchronous throw after starting a real POST remains uncertain", async () => {
   const {
     createNativeDwgResaveStorageTransport: createTransport,
-    NativeDwgConfirmedUploadError,
     NativeDwgUncertainUploadError,
   } = api();
+  const received = Promise.withResolvers();
+  const sockets = new Set();
+  const server = createServer(async (request, response) => {
+    const chunks = [];
+    for await (const chunk of request) chunks.push(chunk);
+    received.resolve(Buffer.concat(chunks));
+    response.writeHead(200, { "content-type": "application/json" });
+    response.end("{}");
+  });
+  server.on("connection", (socket) => {
+    sockets.add(socket);
+    socket.on("close", () => sockets.delete(socket));
+  });
+  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
+  const address = server.address();
+  assert.notEqual(address, null);
   const bytes = Buffer.from("{}");
   const input = {
     kind: "report",
     path: pathFor("report", bytes),
     bytes,
     signal: signal(),
   };
   const config = {
-    supabaseUrl: "https://storage.test",
+    supabaseUrl: `http://127.0.0.1:${address.port}`,
     serviceRoleKey: "secret",
   };
-  const beforeSend = createTransport(config, {
-    fetch() {
-      throw new Error("not sent");
-    },
-  });
-  await assert.rejects(beforeSend.upload(input), NativeDwgConfirmedUploadError);
-  const unknown = createTransport(config, {
-    fetch() {
-      return Promise.reject(new Error("unknown"));
-    },
-  });
-  await assert.rejects(unknown.upload(input), NativeDwgUncertainUploadError);
+  let ownedRequest;
+  try {
+    const transport = createTransport(config, {
+      fetch(url, options) {
+        ownedRequest = globalThis.fetch(url, options);
+        throw new Error("injected transport threw after starting POST");
+      },
+    });
+    const classification = await transport.upload(input).then(
+      () => null,
+      (error) => error,
+    );
+    const response = await ownedRequest;
+    await response.arrayBuffer();
+    assert.deepEqual(await received.promise, bytes);
+    assert.ok(classification instanceof NativeDwgUncertainUploadError);
+  } finally {
+    for (const socket of sockets) socket.destroy();
+    await new Promise((resolve) => server.close(resolve));
+  }
+});
+
+test("a rejected POST promise remains uncertain", async () => {
+  const {
+    createNativeDwgResaveStorageTransport: createTransport,
+    NativeDwgUncertainUploadError,
+  } = api();
+  const bytes = Buffer.from("{}");
+  const transport = createTransport(
+    { supabaseUrl: "https://storage.test", serviceRoleKey: "secret" },
+    { fetch: () => Promise.reject(new Error("unknown")) },
+  );
+  await assert.rejects(
+    transport.upload({
+      kind: "report",
+      path: pathFor("report", bytes),
+      bytes,
+      signal: signal(),
+    }),
+    NativeDwgUncertainUploadError,
+  );
 });
 
 test("enforces imported profile paths, hashes, kinds and lowered per-kind caps", async () => {
   const {
     createNativeDwgResaveStorageTransport: createTransport,
     createNativeDwgStorageTransport: createLegacy,
     NativeDwgConfirmedUploadError,
   } = api();
   const bytes = Buffer.from("{}");
   let fetchCalls = 0;
   const runtime = {
     artifactLimits: { dwg: 8, edit_request: 2, authority: 2, report: 2 },
