export type DrawingCollaborationReplicaTarget = {
  id: string;
  websocketUrl: string;
  healthUrl: string;
};

const instanceIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

function inventoryError(message: string): never {
  throw new Error(`P3_COLLABORATION_REPLICAS_JSON is UNEXECUTED: ${message}`);
}

export function parseDrawingCollaborationReplicaTargets(
  raw: string | undefined,
  expectedKid: string | undefined,
) {
  let parsed: unknown;
  try {
    parsed = raw && JSON.parse(raw);
  } catch {
    inventoryError("expected a direct replica target array.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0)
    inventoryError("expected a direct replica target array.");

  const replicas = parsed.map((value): DrawingCollaborationReplicaTarget => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      inventoryError("invalid replica target.");
    const keys = Object.keys(value);
    if (
      keys.length !== 3 ||
      !keys.every((key) => ["id", "websocketUrl", "healthUrl"].includes(key))
    )
      inventoryError("invalid replica target.");
    const target = value as Partial<DrawingCollaborationReplicaTarget>;
    if (
      typeof target.id !== "string" ||
      !instanceIdPattern.test(target.id) ||
      typeof target.websocketUrl !== "string" ||
      typeof target.healthUrl !== "string"
    )
      inventoryError("invalid replica target.");

    let websocketUrl: URL;
    let healthUrl: URL;
    try {
      websocketUrl = new URL(target.websocketUrl);
      healthUrl = new URL(target.healthUrl);
    } catch {
      inventoryError("targets must be direct secret-free WSS/HTTPS URLs.");
    }
    if (
      websocketUrl.protocol !== "wss:" ||
      healthUrl.protocol !== "https:" ||
      websocketUrl.username ||
      websocketUrl.password ||
      healthUrl.username ||
      healthUrl.password ||
      websocketUrl.hash ||
      healthUrl.hash ||
      websocketUrl.search ||
      healthUrl.search
    )
      inventoryError("targets must be direct secret-free WSS/HTTPS URLs.");
    return {
      id: target.id,
      websocketUrl: websocketUrl.toString(),
      healthUrl: healthUrl.toString(),
    };
  });

  for (const property of ["id", "websocketUrl", "healthUrl"] as const)
    if (
      new Set(replicas.map((replica) => replica[property])).size !==
      replicas.length
    )
      inventoryError(
        "replica IDs, direct WSS URLs, and direct HTTPS health URLs must be unique.",
      );

  if (!expectedKid || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(expectedKid))
    throw new Error(
      "P3_JWKS_NEW_KID is UNEXECUTED: expected the current signing-key kid.",
    );
  return { replicas, expectedKid };
}

export function verifyDrawingCollaborationReplicaIdentity(input: {
  target: DrawingCollaborationReplicaTarget;
  healthInstanceId: string;
  admissionInstanceId: string;
  observedInstanceIds: Set<string>;
}) {
  const { target, healthInstanceId, admissionInstanceId, observedInstanceIds } =
    input;
  if (!instanceIdPattern.test(healthInstanceId))
    throw new Error(
      `Replica ${target.id} health identity is missing or invalid.`,
    );
  if (!instanceIdPattern.test(admissionInstanceId))
    throw new Error(
      `Replica ${target.id} admission identity is missing or invalid.`,
    );
  if (healthInstanceId !== admissionInstanceId)
    throw new Error(
      `Replica ${target.id} health and admission identities differ.`,
    );
  if (observedInstanceIds.has(healthInstanceId))
    throw new Error(
      `Replica ${target.id} aliases an already observed process identity.`,
    );
  if (healthInstanceId !== target.id)
    throw new Error(
      `Replica ${target.id} observed identity does not match inventory.`,
    );
  observedInstanceIds.add(healthInstanceId);
}
