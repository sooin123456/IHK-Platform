import {
  DRAWING_MEASUREMENT_RULE_VERSION,
  drawingObjectSupportsMeasurement,
  type DrawingMeasurement,
} from "./drawing-measurements.ts";
import {
  assertDrawingCollaborationRecentOutcomeReceipts,
  type DrawingCollaborationRecentOutcomeReceipt,
} from "./drawing-collaboration-client.ts";
import {
  drawingMeasurementObjectFingerprint,
  type DrawingMeasurementEvidenceError,
  type DrawingServerMeasurementEvidence,
} from "./drawing-semantic-schedules.ts";
import type {
  DrawingWorkspace,
  DrawingWorkspaceCollaborationBootstrap,
} from "./drawing-workspace.server.ts";
import type { DrawingObject } from "./drawing-workspace.types.ts";

type MeasurementTuple = readonly [
  canonicalObjectIndex: number,
  lengthMillimeters: string | null,
  areaSquareMillimeters: string | null,
  count: "1",
];

export type DrawingServerMeasurementEvidenceWire = Pick<
  DrawingServerMeasurementEvidence,
  | "documentId"
  | "revisionId"
  | "revisionVersion"
  | "snapshotSha256"
  | "operationCheckpoint"
  | "ruleVersion"
  | "schedules"
> & {
  /** Sorted measurable objects are already present in canonicalJson.objects. */
  measurements: MeasurementTuple[];
};

export type DrawingWorkspaceLoaderCollaborationBootstrap = Omit<
  DrawingWorkspaceCollaborationBootstrap,
  "recentOutcomes"
> & {
  recentOutcomes: DrawingCollaborationRecentOutcomeReceipt[];
};

type CanonicalMeasurementObject = Pick<
  DrawingObject,
  "id" | "name" | "geometry" | "version"
>;

function canonicalMeasurementObjects(values: readonly unknown[]) {
  const objects = values.map((value, canonicalObjectIndex) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Drawing canonical measurement object is invalid.");
    const candidate = value as Partial<CanonicalMeasurementObject>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.name !== "string" ||
      !Number.isSafeInteger(candidate.version) ||
      Number(candidate.version) < 1 ||
      !candidate.geometry ||
      typeof candidate.geometry !== "object" ||
      typeof (candidate.geometry as { type?: unknown }).type !== "string"
    )
      throw new Error("Drawing canonical measurement object is invalid.");
    return {
      canonicalObjectIndex,
      object: candidate as CanonicalMeasurementObject,
    };
  });
  if (new Set(objects.map(({ object }) => object.id)).size !== objects.length)
    throw new Error("Drawing canonical measurement object IDs are duplicated.");
  return objects
    .filter(({ object }) =>
      drawingObjectSupportsMeasurement(object as DrawingObject),
    )
    .sort((left, right) => left.object.id.localeCompare(right.object.id));
}

function sameMeasurementLineage(
  evidence: DrawingServerMeasurementEvidence,
  item: DrawingServerMeasurementEvidence["measurements"][string],
) {
  return (
    item.documentId === evidence.documentId &&
    item.revisionId === evidence.revisionId &&
    item.revisionVersion === evidence.revisionVersion &&
    item.snapshotSha256 === evidence.snapshotSha256 &&
    item.operationCheckpoint === evidence.operationCheckpoint &&
    item.ruleVersion === evidence.ruleVersion &&
    item.measurement.ruleVersion === evidence.ruleVersion
  );
}

function assertMeasurementBootstrapLineage(
  evidence: Pick<
    DrawingServerMeasurementEvidence,
    | "documentId"
    | "revisionId"
    | "revisionVersion"
    | "snapshotSha256"
    | "operationCheckpoint"
  >,
  bootstrap: Pick<
    DrawingWorkspaceCollaborationBootstrap,
    "canonicalJson" | "operationSequence" | "sha256"
  >,
) {
  if (
    evidence.documentId !== bootstrap.canonicalJson.revision.documentId ||
    evidence.revisionId !== bootstrap.canonicalJson.revision.id ||
    evidence.revisionVersion !== bootstrap.canonicalJson.revision.version ||
    evidence.snapshotSha256 !== bootstrap.sha256 ||
    evidence.operationCheckpoint !== bootstrap.operationSequence ||
    bootstrap.canonicalJson.operationSequence !== bootstrap.operationSequence
  )
    throw new Error("Drawing measurement bootstrap lineage is inconsistent.");
}

