import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  drawingP7ReleaseCommit,
  drawingP7ReleaseTreeSha256,
} from "./drawing-p7-release-evidence.mjs";
import { drawingP7DirectorySha256 } from "./drawing-p7-performance-evidence.mjs";

export const P7_VISUAL_EVIDENCE_PATH = fileURLToPath(
  new URL(
    "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-7-visual-evidence.json",
    import.meta.url,
  ),
);
const artifacts = [
  ["task-7-desktop-1280x720.png", 1280, 720],
  ["task-7-tablet-portrait-768x1024.png", 768, 1024],
  ["task-7-tablet-landscape-1024x768.png", 1024, 768],
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function pngDimensions(bytes) {
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function buildManifestReceipt() {
  const assets = fileURLToPath(
    new URL("../build/client/assets/", import.meta.url),
  );
  const manifests = readdirSync(assets).filter((name) =>
    /^manifest-[0-9A-Za-z_-]+\.js$/.test(name),
  );
  assert.equal(manifests.length, 1, "current client build manifest");
  const server = fileURLToPath(
    new URL("../build/server/index.js", import.meta.url),
  );
  assert.equal(existsSync(server), true, "current server build entry");
  return {
    clientTree: {
      path: "platform/build/client",
      sha256: drawingP7DirectorySha256(
        fileURLToPath(new URL("../build/client/", import.meta.url)),
      ),
    },
    clientManifest: {
      path: `platform/build/client/assets/${manifests[0]}`,
      sha256: sha256(readFileSync(`${assets}/${manifests[0]}`)),
    },
    serverEntry: {
      path: "platform/build/server/index.js",
      sha256: sha256(readFileSync(server)),
    },
  };
}

export function buildDrawingP7VisualEvidence() {
  return {
    schemaVersion: 1,
    authority: "P7_CURRENT_BUILD_VISUAL_ARTIFACTS_V1",
    commit: drawingP7ReleaseCommit(),
    sourceTreeSha256: drawingP7ReleaseTreeSha256(),
    buildManifest: buildManifestReceipt(),
    artifacts: artifacts.map(([name, width, height]) => {
      const path = fileURLToPath(
        new URL(
          `../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/${name}`,
          import.meta.url,
        ),
      );
      const bytes = readFileSync(path);
      assert.deepEqual(pngDimensions(bytes), { width, height });
      return {
        path: `.superpowers/sdd/2026-08-28-drawing-workspace-p7/${name}`,
        width,
        height,
        sha256: sha256(bytes),
      };
    }),
    recordedAt: new Date().toISOString(),
  };
}

export function inspectDrawingP7VisualEvidence(evidence) {
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.authority, "P7_CURRENT_BUILD_VISUAL_ARTIFACTS_V1");
  assert.equal(evidence.commit, drawingP7ReleaseCommit());
  assert.equal(evidence.sourceTreeSha256, drawingP7ReleaseTreeSha256());
  assert.deepEqual(
    evidence.buildManifest,
    buildManifestReceipt(),
    "current client build binding",
  );
  assert.equal(evidence.artifacts.length, artifacts.length);
  for (const [index, expected] of artifacts.entries()) {
    const row = evidence.artifacts[index];
    assert.deepEqual(
      [row.path, row.width, row.height],
      [
        `.superpowers/sdd/2026-08-28-drawing-workspace-p7/${expected[0]}`,
        expected[1],
        expected[2],
      ],
    );
    const bytes = readFileSync(new URL(`../../${row.path}`, import.meta.url));
    assert.equal(row.sha256, sha256(bytes));
    assert.deepEqual(pngDimensions(bytes), {
      width: row.width,
      height: row.height,
    });
  }
  assert.equal(Number.isNaN(Date.parse(evidence.recordedAt)), false);
  return evidence;
}

export function writeDrawingP7VisualEvidence() {
  const evidence = buildDrawingP7VisualEvidence();
  writeFileSync(
    P7_VISUAL_EVIDENCE_PATH,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  return evidence;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === "write") writeDrawingP7VisualEvidence();
  else if (process.argv[2] === "validate")
    inspectDrawingP7VisualEvidence(
      JSON.parse(readFileSync(P7_VISUAL_EVIDENCE_PATH, "utf8")),
    );
  else throw new Error("Usage: drawing-p7-visual-evidence.mjs write|validate");
}
