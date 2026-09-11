import { createHash, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";
import postgres from "postgres";

const IFC_URL =
  "https://raw.githubusercontent.com/ThatOpen/engine_web-ifc/3f6f3640b8317664194911fad63bcd407f7e32ca/examples/example.ifc";
const IFC_SHA256 =
  "db372f3f57796e2f572958c1c144bf3d8be7912493738636a2152cf18f08a14d";

type TestUser = { id: string; email: string };

type VerifiedFixtureUpload = {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
  kind: "pdf" | "ifc" | "dxf" | "estimate" | "other";
  originalFilename: string;
};

type WorkspaceFixture = {
  documentId: string;
  revisionId: string;
  pageId: string;
  canvasId: string;
  sourceLayerId: string;
  workLayerId: string;
  fileId: string;
};

export type DrawingFixture = {
  admin: SupabaseClient;
  retentionClient: SupabaseClient;
  owner: TestUser;
  editor: TestUser;
  reviewer: TestUser;
  approver: TestUser;
  viewer: TestUser;
  nonMember: TestUser;
  projectId: string;
  organizationId: string;
  pdfFileId: string;
  ifcFileId: string;
  revisedPdfFileId: string;
  revisedIfcFileId: string;
  pdfWorkspace: WorkspaceFixture;
  blankWorkspace: WorkspaceFixture;
  existingIssueId: string;
  sourceEvidence: Record<
    string,
    {
      metadataSha256: string;
      storageByteSha256: string;
      byteLength: number;
    }
  >;
  storagePaths: string[];
};

async function cleanupDrawingResources(
  admin: DrawingFixture["admin"],
  retentionClient: DrawingFixture["retentionClient"] | null,
  projectId: string | null | undefined,
  organizationId: string | null | undefined,
  users: TestUser[],
) {
  const cleanupErrors: Error[] = [];
  let storagePurge:
    | { eventId: string; manifestSha256: string; paths: string[] }
    | undefined;
  const attempt = async (
    label: string,
    operation: () => Promise<{ error: unknown }>,
  ) => {
    try {
      const result = await operation();
      if (result.error) {
        cleanupErrors.push(
          new Error(
            `${label}: ${String((result.error as Error).message ?? result.error)}`,
          ),
        );
        return false;
      }
      return true;
    } catch (error) {
      cleanupErrors.push(
        new Error(
          `${label}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return false;
    }
  };

  // Cleanup dependency order: the product retention boundary authorizes the
  // project cascade, Storage removes fixture bytes, then Auth users are removed.
  if (projectId) {
    if (!organizationId || !retentionClient) {
      cleanupErrors.push(
        new Error("project cleanup: retention authority unavailable"),
      );
    } else {
      await attempt("fixture retention policy", async () =>
        retentionClient.rpc("lukas_qto_set_retention_policy", {
          p_organization_id: organizationId,
          p_archive_retention_days: 0,
          p_approved_retention_days: 365,
          p_reason: "Disposable E2E fixture cleanup",
          p_request_id: randomUUID(),
        }),
      );
      await attempt("fixture deletion request", async () =>
        retentionClient.rpc("lukas_qto_request_project_deletion", {
          p_organization_id: organizationId,
          p_project_id: projectId,
          p_reason: "Disposable E2E fixture cleanup",
          p_request_id: randomUUID(),
        }),
      );
      await attempt("trusted project purge", async () => {
        const result = await admin.rpc("lukas_qto_purge_project", {
          p_organization_id: organizationId,
          p_project_id: projectId,
          p_request_id: randomUUID(),
          p_reason: "Disposable E2E fixture cleanup",
        });
        if (!result.error && result.data?.status === "STORAGE_REQUIRED") {
          const files = result.data.files;
          const validFiles =
            Array.isArray(files) &&
            files.length > 0 &&
            files.every(
              (file) =>
                file &&
                typeof file.path === "string" &&
                file.path.length > 0 &&
                typeof file.sha256 === "string" &&
                /^[0-9a-f]{64}$/.test(file.sha256) &&
                Number.isSafeInteger(file.byteSize) &&
                file.byteSize > 0,
            );
          if (
            typeof result.data.eventId === "string" &&
            /^[0-9a-f]{64}$/.test(result.data.manifestSha256) &&
            validFiles
          )
            storagePurge = {
              eventId: result.data.eventId,
              manifestSha256: result.data.manifestSha256,
              paths: files.map((file) => file.path),
            };
          else
            return { error: new Error("project Storage manifest is invalid") };
        }
        return result.error ||
          !["PURGED", "STORAGE_REQUIRED"].includes(result.data?.status)
          ? {
              error:
                result.error ??
                new Error(`project held: ${result.data?.reason ?? "unknown"}`),
            }
          : { error: null };
      });
    }
  }
  if (projectId && organizationId && storagePurge) {
    const ready = storagePurge;
    const storageRemoved = await attempt("storage cleanup", () =>
      admin.storage.from("lukas-qto").remove(ready.paths),
    );
    if (storageRemoved)
      await attempt("trusted project purge finalization", async () =>
        admin.rpc("lukas_qto_finalize_project_purge", {
          p_organization_id: organizationId,
          p_project_id: projectId,
          p_ready_event_id: ready.eventId,
          p_manifest_sha256: ready.manifestSha256,
          p_request_id: randomUUID(),
          p_reason: "Disposable E2E fixture Storage cleanup confirmed",
        }),
      );
  }
  for (const user of users) {
    await attempt(`user cleanup (${user.id})`, () =>
      admin.auth.admin.deleteUser(user.id),
    );
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      "Drawing E2E cleanup left possible residue",
    );
  }
}

function required(name: string) {
  const value = process.env[name];
  if (!value || value === "[SENSITIVE]")
    throw new Error(
      `${name} must be supplied as an actual secret for drawing E2E; masked Vercel env output is not usable`,
    );
  return value;
}

const DRAWING_P2_PRODUCTION_VARIABLES = [
  "E2E_BASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const DRAWING_P3_PRODUCTION_VARIABLES = [
  "E2E_BASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_DRAWING_COLLABORATION_URL",
  "COLLABORATION_INTERNAL_URL",
  "COLLABORATION_INTERNAL_SECRET",
  "COLLABORATION_FREEZE_SECRET",
  "P3_E2E_DATABASE_ADMIN_URL",
  "P3_E2E_RUN_ID",
] as const;

function isActualProductionValue(value: string | undefined) {
  if (!value?.trim()) return false;
  const normalized = value.trim().toLowerCase();
  return !(
    normalized === "[sensitive]" ||
    normalized === "***" ||
    normalized.includes("<masked") ||
    normalized.includes("placeholder")
  );
}

function isExternalUrl(value: string | undefined, protocols: string[]) {
  if (!isActualProductionValue(value)) return false;
  try {
    const url = new URL(value!);
    const hostname = url.hostname.toLowerCase();
    return (
      protocols.includes(url.protocol) &&
      hostname !== "localhost" &&
      hostname !== "127.0.0.1" &&
      hostname !== "::1" &&
      !hostname.endsWith(".test") &&
      !hostname.includes("example")
    );
  } catch {
    return false;
  }
}

function isDrawingP3ProductionValue(
  name: (typeof DRAWING_P3_PRODUCTION_VARIABLES)[number],
  value: string | undefined,
) {
  const normalized = value?.trim();
  if (!isActualProductionValue(normalized)) return false;
  if (name === "E2E_BASE_URL" || name === "COLLABORATION_INTERNAL_URL")
    return isExternalUrl(normalized, ["https:"]);
  if (name === "SUPABASE_URL")
    return (
      isExternalUrl(normalized, ["https:"]) &&
      new URL(normalized!).hostname.endsWith(".supabase.co")
    );
  if (name === "VITE_DRAWING_COLLABORATION_URL")
    return isExternalUrl(normalized, ["wss:"]);
  if (name === "P3_E2E_DATABASE_ADMIN_URL")
    return isExternalUrl(normalized, ["postgres:", "postgresql:"]);
  if (name === "P3_E2E_RUN_ID")
    return (
      /^[a-z0-9](?:[a-z0-9-]{6,46}[a-z0-9])$/.test(normalized!) &&
      !/placeholder|example|dummy|local|test-value/i.test(normalized!)
    );
  if (
    name === "COLLABORATION_INTERNAL_SECRET" ||
    name === "COLLABORATION_FREEZE_SECRET"
  )
    return (
      normalized!.length >= 32 && !/placeholder|dummy|local/i.test(normalized!)
    );
  return (
    normalized!.length >= 32 &&
    !/placeholder|dummy|local-anon-key|test-value/i.test(normalized!)
  );
}

export function drawingP3ProductionCredentialStatus(
  environment: Record<string, string | undefined>,
) {
  const missing = DRAWING_P3_PRODUCTION_VARIABLES.filter(
    (name) => !isDrawingP3ProductionValue(name, environment[name]),
  );
  return {
    status: missing.length === 0 ? ("READY" as const) : ("UNEXECUTED" as const),
    missing,
  };
}

export function requireDrawingP3ProductionCredentials(
  environment: Record<string, string | undefined>,
) {
  const status = drawingP3ProductionCredentialStatus(environment);
  if (status.status !== "READY")
    throw new Error(
      `P3 production gate is UNEXECUTED: real values are required for ${status.missing.join(
        ", ",
      )}`,
    );
  const normalized = Object.fromEntries(
    DRAWING_P3_PRODUCTION_VARIABLES.map((name) => [
      name,
      environment[name]!.trim(),
    ]),
  ) as Record<(typeof DRAWING_P3_PRODUCTION_VARIABLES)[number], string>;
  if (
    normalized.COLLABORATION_INTERNAL_SECRET ===
    normalized.COLLABORATION_FREEZE_SECRET
  )
    throw new Error(
      "P3 production gate is UNEXECUTED: collaboration outcome and freeze secrets must differ",
    );
  return normalized;
}

function isLoopbackUrl(value: string | undefined, protocols: string[]) {
  if (!isActualProductionValue(value)) return false;
  try {
    const url = new URL(value!);
    return (
      protocols.includes(url.protocol) &&
      ["127.0.0.1", "[::1]", "::1"].includes(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export function requireDrawingP3DisposableCredentials(
  environment: Record<string, string | undefined>,
) {
  const invalid = new Set<string>();
  if (environment.M1_E2E_P3_DISPOSABLE !== "1")
    invalid.add("M1_E2E_P3_DISPOSABLE");
  if (environment.M1_E2E_DISPOSABLE !== "1")
    invalid.add("M1_E2E_DISPOSABLE");
  if (environment.E2E_BASE_URL !== "http://127.0.0.1:4000")
    invalid.add("E2E_BASE_URL");
  if (
    environment.VITE_DRAWING_COLLABORATION_URL !== "ws://127.0.0.1:12349"
  )
    invalid.add("VITE_DRAWING_COLLABORATION_URL");
  if (
    environment.COLLABORATION_INTERNAL_URL !== "http://127.0.0.1:12349"
  )
    invalid.add("COLLABORATION_INTERNAL_URL");
  if (!isLoopbackUrl(environment.SUPABASE_URL, ["http:"]))
    invalid.add("SUPABASE_URL");
  for (const name of [
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const)
    if (!isDrawingP3ProductionValue(name, environment[name]))
      invalid.add(name);
  const databaseUrl = environment.M1_REAL_POSTGRES_DATABASE_URL;
  if (!isLoopbackUrl(databaseUrl, ["postgres:", "postgresql:"]))
    invalid.add("M1_REAL_POSTGRES_DATABASE_URL");
  if (
    environment.P3_E2E_DATABASE_ADMIN_URL !== databaseUrl ||
    !isLoopbackUrl(environment.P3_E2E_DATABASE_ADMIN_URL, [
      "postgres:",
      "postgresql:",
    ])
  )
    invalid.add("P3_E2E_DATABASE_ADMIN_URL");
  for (const name of [
    "COLLABORATION_INTERNAL_SECRET",
    "COLLABORATION_FREEZE_SECRET",
    "P3_E2E_RUN_ID",
  ] as const)
    if (!isDrawingP3ProductionValue(name, environment[name]))
      invalid.add(name);
  if (
    environment.COLLABORATION_INTERNAL_SECRET?.trim() ===
    environment.COLLABORATION_FREEZE_SECRET?.trim()
  )
    invalid.add("COLLABORATION_FREEZE_SECRET");
  if (invalid.size > 0)
    throw new Error(
      `P3 disposable gate is UNEXECUTED: runner-owned values are required for ${[...invalid].join(
        ", ",
      )}`,
    );
  return Object.fromEntries(
    DRAWING_P3_PRODUCTION_VARIABLES.map((name) => [
      name,
      environment[name]!.trim(),
    ]),
  ) as Record<(typeof DRAWING_P3_PRODUCTION_VARIABLES)[number], string>;
}

export function buildDrawingP3WorkspacePath(
  fixture: Pick<DrawingFixture, "projectId">,
  workspace: Pick<WorkspaceFixture, "documentId">,
  documentId = workspace.documentId,
) {
  return `/projects/${fixture.projectId}/workspaces/${documentId}`;
}

export const DRAWING_P3_SECOND_CANVAS_BUTTON_NAME =
  /^P2 (?:paper|model) canvas 02 \((?:용지|모델)\)$/;

export const DRAWING_P3_SECOND_OBJECT_TARGET = { x: 270, y: 140 } as const;

export function buildDrawingP3ReflectionGesture(index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= 30)
    throw new Error("P3 reflection gesture index is out of range");
  const from = {
    x: 40 + (index % 10) * 30,
    y: 160 + Math.floor(index / 10) * 50,
  };
  return { from, to: { x: from.x + 20, y: from.y + 20 } };
}

const DRAWING_P3_DISPOSABLE_IFC_CLEANUP_SHA256 = createHash("sha256")
  .update("1HK-P3-DISPOSABLE-IFC-CLEANUP-v1", "utf8")
  .digest("hex");

export async function failDrawingP3DisposableDerivativeJobs(
  fixture: Pick<
    DrawingFixture,
    | "admin"
    | "projectId"
    | "ifcFileId"
    | "revisedIfcFileId"
    | "sourceEvidence"
  >,
  statusClient: Pick<SupabaseClient, "rpc">,
) {
  const sourceIds = [
    fixture.ifcFileId,
    fixture.revisedIfcFileId,
  ];
  const expectedSources = new Set(sourceIds);
  for (let attempt = 0; attempt < sourceIds.length; attempt += 1) {
    const claimed = await fixture.admin.rpc(
      "lukas_drawing_claim_ifc_derivative_job_for_converter",
      {
        p_converter_sha256: DRAWING_P3_DISPOSABLE_IFC_CLEANUP_SHA256,
        p_lease_seconds: 300,
      },
    );
    if (claimed.error)
      throw new Error("Disposable IFC derivative cleanup claim failed");
    const candidate = Array.isArray(claimed.data) ? claimed.data[0] : null;
    if (!candidate)
      throw new Error("Disposable IFC derivative cleanup queue is incomplete");
    if (
      candidate.project_id !== fixture.projectId ||
      !expectedSources.delete(candidate.source_file_id) ||
      typeof candidate.job_id !== "string" ||
      typeof candidate.lease_token !== "string" ||
      !Number.isSafeInteger(candidate.derivative_version)
    )
      throw new Error("Disposable IFC derivative cleanup claimed unexpected work");
    const failed = await fixture.admin.rpc(
      "lukas_drawing_fail_ifc_derivative_job",
      {
        p_job_id: candidate.job_id,
        p_lease_token: candidate.lease_token,
        p_derivative_version: candidate.derivative_version,
        p_retryable: false,
        p_error_code: "disposable_fixture_cleanup",
        p_error_message: "Disposable fixture ended before IFC conversion.",
      },
    );
    if (
      failed.error ||
      (failed.data !== "failed" && failed.data !== "completed")
    )
      throw new Error("Disposable IFC derivative cleanup transition failed");
  }
  if (expectedSources.size)
    throw new Error("Disposable IFC derivative cleanup queue is incomplete");
  for (const sourceFileId of sourceIds) {
    const status = await statusClient.rpc(
      "lukas_drawing_ifc_derivative_job_status",
      {
        p_source_file_id: sourceFileId,
        p_source_sha256: fixture.sourceEvidence[sourceFileId]?.metadataSha256,
      },
    );
    if (
      status.error ||
      !status.data ||
      !["failed", "completed"].includes(status.data.state)
    )
      throw new Error("Disposable IFC derivative cleanup is not terminal");
  }
}

export function buildDrawingP3Identities(runId: string) {
  if (
    !/^[a-z0-9](?:[a-z0-9-]{6,46}[a-z0-9])$/.test(runId) ||
    /placeholder|example|dummy|local|test-value/i.test(runId)
  )
    throw new Error("P3 E2E run ID is invalid");
  return {
    owner: `1hk-p3-e2e-owner-${runId}@example.test`,
    editor: `1hk-p3-e2e-editor-${runId}@example.test`,
    reviewer: `1hk-p3-e2e-reviewer-${runId}@example.test`,
    viewer: `1hk-p3-e2e-viewer-${runId}@example.test`,
    nonMember: `1hk-p3-e2e-nonmember-${runId}@example.test`,
  };
}

export function drawingP2ProductionCredentialStatus(
  environment: Record<string, string | undefined>,
) {
  const missing = DRAWING_P2_PRODUCTION_VARIABLES.filter(
    (name) => !isActualProductionValue(environment[name]),
  );
  return {
    status: missing.length === 0 ? ("READY" as const) : ("UNEXECUTED" as const),
    missing,
  };
}

export function requireDrawingP2ProductionCredentials(
  environment: Record<string, string | undefined>,
) {
  const status = drawingP2ProductionCredentialStatus(environment);
  if (status.status !== "READY")
    throw new Error(
      `P2 production gate is UNEXECUTED: real values are required for ${status.missing.join(
        ", ",
      )}`,
    );
  return Object.fromEntries(
    DRAWING_P2_PRODUCTION_VARIABLES.map((name) => [
      name,
      environment[name]!.trim(),
    ]),
  ) as Record<(typeof DRAWING_P2_PRODUCTION_VARIABLES)[number], string>;
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function downloadSourceEvidence(
  admin: SupabaseClient,
  fileIds: string[],
) {
  const { data, error } = await admin
    .from("lukas_qto_files")
    .select("id,sha256,storage_path,byte_size")
    .in("id", fileIds);
  if (error) throw error;
  if (!data || data.length !== fileIds.length)
    throw new Error("Source metadata evidence is incomplete");

  const evidence: DrawingFixture["sourceEvidence"] = {};
  for (const file of data) {
    const { data: blob, error: downloadError } = await admin.storage
      .from("lukas-qto")
      .download(file.storage_path);
    if (downloadError || !blob)
      throw downloadError ?? new Error("Source byte download returned no data");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    evidence[file.id] = {
      metadataSha256: file.sha256,
      storageByteSha256: sha256(bytes),
      byteLength: bytes.byteLength,
    };
    if (
      evidence[file.id].metadataSha256 !==
        evidence[file.id].storageByteSha256 ||
      evidence[file.id].byteLength !== file.byte_size
    )
      throw new Error("Source Storage bytes do not match immutable metadata");
  }
  return evidence;
}

function parseWorkspace(value: unknown, fileId: string): WorkspaceFixture {
  const row = value as Partial<Omit<WorkspaceFixture, "fileId">> | null;
  if (
    !row?.documentId ||
    !row.revisionId ||
    !row.pageId ||
    !row.canvasId ||
    !row.sourceLayerId ||
    !row.workLayerId
  ) {
    throw new Error("Drawing workspace IDs missing after setup");
  }
  return { ...row, fileId } as WorkspaceFixture;
}

function twoPagePdf() {
  const streams = [
    "BT /F1 20 Tf 72 720 Td (1HK TEST PAGE 1) Tj ET 50 560 300 100 re S",
    "BT /F1 20 Tf 72 720 Td (1HK TEST PAGE 2) Tj ET 90 500 250 140 re S",
  ];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${streams[0].length} >>\nstream\n${streams[0]}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${streams[1].length} >>\nstream\n${streams[1]}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "ascii"));
}

async function createUser(
  admin: SupabaseClient,
  label: string,
  runId: string,
  email?: string,
) {
  email ??= `1hk-e2e-${label}-${runId}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user)
    throw error ?? new Error(`Could not create ${label}`);
  return { id: data.user.id, email };
}

export async function finalizeVerifiedFixtureUpload({
  admin,
  input,
  ownerClient,
  ownerId,
  projectId,
  storagePaths,
}: {
  admin: SupabaseClient;
  input: VerifiedFixtureUpload;
  ownerClient: SupabaseClient;
  ownerId: string;
  projectId: string;
  storagePaths: string[];
}) {
  const storagePath = `${ownerId}/${projectId}/source-uploads/${randomUUID()}.${input.extension}`;
  const digest = sha256(input.bytes);
  storagePaths.push(storagePath);
  const upload = await ownerClient.storage
    .from("lukas-qto")
    .upload(storagePath, input.bytes, {
      contentType: input.contentType,
      upsert: false,
    });
  if (upload.error) throw upload.error;
  const verification = await admin
    .from("lukas_qto_verified_uploads")
    .insert({
      actor_id: ownerId,
      project_id: projectId,
      kind: input.kind,
      storage_path: storagePath,
      original_filename: input.originalFilename,
      content_type: input.contentType,
      byte_size: input.bytes.byteLength,
      sha256: digest,
    })
    .select("id")
    .single();
  if (verification.error || !verification.data?.id)
    throw verification.error ?? new Error("Verified source setup failed");
  const finalization = await admin.rpc("lukas_qto_finalize_verified_upload", {
    p_verification_id: verification.data.id,
    p_actor_id: ownerId,
    p_project_id: projectId,
  });
  const finalized = finalization.data as {
    byteSize?: number;
    fileId?: string;
    kind?: string;
    sha256?: string;
    storagePath?: string;
  } | null;
  if (
    finalization.error ||
    !finalized?.fileId ||
    finalized.kind !== input.kind ||
    finalized.storagePath !== storagePath ||
    finalized.sha256 !== digest ||
    finalized.byteSize !== input.bytes.byteLength
  )
    throw (
      finalization.error ?? new Error("Verified source finalization failed")
    );
  return { fileId: finalized.fileId, storagePath };
}

export async function createDrawingFixture(options?: {
  p3RunId?: string;
}): Promise<DrawingFixture> {
  const url = required("SUPABASE_URL");
  const anonKey = required("SUPABASE_ANON_KEY");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const runId = options?.p3RunId ?? `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const p3Identities = options?.p3RunId
    ? buildDrawingP3Identities(options.p3RunId)
    : null;
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUsers: TestUser[] = [];
  let createdProjectId: string | null = null;
  let createdOrganizationId: string | null = null;
  let ownerAuth: SupabaseClient | null = null;
  const storagePaths: string[] = [];
  const addUser = async (
    label: keyof ReturnType<typeof buildDrawingP3Identities> | "approver",
  ) => {
    const fixtureLabel = label === "nonMember" ? "nonmember" : label;
    const user = await createUser(
      admin,
      fixtureLabel,
      runId,
      label === "approver" ? undefined : p3Identities?.[label],
    );
    createdUsers.push(user);
    return user;
  };

  try {
    const owner = await addUser("owner");
    const editor = await addUser("editor");
    const reviewer = await addUser("reviewer");
    const approver = await addUser("approver");
    const viewer = await addUser("viewer");
    const nonMember = await addUser("nonMember");

    const { data: link, error: linkError } =
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email: owner.email,
      });
    if (linkError || !link.properties?.hashed_token)
      throw linkError ?? new Error("Could not create owner setup token");
    ownerAuth = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: verifyError } = await ownerAuth.auth.verifyOtp({
      token_hash: link.properties.hashed_token,
      type: "magiclink",
    });
    if (verifyError) throw verifyError;

    const { data: project, error: projectError } = await ownerAuth
      .from("lukas_qto_projects")
      .insert({
        owner_id: owner.id,
        name: `1HK Drawing E2E ${runId}`,
        description: "Disposable editor-reviewer-approver browser verification",
      })
      .select("id,organization_id")
      .single();
    if (projectError || !project)
      throw projectError ?? new Error("Project setup failed");
    createdProjectId = project.id;
    createdOrganizationId = project.organization_id;

    const projectMembers = [
      { user: editor, role: "estimator" },
      { user: reviewer, role: "reviewer" },
      { user: approver, role: "approver" },
      { user: viewer, role: "viewer" },
    ] as const;
    const { error: organizationMemberError } = await admin
      .from("lukas_qto_organization_members")
      .insert(
        projectMembers.map(({ user }) => ({
          organization_id: project.organization_id,
          user_id: user.id,
          role: "member",
          library_access: true,
        })),
      );
    if (organizationMemberError) throw organizationMemberError;
    for (const { user, role } of projectMembers) {
      const { error: memberError } = await ownerAuth.rpc(
        "lukas_qto_set_project_member",
        {
          p_organization_id: project.organization_id,
          p_project_id: project.id,
          p_email: user.email,
          p_role: role,
          p_request_id: randomUUID(),
        },
      );
      if (memberError) throw memberError;
    }

    const pdf = twoPagePdf();
    const ifcResponse = await fetch(IFC_URL);
    if (!ifcResponse.ok)
      throw new Error(`IFC fixture download failed: ${ifcResponse.status}`);
    const ifc = new Uint8Array(await ifcResponse.arrayBuffer());
    if (sha256(ifc).toLowerCase() !== IFC_SHA256)
      throw new Error("Pinned IFC fixture hash changed");
    const finalizedUploads = new Map<string, string>();
    for (const source of [
      {
        label: "pdf",
        bytes: pdf,
        contentType: "application/pdf",
        extension: "pdf",
        kind: "pdf",
        originalFilename: "1HK-test-drawing.pdf",
      },
      {
        label: "ifc",
        bytes: ifc,
        contentType: "application/octet-stream",
        extension: "ifc",
        kind: "ifc",
        originalFilename: "1HK-test-model.ifc",
      },
      {
        label: "revisedPdf",
        bytes: new Uint8Array([...pdf, 0x0a]),
        contentType: "application/pdf",
        extension: "pdf",
        kind: "pdf",
        originalFilename: "1HK-test-drawing-r2.pdf",
      },
      {
        label: "revisedIfc",
        bytes: new Uint8Array([...ifc, 0x0a]),
        contentType: "application/octet-stream",
        extension: "ifc",
        kind: "ifc",
        originalFilename: "1HK-test-model-r2.ifc",
      },
    ] as const) {
      const finalized = await finalizeVerifiedFixtureUpload({
        admin,
        input: source,
        ownerClient: ownerAuth,
        ownerId: owner.id,
        projectId: project.id,
        storagePaths,
      });
      finalizedUploads.set(source.label, finalized.fileId);
    }
    const pdfFileId = finalizedUploads.get("pdf");
    const ifcFileId = finalizedUploads.get("ifc");
    const revisedPdfFileId = finalizedUploads.get("revisedPdf");
    const revisedIfcFileId = finalizedUploads.get("revisedIfc");
    if (!pdfFileId || !ifcFileId || !revisedPdfFileId || !revisedIfcFileId)
      throw new Error("Drawing IDs missing after verified source setup");

    const { data: pdfWorkspaceData, error: pdfWorkspaceError } =
      await ownerAuth.rpc("lukas_drawing_create_document", {
        p_project_id: project.id,
        p_source_file_id: pdfFileId,
        p_title: `1HK PDF workspace ${runId}`,
        p_blank: false,
      });
    if (pdfWorkspaceError) throw pdfWorkspaceError;
    const pdfWorkspace = parseWorkspace(pdfWorkspaceData, pdfFileId);

    const { data: blankWorkspaceData, error: blankWorkspaceError } =
      await ownerAuth.rpc("lukas_drawing_create_document", {
        p_project_id: project.id,
        p_source_file_id: revisedPdfFileId,
        p_title: `1HK blank workspace ${runId}`,
        p_blank: true,
      });
    if (blankWorkspaceError) throw blankWorkspaceError;
    const blankWorkspace = parseWorkspace(blankWorkspaceData, revisedPdfFileId);

    const { data: issue, error: issueError } = await ownerAuth
      .from("lukas_drawing_issues")
      .insert({
        project_id: project.id,
        title: `기존 창호 이슈 ${runId}`,
        description: "도면 객체 연결 E2E용 기존 이슈",
        priority: "normal",
        created_by: owner.id,
      })
      .select("id")
      .single();
    if (issueError || !issue)
      throw issueError ?? new Error("Existing issue setup failed");

    const sourceEvidence = await downloadSourceEvidence(admin, [
      pdfFileId,
      ifcFileId,
      revisedPdfFileId,
      revisedIfcFileId,
    ]);

    return {
      admin,
      retentionClient: ownerAuth,
      owner,
      editor,
      reviewer,
      approver,
      viewer,
      nonMember,
      projectId: project.id,
      organizationId: project.organization_id,
      pdfFileId,
      ifcFileId,
      revisedPdfFileId,
      revisedIfcFileId,
      pdfWorkspace,
      blankWorkspace,
      existingIssueId: issue.id,
      sourceEvidence,
      storagePaths,
    };
  } catch (error) {
    try {
      await cleanupDrawingResources(
        admin,
        ownerAuth,
        createdProjectId,
        createdOrganizationId,
        createdUsers,
      );
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Drawing E2E setup failed and cleanup left possible residue",
      );
    }
    throw error;
  }
}

export async function readSourceEvidence(fixture: DrawingFixture) {
  return downloadSourceEvidence(
    fixture.admin,
    Object.keys(fixture.sourceEvidence),
  );
}

export function buildDrawingPerformanceFixture(
  count: number,
  layerId: string,
  makeId: (index: number) => string = () => randomUUID(),
) {
  if (count !== 10_000)
    throw new Error(
      "The release performance fixture requires exactly 10,000 objects",
    );
  const types = [
    "line",
    "polyline",
    "rectangle",
    "circle",
    "text",
    "dimension",
  ] as const;
  const composition = Object.fromEntries(
    types.map((type) => [type, 0]),
  ) as Record<(typeof types)[number], number>;
  const canvas = { width: 420, height: 297 };
  const selectionTargetWorld = { x: 400, y: 280 };
  const objects = Array.from({ length: count }, (_, index) => {
    const isolated = index === 0;
    const gridIndex = index - 1;
    const type = isolated ? "circle" : types[gridIndex % types.length];
    composition[type] += 1;
    const x = isolated ? selectionTargetWorld.x : 12 + (gridIndex % 100) * 3;
    const y = isolated
      ? selectionTargetWorld.y
      : 12 + Math.floor(gridIndex / 100) * 2;
    const geometry = isolated
      ? { type: "circle" as const, center: { x, y }, radius: 2 }
      : type === "line"
        ? { type, start: { x, y }, end: { x: x + 4, y: y + 2 } }
        : type === "polyline"
          ? {
              type,
              points: [
                { x, y },
                { x: x + 3, y: y + 2 },
                { x: x + 6, y },
              ],
              closed: false,
            }
          : type === "rectangle"
            ? { type, origin: { x, y }, width: 5, height: 3, rotation: 0 }
            : type === "circle"
              ? { type, center: { x, y }, radius: 2 }
              : type === "text"
                ? { type, origin: { x, y }, width: 24, text: `T${index}` }
                : {
                    type,
                    start: { x, y },
                    end: { x: x + 5, y },
                    offset: 2,
                    calibrationId: null,
                  };
    return {
      id: makeId(index),
      name: isolated ? "isolated-selection-target" : `${type}-${index + 1}`,
      layerId,
      geometry,
      style: {
        stroke: "#2563eb",
        strokeWidth: 2,
        fill: type === "rectangle" || type === "circle" ? "#bfdbfe33" : null,
        ...(type === "text" ? { fontSize: 14 } : {}),
      },
      version: 1,
    };
  });
  const target = objects[0];
  return {
    canvas,
    composition,
    count,
    objects,
    selectionTarget: {
      id: target.id,
      name: target.name,
      world: selectionTargetWorld,
      minimumZoom: 0.5,
      tolerancePixels: 6,
    },
  };
}

type DrawingP2FixtureInput = {
  revisionId: string;
  pageId: string;
  canvasId: string;
  layerId: string;
};

function stableDrawingP2FixtureId(
  input: DrawingP2FixtureInput,
  kind: string,
  index: number,
) {
  const digest = createHash("sha256")
    .update(`${input.revisionId}:${kind}:${index}`)
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(
    13,
    16,
  )}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export function buildDrawingP2PerformanceFixture(input: DrawingP2FixtureInput) {
  const pages = Array.from({ length: 3 }, (_, index) => ({
    id:
      index === 0
        ? input.pageId
        : stableDrawingP2FixtureId(input, "page", index),
    revisionId: input.revisionId,
    name: `P2 performance page ${index + 1}`,
    sortOrder: index,
    version: 1,
  }));
  const canvases = Array.from({ length: 20 }, (_, index) => {
    const spaceKind =
      index < pages.length || index % 2 === 0
        ? ("paper" as const)
        : ("model" as const);
    return {
      id:
        index === 0
          ? input.canvasId
          : stableDrawingP2FixtureId(input, "canvas", index),
      pageId: pages[index % pages.length].id,
      name: `P2 ${spaceKind} canvas ${String(index + 1).padStart(2, "0")}`,
      spaceKind,
      widthMillimeters: spaceKind === "paper" ? 420 : 1_000,
      heightMillimeters: spaceKind === "paper" ? 297 : 1_000,
      background: null,
      sortOrder: Math.floor(index / pages.length),
      version: 1,
    };
  });
  const layers = canvases.map((canvas, index) => ({
    id:
      index === 0
        ? input.layerId
        : stableDrawingP2FixtureId(input, "layer", index),
    name: `P2 performance layer ${String(index + 1).padStart(2, "0")}`,
    visible: true,
    locked: false,
    systemKind: index === 0 ? ("work" as const) : ("custom" as const),
    canvasId: canvas.id,
    sortOrder: index === 0 ? 1 : 0,
    version: 1,
  }));
  const styles = Array.from({ length: 20 }, (_, index) => ({
    id: stableDrawingP2FixtureId(input, "style", index),
    revisionId: input.revisionId,
    name: `P2 style ${String(index + 1).padStart(2, "0")}`,
    value: {
      stroke: `#${(0x102030 + index * 0x030303).toString(16).padStart(6, "0")}`,
      strokeWidth: (index % 4) + 1,
      fill: index % 2 === 0 ? "#bfdbfe33" : null,
    },
    version: 1,
  }));
  const objects = Array.from({ length: 10_000 }, (_, index) => {
    const canvasIndex = Math.floor(index / 500);
    const localIndex = index % 500;
    const type = ["line", "rectangle", "circle", "text"][index % 4];
    const x = 10 + (localIndex % 25) * 14;
    const y = 10 + Math.floor(localIndex / 25) * 12;
    const geometry =
      type === "line"
        ? { type, start: { x, y }, end: { x: x + 8, y: y + 4 } }
        : type === "rectangle"
          ? { type, origin: { x, y }, width: 8, height: 5, rotation: 0 }
          : type === "circle"
            ? { type, center: { x, y }, radius: 3 }
            : { type, origin: { x, y }, width: 40, text: `P2-${index}` };
    return {
      id: stableDrawingP2FixtureId(input, "object", index),
      name:
        index === 0
          ? "P2 active selection target"
          : `P2 ${type} ${String(index + 1).padStart(5, "0")}`,
      layerId: layers[canvasIndex].id,
      geometry,
      styleId: styles[index % styles.length].id,
      style: index % 10 === 0 ? { strokeWidth: 6 } : {},
      version: 1,
    };
  });
  const blocks = Array.from({ length: 20 }, (_, index) => ({
    id: stableDrawingP2FixtureId(input, "block", index),
    revisionId: input.revisionId,
    name: `P2 block ${String(index + 1).padStart(2, "0")}`,
    primitives: [
      {
        localId: "circle",
        name: "Block circle",
        geometry: {
          type: "circle" as const,
          center: { x: 0, y: 0 },
          radius: 3,
        },
        styleId: styles[index].id,
        style: {},
      },
    ],
    version: 1,
  }));
  const blockInstances = Array.from({ length: 1_000 }, (_, index) => {
    const canvasIndex = Math.floor(index / 50);
    const id = stableDrawingP2FixtureId(input, "instance", index);
    return {
      id,
      lineageId: id,
      blockId: blocks[index % blocks.length].id,
      layerId: layers[canvasIndex].id,
      name:
        index === 0
          ? "P2 active block instance"
          : `P2 instance ${String(index + 1).padStart(4, "0")}`,
      origin: { x: 20 + (index % 10) * 20, y: 20 + (index % 5) * 20 },
      rotation: (index % 12) * 30,
      scaleX: 1,
      scaleY: 1,
      version: 1,
    };
  });
  const valueTypes = ["text", "number", "boolean", "date", "enum"] as const;
  const propertySchemas = Array.from({ length: 20 }, (_, index) => ({
    id: stableDrawingP2FixtureId(input, "property-schema", index),
    revisionId: input.revisionId,
    name: `P2 property ${String(index + 1).padStart(2, "0")}`,
    valueType: valueTypes[index % valueTypes.length],
    enumOptions:
      valueTypes[index % valueTypes.length] === "enum" ? ["A", "B"] : [],
    appliesTo: ["line", "rectangle", "circle", "text"],
    required: index < 5,
    version: 1,
  }));
  const propertyValues = propertySchemas.map((schema, index) => ({
    id: stableDrawingP2FixtureId(input, "property-value", index),
    schemaId: schema.id,
    objectId: objects[index].id,
    blockInstanceId: null,
    value:
      schema.valueType === "text"
        ? `P2 value ${index + 1}`
        : schema.valueType === "number"
          ? index + 0.5
          : schema.valueType === "boolean"
            ? index % 2 === 0
            : schema.valueType === "date"
              ? `2026-09-${String((index % 20) + 1).padStart(2, "0")}`
              : index % 2 === 0
                ? "A"
                : "B",
    version: 1,
  }));
  const tables = Array.from({ length: 5 }, (_, tableIndex) => {
    const columns = [
      {
        id: stableDrawingP2FixtureId(input, `table-${tableIndex}-column`, 0),
        name: "Object",
        kind: "object_name",
        propertySchemaId: null,
      },
      {
        id: stableDrawingP2FixtureId(input, `table-${tableIndex}-column`, 1),
        name: "Property",
        kind: "property",
        propertySchemaId: propertySchemas[tableIndex].id,
      },
      {
        id: stableDrawingP2FixtureId(input, `table-${tableIndex}-column`, 2),
        name: "Manual note",
        kind: "text",
        propertySchemaId: null,
      },
      {
        id: stableDrawingP2FixtureId(input, `table-${tableIndex}-column`, 3),
        name: "Manual number",
        kind: "number",
        propertySchemaId: null,
      },
    ];
    return {
      id: stableDrawingP2FixtureId(input, "table", tableIndex),
      revisionId: input.revisionId,
      name: `P2 schedule ${tableIndex + 1}`,
      columns,
      rows: Array.from({ length: 20 }, (_, rowIndex) => ({
        id: stableDrawingP2FixtureId(
          input,
          `table-${tableIndex}-row`,
          rowIndex,
        ),
        objectId: objects[tableIndex * 20 + rowIndex].id,
        blockInstanceId: null,
        cells: {
          [columns[2].id]: `manual-${tableIndex}-${rowIndex}`,
          [columns[3].id]: tableIndex * 20 + rowIndex + 0.25,
        },
      })),
      version: 1,
    };
  });
  return {
    activeCanvasId: input.canvasId,
    activeLayerId: input.layerId,
    pages,
    canvases,
    layers,
    objects,
    blocks,
    blockInstances,
    styles,
    propertySchemas,
    propertyValues,
    tables,
    counts: {
      pages: pages.length,
      canvases: canvases.length,
      layers: layers.length,
      objects: objects.length,
      blocks: blocks.length,
      blockInstances: blockInstances.length,
      styles: styles.length,
      propertySchemas: propertySchemas.length,
      propertyValues: propertyValues.length,
      tables: tables.length,
    },
  };
}

