# task-1-fix-1 review package

Uncommitted scoped diff against captured dirty baseline; unrelated changes excluded.
HEAD: 9f5f56d93db325ff935772252f9d4fb64d69f98c


## platform/app/lukas/lib/drawing-native-dwg-resave-source.server.ts

diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-approved-resave-source/task-1-code/platform/app/lukas/lib/drawing-native-dwg-resave-source.server.ts b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-resave-source.server.ts
index 7f217a6..e33ece9 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-approved-resave-source/task-1-code/platform/app/lukas/lib/drawing-native-dwg-resave-source.server.ts
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-resave-source.server.ts
@@ -81,20 +81,27 @@ export async function projectApprovedNativeDrawingDwgResaveSource(
       analysis.scope.projectId !== scope.projectId ||
       analysis.scope.sourceFileId !== receipt.source.fileId ||
       analysis.scope.sourceSha256 !== receipt.source.sha256 ||
       Buffer.byteLength(approved.snapshot.canonicalJsonText, "utf8") >
         20 * 1024 * 1024 ||
       createHash("sha256")
         .update(approved.snapshot.canonicalJsonText, "utf8")
         .digest("hex") !== scope.snapshotSha256
     )
       throw new DrawingNativeDwgResaveSourceError();
+    const isClone = analysis.scope.revisionId !== scope.revisionId;
+    if (
+      !isClone &&
+      (analysis.scope.documentId !== scope.documentId ||
+        analysis.scope.canvasId !== scope.canvasId)
+    )
+      throw new DrawingNativeDwgResaveSourceError();
     const { state } = hydrateDrawingAuthoritySnapshot({
       projectId: scope.projectId,
       documentId: scope.documentId,
       revision: approved.revision,
       snapshot: {
         sha256: scope.snapshotSha256,
         schemaVersion: 2,
         operationSequence: approved.snapshot.operationSequence,
         canonicalJson: JSON.parse(approved.snapshot.canonicalJsonText),
       },
@@ -142,21 +149,25 @@ export async function projectApprovedNativeDrawingDwgResaveSource(
     const layerIds = new Map<string, string>();
     for (const nativeLayer of plan.layers) {
       const matches = layers.filter(
         (layer) =>
           layer.name === nativeLayer.name && layer.systemKind === "custom",
       );
       if (matches.length !== 1) throw new DrawingNativeDwgResaveSourceError();
       const current = matches[0];
       if (
         !isDeepStrictEqual(
-          { ...current, id: nativeLayer.id, version: nativeLayer.version },
+          {
+            ...current,
+            id: isClone ? nativeLayer.id : current.id,
+            version: nativeLayer.version,
+          },
           nativeLayer,
         ) ||
         current.version < nativeLayer.version
       )
         throw new DrawingNativeDwgResaveSourceError();
       layerIds.set(current.id, nativeLayer.id);
     }
     if (
       layers.some(
         (layer) =>
@@ -179,37 +190,39 @@ export async function projectApprovedNativeDrawingDwgResaveSource(
       const object = structure.objects[source.objectId];
       if (
         !expected ||
         !object ||
         seenHandles.has(source.handle) ||
         seenObjects.has(source.objectId) ||
         source.version < expected.version ||
         !isDeepStrictEqual(
           {
             ...source,
-            id: expected.id,
-            objectId: expected.objectId,
+            id: isClone ? expected.id : source.id,
+            objectId: isClone ? expected.objectId : source.objectId,
             version: expected.version,
           },
           expected,
         )
       )
         throw new DrawingNativeDwgResaveSourceError();
       seenHandles.add(source.handle);
       seenObjects.add(source.objectId);
       bindings.push({ objectId: object.id, handle: source.handle });
       const projected = baseline.objects.find(
         (candidate) => candidate.id === expected.objectId,
       )!;
       if (layerIds.get(object.layerId) !== projected.layerId)
         throw new DrawingNativeDwgResaveSourceError();
-      return { ...object, id: expected.objectId, layerId: projected.layerId };
+      return isClone
+        ? { ...object, id: expected.objectId, layerId: projected.layerId }
+        : object;
     });
     bindings.sort((a, b) =>
       BigInt(`0x${a.handle}`) < BigInt(`0x${b.handle}`) ? -1 : 1,
     );
     const selectedEdits = buildNativeDrawingDwgSelectedEdits({
       importInput,
       objects: boundCanonicalObjects,
     });
     return {
       scope,


## platform/tests/drawing-native-dwg-resave-source.test.mjs

diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-approved-resave-source/task-1-code/platform/tests/drawing-native-dwg-resave-source.test.mjs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/tests/drawing-native-dwg-resave-source.test.mjs
index 4205f81..433f6b8 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-approved-resave-source/task-1-code/platform/tests/drawing-native-dwg-resave-source.test.mjs
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/tests/drawing-native-dwg-resave-source.test.mjs
@@ -488,20 +488,88 @@ test("RPC loader forwards only validated scope and returns compiled results or a
     },
     async () => ({ data: f.payload, error: { message: "private SQL" } }),
     async () => null,
   ])
     await assert.rejects(
       adapter.loadApprovedNativeDrawingDwgResaveSource({ rpc }, f.scope),
       (e) => unavailable(e) && !/private/.test(e.message),
     );
 });
 
+test("same analysis revision requires exact native layer, object and source identities after rehashing", async (t) => {
+  for (const mutation of [
+    "layer",
+    "object",
+    "source",
+    "all",
+    "document",
+    "canvas",
+  ]) {
+    await t.test(mutation, async () => {
+      const f = fixture();
+      const plan = buildNativeDrawingDwgImportPlan({
+        report: f.report,
+        expectedSource: f.report.source,
+        revisionId: f.scope.revisionId,
+        canvasId: f.scope.canvasId,
+        sourceFileId: uuid(9),
+        analysisJobId: uuid(10),
+        reportSha256: f.payload.analysis.result.receipt.reportSha256,
+      });
+      Object.assign(f.payload.analysis.scope, {
+        documentId: f.scope.documentId,
+        revisionId: f.scope.revisionId,
+        canvasId: f.scope.canvasId,
+      });
+      f.canonical.layers = plan.layers.map((layer) => ({
+        ...layer,
+        pageId: uuid(4),
+      }));
+      f.canonical.objects = plan.objects.map((object) => ({
+        ...object,
+        lineageId: uuid(17),
+        pageId: uuid(4),
+        type: object.geometry.type,
+      }));
+      f.canonical.sources = structuredClone(plan.sources);
+      f.rehash();
+      assert.equal(
+        (
+          await adapter.projectApprovedNativeDrawingDwgResaveSource(
+            f.scope,
+            f.payload,
+          )
+        ).selectedEdits.request,
+        null,
+      );
+      if (mutation === "layer" || mutation === "all") {
+        f.canonical.layers[0].id = uuid(60);
+        f.canonical.objects[0].layerId = uuid(60);
+      }
+      if (mutation === "object" || mutation === "all") {
+        f.canonical.objects[0].id = uuid(61);
+        f.canonical.sources[0].objectId = uuid(61);
+      }
+      if (mutation === "source" || mutation === "all")
+        f.canonical.sources[0].id = uuid(71);
+      if (mutation === "document")
+        f.payload.analysis.scope.documentId = uuid(82);
+      if (mutation === "canvas") f.payload.analysis.scope.canvasId = uuid(85);
+      f.rehash();
+      await assert.rejects(
+        adapter.projectApprovedNativeDrawingDwgResaveSource(f.scope, f.payload),
+        unavailable,
+      );
+    });
+  }
+});
+
 test("approved original and clone compile all five geometry types with native handle ordering", async () => {
   const f = fixture();
   f.report.entities.push(
     {
       handle: "3",
       ownerHandle: "1F",
       layerHandle: "10",
       type: "TEXT",
       geometry: { insert: [1, 2, 0], height: 2, text: "Base" },
     },
@@ -616,27 +684,43 @@ test("approved original and clone compile all five geometry types with native ha
   f.rehash();
   assert.deepEqual(
     (
       await adapter.projectApprovedNativeDrawingDwgResaveSource(
         f.scope,
         f.payload,
       )
     ).selectedEdits.request.edits,
     expected,
   );
-  // Clone changes every object/source/layer identity while preserving geometry and anchors.
+  // The clone has its own approved revision/document/canvas and retains the
+  // historical analysis scope; changing IDs within the original is not a clone.
+  Object.assign(f.scope, {
+    documentId: uuid(82),
+    revisionId: uuid(83),
+    canvasId: uuid(85),
+  });
+  Object.assign(f.payload.approved, {
+    documentId: uuid(82),
+    canvasId: uuid(85),
+  });
+  f.payload.approved.revision.id = uuid(83);
+  Object.assign(f.canonical.revision, { id: uuid(83), documentId: uuid(82) });
+  f.canonical.pages[0].revisionId = uuid(83);
+  f.canonical.canvases[0].id = uuid(85);
+  f.canonical.layers[0].canvasId = uuid(85);
   f.canonical.layers[0].id = uuid(60);
   f.canonical.objects.forEach((object, i) => {
     object.id = uuid(61 + i);
     object.layerId = uuid(60);
     f.canonical.sources[i].objectId = object.id;
     f.canonical.sources[i].id = uuid(71 + i);
+    f.canonical.sources[i].revisionId = uuid(83);
   });
   f.rehash();
   const cloned = await adapter.projectApprovedNativeDrawingDwgResaveSource(
     f.scope,
     f.payload,
   );
   assert.deepEqual(cloned.selectedEdits.request.edits, expected);
   assert.deepEqual(
     cloned.bindings.map((b) => b.handle),
     ["3", "4", "5", "6", "2A"],

