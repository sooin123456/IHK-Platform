import { createHash } from "node:crypto";

import {
  fixture as sourceFixture,
  uuid,
} from "./drawing-native-dwg-resave-source.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// This finite literal frame exercises the production protocol and attestation
// compilers. It is deliberately not evidence of an actual native resave.
export async function resaveArtifactFixture(buildAttestation) {
  const fixture = sourceFixture();
  const sourceBytes = Buffer.from("AC1024artifact-finite-source");
  Object.assign(fixture.report.source, {
    sha256: sha256(sourceBytes),
    byteSize: sourceBytes.byteLength,
  });
  const analysis = fixture.payload.analysis;
  Object.assign(analysis.result.receipt.source, fixture.report.source);
  analysis.scope.sourceSha256 = fixture.report.source.sha256;
  analysis.result.reportText = JSON.stringify(fixture.report);
  analysis.result.receipt.reportSha256 = sha256(analysis.result.reportText);
  analysis.result.receipt.reportByteSize = Buffer.byteLength(
    analysis.result.reportText,
  );
  Object.assign(fixture.canonical.sources[0], {
    sourceSha256: fixture.report.source.sha256,
    reportSha256: analysis.result.receipt.reportSha256,
  });
  fixture.canonical.objects[0].geometry.end = { x: 55, y: 65 };
  fixture.rehash();

  const imageId = `sha256:${"c".repeat(64)}`;
  const attestation = await buildAttestation(
    fixture.scope,
    fixture.payload,
    imageId,
  );
  const claim = {
    jobId: uuid(90),
    attemptNumber: 2,
    leaseToken: uuid(91),
    leaseExpiresAt: "2099-01-01T00:00:00.000Z",
    actorId: uuid(80),
    scope: fixture.scope,
    source: {
      ...analysis.result.receipt.source,
      bucket: "lukas-qto",
      path: "owned/source.dwg",
    },
    attestation,
    payload: fixture.payload,
  };
  const dwgBytes = Buffer.from("AC1024artifact-finite-output");
  const report = {
    schemaVersion: "1hk-dwg-resave/1",
    qualification: "experimental-unqualified",
    persistenceAuthority: "not-issued",
    source: { ...fixture.report.source },
    request: {
      schemaVersion: "1hk-dwg-edits/2",
      sha256: attestation.request.sha256,
      byteSize: attestation.request.byteSize,
      handles: [...attestation.request.handles],
    },
    output: {
      sha256: sha256(dwgBytes),
      byteSize: dwgBytes.byteLength,
      headerVersion: "AC1024",
    },
    engine: { name: "ACadSharp", version: "3.7.1" },
    verification: {
      noEditRoundTrip: "passed",
      selectedEditRoundTrip: "passed",
      geometryTolerance: 1e-9,
      inventoriedEntityCount: 1,
      editedEntityCount: 1,
      inventoryCoverage: "supported-fields-only",
      independentCad: "not-performed",
    },
  };
  return {
    claim,
    result: {
      report,
      reportBytes: Buffer.from(JSON.stringify(report)),
      dwgBytes,
    },
    imageId,
    sourceBytes,
  };
}