type DrawingP2PerformanceSeedOperation = {
  operationType: "add_objects" | "mutate_structure";
  baseVersions: Record<string, number>;
  forward: { type: string; [key: string]: unknown };
  inverse: { type: string; [key: string]: unknown };
};

const DRAWING_PERFORMANCE_OBJECT_BATCH_SIZE = 100;

export function buildDrawingPerformanceObjectSeedOperations<
  Object extends { id: string },
>(objects: Object[]): DrawingP2PerformanceSeedOperation[] {
  const operations: DrawingP2PerformanceSeedOperation[] = [];
  for (
    let offset = 0;
    offset < objects.length;
    offset += DRAWING_PERFORMANCE_OBJECT_BATCH_SIZE
  ) {
    const batch = objects.slice(
      offset,
      offset + DRAWING_PERFORMANCE_OBJECT_BATCH_SIZE,
    );
    operations.push({
      operationType: "add_objects",
      baseVersions: {},
      forward: { type: "add_objects", objects: batch },
      inverse: {
        type: "delete_objects",
        objectIds: batch.map(({ id }) => id),
      },
    });
  }
  return operations;
}

export function buildDrawingP2PerformanceSeedPlan(
  input: DrawingP2FixtureInput,
) {
  const performanceFixture = buildDrawingP2PerformanceFixture({
    revisionId: input.revisionId,
    pageId: input.pageId,
    canvasId: input.canvasId,
    layerId: input.layerId,
  });
  const initialActions = [
    ...performanceFixture.pages.slice(1).map((entity) => ({
      kind: "put_page" as const,
      entity,
      baseVersion: null,
    })),
    ...performanceFixture.canvases.slice(1).map((entity) => ({
      kind: "put_canvas" as const,
      entity,
      baseVersion: null,
    })),
    ...performanceFixture.layers.slice(1).map((entity) => ({
      kind: "put_layer" as const,
      entity,
      baseVersion: null,
    })),
    ...performanceFixture.styles.map((entity) => ({
      kind: "put_style" as const,
      entity,
      baseVersion: null,
    })),
    ...performanceFixture.blocks.map((entity) => ({
      kind: "put_block" as const,
      entity,
      baseVersion: null,
    })),
    ...performanceFixture.propertySchemas.map((entity) => ({
      kind: "put_property_schema" as const,
      entity,
      baseVersion: null,
    })),
  ];
  const initialInverse = [
    ...performanceFixture.propertySchemas
      .slice()
      .reverse()
      .map(({ id }) => ({
        kind: "delete_property_schema" as const,
        id,
        baseVersion: 1,
      })),
    ...performanceFixture.blocks
      .slice()
      .reverse()
      .map(({ id }) => ({ kind: "delete_block" as const, id, baseVersion: 1 })),
    ...performanceFixture.styles
      .slice()
      .reverse()
      .map(({ id }) => ({ kind: "delete_style" as const, id, baseVersion: 1 })),
    ...performanceFixture.layers
      .slice(1)
      .slice()
      .reverse()
      .map(({ id }) => ({ kind: "delete_layer" as const, id, baseVersion: 1 })),
    ...performanceFixture.canvases
      .slice(1)
      .slice()
      .reverse()
      .map(({ id }) => ({
        kind: "delete_canvas" as const,
        id,
        baseVersion: 1,
      })),
    ...performanceFixture.pages
      .slice(1)
      .slice()
      .reverse()
      .map(({ id }) => ({ kind: "delete_page" as const, id, baseVersion: 1 })),
  ];
  const operations: DrawingP2PerformanceSeedOperation[] = [
    {
      operationType: "mutate_structure",
      baseVersions: {},
      forward: { type: "mutate_structure", actions: initialActions },
      inverse: { type: "mutate_structure", actions: initialInverse },
    },
  ];

  operations.push(
    ...buildDrawingPerformanceObjectSeedOperations(performanceFixture.objects),
  );

  for (
    let offset = 0;
    offset < performanceFixture.blockInstances.length;
    offset += 100
  ) {
    const instances = performanceFixture.blockInstances.slice(
      offset,
      offset + 100,
    );
    operations.push({
      operationType: "mutate_structure",
      baseVersions: {},
      forward: {
        type: "mutate_structure",
        actions: instances.map((entity) => ({
          kind: "put_block_instance",
          entity,
          baseVersion: null,
        })),
      },
      inverse: {
        type: "mutate_structure",
        actions: instances
          .slice()
          .reverse()
          .map(({ id }) => ({
            kind: "delete_block_instance",
            id,
            baseVersion: 1,
          })),
      },
    });
  }
  operations.push({
    operationType: "mutate_structure",
    baseVersions: {},
    forward: {
      type: "mutate_structure",
      actions: [
        ...performanceFixture.propertyValues.map((entity) => ({
          kind: "put_property_value",
          entity,
          baseVersion: null,
        })),
        ...performanceFixture.tables.map((entity) => ({
          kind: "put_table",
          entity,
          baseVersion: null,
        })),
      ],
    },
    inverse: {
      type: "mutate_structure",
      actions: [
        ...performanceFixture.tables
          .slice()
          .reverse()
          .map(({ id }) => ({ kind: "delete_table", id, baseVersion: 1 })),
        ...performanceFixture.propertyValues
          .slice()
          .reverse()
          .map(({ id }) => ({
            kind: "delete_property_value",
            id,
            baseVersion: 1,
          })),
      ],
    },
  });

  return { performanceFixture, operations };
}