/** Removes values that are already recoverable from the SHA-bound graph. */
export function compactDrawingServerMeasurementEvidence(
  evidence: DrawingServerMeasurementEvidence,
  bootstrap: Pick<
    DrawingWorkspaceCollaborationBootstrap,
    "canonicalJson" | "operationSequence" | "sha256"
  >,
): DrawingServerMeasurementEvidenceWire {
  assertMeasurementBootstrapLineage(evidence, bootstrap);
  const objects = canonicalMeasurementObjects(bootstrap.canonicalJson.objects);
  if (
    evidence.ruleVersion !== DRAWING_MEASUREMENT_RULE_VERSION ||
    evidence.objectIds.length !== objects.length ||
    evidence.objectLineage.length !== objects.length ||
    Object.keys(evidence.objectFingerprints).length !== objects.length ||
    Object.keys(evidence.measurements).length !== objects.length
  )
    throw new Error("Drawing measurement evidence is not canonical.");
  const measurements = objects.map(
    ({ canonicalObjectIndex, object }, index): MeasurementTuple => {
      const objectId = evidence.objectIds[index];
      const lineage = evidence.objectLineage[index];
      const fingerprint = drawingMeasurementObjectFingerprint(
        object as DrawingObject,
      );
      const item = evidence.measurements[object.id];
      if (
        objectId !== object.id ||
        lineage?.objectId !== object.id ||
        lineage.objectVersion !== object.version ||
        evidence.objectFingerprints[object.id] !== fingerprint ||
        !item ||
        item.objectId !== object.id ||
        item.objectVersion !== object.version ||
        item.objectFingerprint !== fingerprint ||
        !sameMeasurementLineage(evidence, item)
      )
        throw new Error("Drawing measurement evidence is not canonical.");
      return [
        canonicalObjectIndex,
        item.measurement.lengthMillimeters,
        item.measurement.areaSquareMillimeters,
        item.measurement.count,
      ];
    },
  );
  return {
    documentId: evidence.documentId,
    revisionId: evidence.revisionId,
    revisionVersion: evidence.revisionVersion,
    snapshotSha256: evidence.snapshotSha256,
    operationCheckpoint: evidence.operationCheckpoint,
    ruleVersion: evidence.ruleVersion,
    measurements,
    schedules: evidence.schedules,
  };
}

function measurementFromTuple(tuple: MeasurementTuple): DrawingMeasurement {
  const canonicalDecimal = (value: string | null) =>
    value === null ||
    (value.length <= 128 && /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(value));
  if (
    !Array.isArray(tuple) ||
    tuple.length !== 4 ||
    !Number.isSafeInteger(tuple[0]) ||
    tuple[0] < 0 ||
    (tuple[1] !== null && typeof tuple[1] !== "string") ||
    !canonicalDecimal(tuple[1]) ||
    (tuple[2] !== null && typeof tuple[2] !== "string") ||
    !canonicalDecimal(tuple[2]) ||
    tuple[3] !== "1"
  )
    throw new Error("Drawing measurement tuple is invalid.");
  return {
    ruleVersion: DRAWING_MEASUREMENT_RULE_VERSION,
    lengthMillimeters: tuple[1],
    areaSquareMillimeters: tuple[2],
    count: tuple[3],
  };
}

/**
 * Restores the existing inspector contract without adding network copies.
 * `canonicalJson` and `sha256` are one server-validated bootstrap envelope;
 * this synchronous render decoder deliberately does not hash that graph again.
 * Derived fingerprints still make every later local geometry edit stale.
 */
