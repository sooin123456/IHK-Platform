import assert from 'node:assert/strict';
import * as Y from '/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/node_modules/yjs/dist/yjs.mjs';
import { initializeDrawingCollaborationDocument, validateDrawingClientUpdate } from '/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/collaboration/src/server.ts';

// Read-only local diagnostic: production initializer/guard, no storage/server/network.
const context = {
  projectId: 'a2000000-0000-4000-8000-000000000001',
  revisionId: 'a2000000-0000-4000-8000-000000000002',
  userId: 'a2000000-0000-4000-8000-000000000003',
  canWrite: true,
};
const docs = [];
function document(clientID) {
  const doc = new Y.Doc();
  if (clientID) doc.clientID = clientID;
  docs.push(doc);
  return doc;
}
async function bootstrap(clientID) {
  const doc = document(clientID);
  await initializeDrawingCollaborationDocument(doc, {
    projectId: context.projectId,
    revisionId: context.revisionId,
    bootstrap: async () => ({ sha256: 'a'.repeat(64), operationSequence: 0 }),
  });
  return doc;
}
try {
  const original = await bootstrap(1001);
  const persisted = Y.encodeStateAsUpdate(original);
  const client = document();
  Y.applyUpdate(client, persisted);
  const rebootstrap = await bootstrap(2002);
  assert.deepEqual(client.getMap('serverMeta').toJSON(), rebootstrap.getMap('serverMeta').toJSON());
  const honestReplay = Y.encodeStateAsUpdate(client, Y.encodeStateVector(rebootstrap));
  assert.throws(() => validateDrawingClientUpdate(rebootstrap, honestReplay, context), {
    message: 'Clients cannot rewrite protected collaboration state.',
  });
  const restored = document();
  Y.applyUpdate(restored, persisted);
  assert.doesNotThrow(() => validateDrawingClientUpdate(restored, Y.encodeStateAsUpdate(client, Y.encodeStateVector(restored)), context));
  const forged = document();
  Y.applyUpdate(forged, persisted);
  forged.getMap('serverMeta').set('freezeState', 'released');
  assert.throws(() => validateDrawingClientUpdate(restored, Y.encodeStateAsUpdate(forged, Y.encodeStateVector(restored)), context), {
    message: 'Clients cannot rewrite protected collaboration state.',
  });
  console.log(JSON.stringify({
    productionInitializerAndGuard: true,
    logicalBootstrapEqual: true,
    honestReplayBytes: honestReplay.length,
    honestReplayRejected: true,
    durableIdentityRestoreAccepted: true,
    forgedProtectedUpdateRejected: true,
    scope: 'in-memory reproduction, not attribution of every prior runtime closure',
  }, null, 2));
} finally {
  docs.forEach(doc => doc.destroy());
}