export async function seedDrawingP2PerformanceFixture(fixture: DrawingFixture) {
  const owner = await authenticateApiClient(fixture, fixture.owner);
  const plan = buildDrawingP2PerformanceSeedPlan({
    revisionId: fixture.blankWorkspace.revisionId,
    pageId: fixture.blankWorkspace.pageId,
    canvasId: fixture.blankWorkspace.canvasId,
    layerId: fixture.blankWorkspace.workLayerId,
  });
  for (const operation of plan.operations) {
    const { error } = await owner.rpc("lukas_drawing_apply_operation", {
      p_revision_id: fixture.blankWorkspace.revisionId,
      p_client_operation_id: randomUUID(),
      p_operation_type: operation.operationType,
      p_base_versions: operation.baseVersions,
      p_forward: operation.forward,
      p_inverse: operation.inverse,
    });
    if (error) throw error;
  }
  return plan.performanceFixture;
}

export async function seedDrawingPerformanceObjects(
  fixture: DrawingFixture,
  count = 10_000,
) {
  const owner = await authenticateApiClient(fixture, fixture.owner);
  const performanceFixture = buildDrawingPerformanceFixture(
    count,
    fixture.blankWorkspace.workLayerId,
  );
  for (const operation of buildDrawingPerformanceObjectSeedOperations(
    performanceFixture.objects,
  )) {
    const { error } = await owner.rpc("lukas_drawing_apply_operation", {
      p_revision_id: fixture.blankWorkspace.revisionId,
      p_client_operation_id: randomUUID(),
      p_operation_type: operation.operationType,
      p_base_versions: operation.baseVersions,
      p_forward: operation.forward,
      p_inverse: operation.inverse,
    });
    if (error) throw error;
  }
  return performanceFixture;
}