export function hydrateDrawingServerMeasurementEvidence(
  wire: DrawingServerMeasurementEvidenceWire,
  bootstrap: Pick<
    DrawingWorkspaceCollaborationBootstrap,
    "canonicalJson" | "operationSequence" | "sha256"
  >,
): DrawingServerMeasurementEvidence {
  assertMeasurementBootstrapLineage(wire, bootstrap);
  if (wire.ruleVersion !== DRAWING_MEASUREMENT_RULE_VERSION)
    throw new Error("Drawing measurement rule is invalid.");
  const objects = canonicalMeasurementObjects(bootstrap.canonicalJson.objects);
  if (wire.measurements.length !== objects.length)
    throw new Error("Drawing canonical measurement count is inconsistent.");
  const objectIds = objects.map(({ object }) => object.id);
  const objectLineage = objects.map(({ object }) => ({
    objectId: object.id,
    objectVersion: object.version,
  }));
  const objectFingerprints = Object.fromEntries(
    objects.map(({ object }) => [
      object.id,
      drawingMeasurementObjectFingerprint(object as DrawingObject),
    ]),
  );
  const measurements = Object.fromEntries(
    objects.map(({ canonicalObjectIndex, object }, index) => {
      const tuple = wire.measurements[index];
      if (tuple?.[0] !== canonicalObjectIndex)
        throw new Error("Drawing canonical measurement order is inconsistent.");
      const measurement = measurementFromTuple(tuple);
      return [
        object.id,
        {
          documentId: wire.documentId,
          revisionId: wire.revisionId,
          revisionVersion: wire.revisionVersion,
          snapshotSha256: wire.snapshotSha256,
          operationCheckpoint: wire.operationCheckpoint,
          objectId: object.id,
          objectVersion: object.version,
          objectFingerprint: objectFingerprints[object.id],
          ruleVersion: wire.ruleVersion,
          measurement,
        },
      ];
    }),
  );
  return {
    documentId: wire.documentId,
    revisionId: wire.revisionId,
    revisionVersion: wire.revisionVersion,
    snapshotSha256: wire.snapshotSha256,
    operationCheckpoint: wire.operationCheckpoint,
    ruleVersion: wire.ruleVersion,
    objectIds,
    objectLineage,
    objectFingerprints,
    measurements,
    schedules: wire.schedules,
  };
}

/** Keeps malformed evidence local to the inspector instead of crashing the route. */
export function decodeDrawingServerMeasurementEvidence(
  wire: DrawingServerMeasurementEvidenceWire | null | undefined,
  bootstrap:
    | Pick<
        DrawingWorkspaceCollaborationBootstrap,
        "canonicalJson" | "operationSequence" | "sha256"
      >
    | null
    | undefined,
): {
  evidence: DrawingServerMeasurementEvidence | null;
  error: DrawingMeasurementEvidenceError | null;
} {
  if (!wire || !bootstrap) return { evidence: null, error: null };
  try {
    return {
      evidence: hydrateDrawingServerMeasurementEvidence(wire, bootstrap),
      error: null,
    };
  } catch {
    return {
      evidence: null,
      error: {
        code: "measurement_derivation_failed",
        message: "서버 측정 증거를 계산하지 못했습니다.",
      },
    };
  }
}

/** The canonical collaboration graph owns all editor entities on this route. */
export function compactDrawingWorkspaceForLoader(
  workspace: DrawingWorkspace,
  bootstrap: Pick<
    DrawingWorkspaceCollaborationBootstrap,
    "canonicalJson" | "operationSequence" | "sha256"
  >,
): DrawingWorkspace {
  const revision = workspace.document.revision;
  const canonicalRevision = bootstrap.canonicalJson.revision;
  if (
    canonicalRevision.id !== revision.id ||
    canonicalRevision.documentId !== workspace.document.id ||
    canonicalRevision.projectId !== workspace.document.project_id ||
    canonicalRevision.version !== revision.version ||
    bootstrap.canonicalJson.operationSequence !== bootstrap.operationSequence
  )
    throw new Error("Drawing loader collaboration graph is inconsistent.");
  return {
    ...workspace,
    templateCandidates: [],
    document: {
      ...workspace.document,
      revision: {
        ...revision,
        pages: [],
        canvases: [],
        layers: [],
        objects: [],
        sources: [],
        styles: [],
        blocks: [],
        blockInstances: [],
        propertySchemas: [],
        propertyValues: [],
        tables: [],
      },
    },
  };
}

/** Snapshot effects stay in canonicalJson; the browser needs only ack receipts. */
export function compactDrawingCollaborationBootstrapForLoader(
  bootstrap: DrawingWorkspaceCollaborationBootstrap,
): DrawingWorkspaceLoaderCollaborationBootstrap {
  assertDrawingCollaborationRecentOutcomeReceipts({
    revisionId: bootstrap.canonicalJson.revision.id,
    baseOperationSequence: bootstrap.operationSequence,
    recentOutcomes: bootstrap.recentOutcomes,
  });
  return {
    ...bootstrap,
    recentOutcomes: bootstrap.recentOutcomes.map((outcome) => ({
      revisionId: outcome.revisionId,
      clientOperationId: outcome.clientOperationId,
      actorId: outcome.actorId,
      sequence: outcome.sequence,
      resultVersions: outcome.resultVersions,
      operationSha256: outcome.operationSha256,
    })),
  };
}
