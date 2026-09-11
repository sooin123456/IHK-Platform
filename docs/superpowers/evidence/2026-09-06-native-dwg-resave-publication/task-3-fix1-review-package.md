# Task3 fix1 exact two-file delta

Baseline is exactly the initial review's49b42…publisher/c04187…test, preserved in public baseline/task-3-fix1-* files. No commits; unrelated dirty HEAD is not authority. Review only the Important final handoff race and new breakage in this fix.

- platform/app/lukas/lib/drawing-native-dwg-resave-publication.server.ts: 0983a6c68fe1f9f8d3f9f4ddea376f81a7f323cff7fc745aafaa708c0c4612e3
- platform/tests/drawing-native-dwg-resave-publication.test.mjs: 9f0b53133e84c8caf049052bcb157500e58e06ba450478e689c6a269f6c04791

## platform/app/lukas/lib/drawing-native-dwg-resave-publication.server.ts

```diff
diff --git a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-3-fix1-drawing-native-dwg-resave-publication.server.ts b/platform/app/lukas/lib/drawing-native-dwg-resave-publication.server.ts
index c867994..cd13811 100644
--- a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-3-fix1-drawing-native-dwg-resave-publication.server.ts
+++ b/platform/app/lukas/lib/drawing-native-dwg-resave-publication.server.ts
@@ -229,31 +229,30 @@ export async function publishNativeDrawingDwgResaveArtifacts(options: {
     if (pollingStopped) return;
     pollingStopped = true;
     polling = false;
     clearTimeout(pollTimer);
     await pollPending;
   };
 
   const finishClosed = async (
     failure?: PublicationFailure,
   ): Promise<NativeDrawingDwgResavePublicationOutcome> => {
     await stopPolling();
     if (!refusal) await check();
-    const settled = await settleClosedAttempt(
-      serviceClient,
-      claim,
-      refusal,
-      failure,
-    );
-    if (settled) return settled;
+    if (refusal || failure)
+      return (
+        (await settleClosedAttempt(serviceClient, claim, refusal, failure)) ?? {
+          outcome: "control_uncertain",
+        }
+      );
     signal?.removeEventListener("abort", shutdown);
     const args = identityArguments(claim);
     for (let attempt = 0; attempt < 2; attempt += 1) {
       try {
         const receipt = validateNativeDrawingDwgResaveReceipt(
           await callNativeDrawingDwgResaveAttemptRpc(
             serviceClient,
             "lukas_drawing_publish_native_dwg_resave",
             args,
           ),
           claim,
           built!.metadata,
```

## platform/tests/drawing-native-dwg-resave-publication.test.mjs

```diff
diff --git a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-3-fix1-drawing-native-dwg-resave-publication.test.mjs b/platform/tests/drawing-native-dwg-resave-publication.test.mjs
index 63b3679..3d6c6f7 100644
--- a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-3-fix1-drawing-native-dwg-resave-publication.test.mjs
+++ b/platform/tests/drawing-native-dwg-resave-publication.test.mjs
@@ -560,12 +560,61 @@ test("nonprepared native outcome passes through and never touches Storage", asyn
     claim: h.fixture.claim,
     serviceClient: h.serviceClient,
     downloadSource: async () => assert.fail("must not download"),
     resave: async () => assert.fail("must not execute native"),
     dockerPath: "/owned/docker",
     dockerHost: "unix:///owned/socket",
     imageId: h.fixture.imageId,
     storage: h.storage,
   });
   assert.deepEqual(result, { outcome: "cancelled" });
   assert.deepEqual(h.sequence(), ["control", "ack"]);
 });
+
+test("success handoff detaches shutdown before its queued microtask can be observed", async () => {
+  const h = await setup();
+  const parent = new AbortController();
+  const events = [];
+  const queueAbort = (remaining) =>
+    queueMicrotask(() =>
+      remaining === 0 ? parent.abort() : queueAbort(remaining - 1),
+    );
+  parent.signal.addEventListener("abort", () => events.push("abort"));
+  const signal = {
+    get aborted() {
+      return parent.signal.aborted;
+    },
+    addEventListener(...args) {
+      return parent.signal.addEventListener(...args);
+    },
+    removeEventListener(...args) {
+      events.push("detached");
+      return parent.signal.removeEventListener(...args);
+    },
+  };
+  h.state.handlers.control = async (_args, _signal, priorCount) => {
+    h.state.controlCount += 1;
+    if (priorCount === 1) queueAbort(8);
+    return {
+      data: { ...h.identity, action: "continue", reason: null },
+      error: null,
+    };
+  };
+  h.state.handlers.publish = async () => {
+    events.push("publish");
+    return { data: h.receipt, error: null };
+  };
+  const result = await api().publishNativeDrawingDwgResaveArtifacts({
+    ...h.options,
+    signal,
+  });
+  assert.equal(result.outcome, "completed");
+  assert.ok(parent.signal.aborted);
+  assert.ok(
+    events.indexOf("detached") < events.indexOf("abort"),
+    JSON.stringify(events),
+  );
+  assert.ok(
+    events.indexOf("abort") < events.indexOf("publish"),
+    JSON.stringify(events),
+  );
+});
```