export async function authenticateContext(
  fixture: DrawingFixture,
  context: BrowserContext,
  user: TestUser,
  baseUrl: string,
  next: string,
) {
  const { data, error } = await fixture.admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  const token = data.properties?.hashed_token;
  if (error || !token)
    throw error ?? new Error("Could not create browser login token");
  const page = await context.newPage();
  const requestedUrl = new URL(next, baseUrl);
  await page.goto(
    `${baseUrl}/auth/confirm?token_hash=${encodeURIComponent(token)}&type=magiclink&next=${encodeURIComponent(next)}`,
  );
  await page.waitForURL(
    (url) =>
      url.pathname === requestedUrl.pathname &&
      url.search === requestedUrl.search,
  );
  return page;
}

export async function authenticateApiClient(
  fixture: DrawingFixture,
  user: TestUser,
) {
  const { data, error } = await fixture.admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  const token = data.properties?.hashed_token;
  if (error || !token)
    throw error ?? new Error("Could not create API login token");
  const client = createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_ANON_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
  const { error: verifyError } = await client.auth.verifyOtp({
    token_hash: token,
    type: "magiclink",
  });
  if (verifyError) throw verifyError;
  return client;
}

export async function destroyDrawingFixture(
  fixture: DrawingFixture | undefined,
) {
  if (!fixture) return;
  await cleanupDrawingResources(
    fixture.admin,
    fixture.retentionClient,
    fixture.projectId,
    fixture.organizationId,
    [
      fixture.owner,
      fixture.editor,
      fixture.reviewer,
      fixture.approver,
      fixture.viewer,
      fixture.nonMember,
    ].filter((user): user is TestUser => Boolean(user)),
  );
}

export async function destroyDrawingP3Fixture(
  fixture: DrawingFixture | undefined,
  databaseAdminUrl: string,
  removeRooms: (
    fixture: DrawingFixture,
    databaseAdminUrl: string,
  ) => Promise<void> = async (fixture, databaseAdminUrl) => {
    const sql = postgres(databaseAdminUrl, { max: 1, prepare: false });
    const errors: unknown[] = [];
    try {
      await sql.begin(async (transaction) => {
        await transaction`
          delete from private.lukas_drawing_collaboration_freeze_leases
          where project_id = ${fixture.projectId}::uuid
        `;
        await transaction`
          delete from private.lukas_drawing_collaboration_states
          where project_id = ${fixture.projectId}::uuid
        `;
      });
    } catch (error) {
      errors.push(error);
    } finally {
      try {
        await sql.end({ timeout: 5 });
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Drawing P3 room cleanup failed");
  },
) {
  if (!fixture) return;
  const errors: unknown[] = [];
  try {
    await removeRooms(fixture, databaseAdminUrl);
  } catch (error) {
    if (error instanceof AggregateError) errors.push(...error.errors);
    else errors.push(error);
  }
  try {
    await destroyDrawingFixture(fixture);
  } catch (error) {
    if (error instanceof AggregateError) errors.push(...error.errors);
    else errors.push(error);
  }
  if (errors.length)
    throw new AggregateError(
      errors,
      "Drawing P3 E2E cleanup left possible room or fixture residue",
    );
}
