import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PDFDocument, rgb } from "pdf-lib";

import type { ManagedIfcDerivativeReadyWriter } from "../../app/lukas/lib/drawing-workspace.server.ts";

import {
  authenticateApiClient,
  createDrawingFixture,
  finalizeVerifiedFixtureUpload,
  type DrawingFixture,
} from "./drawing-collaboration-fixture.ts";

export const RATE_BOOK_CSV = [
  "resource_code,resource_type,resource_name,specification,unit,unit_price_krw",
  "W-001,material,경량벽체,,m,10000",
  "F-001,material,바닥마감,,m2,30000",
  "D-001,material,문 세트,,EA,150000",
].join("\n");
export const RATE_BOOK_SHA256 =
  "7592f8466e82cd829e29bb0258ecbc339fe0bda2dd34527178e5ef097096051c";
export const MIXED_INVALID_RATE_BOOK_CSV = [
  "resource_code,resource_type,resource_name,specification,unit,unit_price_krw",
  "OK-001,material,정상 자원,,EA,12345",
  "BAD-NEG,material,음수 단가 자원,,EA,-1",
  "BAD-UNIT,material,잘못된 단위 자원,,BOX,1",
].join("\n");
export const MIXED_INVALID_RATE_BOOK_SHA256 =
  "1b8b859c5dcb084ba1280bba0fbe13fd5c9cea8d68d397e9e7ac29fa1e3a98c0";

// Hand-authored, redistributable ASCII DXF fixture. It contains no customer
// drawing data and deliberately exercises declared mm, bounded BLOCK/INSERT
// flattening, raw layer 0 lineage, lowercase handles, and case-insensitive
// entity-to-table layer resolution.
export const M4_DXF_ASCII = [
  "0",
  "SECTION",
  "2",
  "HEADER",
  "9",
  "$ACADVER",
  "1",
  "AC1015",
  "9",
  "$INSUNITS",
  "70",
  "4",
  "0",
  "ENDSEC",
  "0",
  "SECTION",
  "2",
  "TABLES",
  "0",
  "TABLE",
  "2",
  "LAYER",
  "70",
  "1",
  "0",
  "LAYER",
  "2",
  "A-WALL",
  "70",
  "0",
  "62",
  "7",
  "6",
  "CONTINUOUS",
  "0",
  "ENDTAB",
  "0",
  "ENDSEC",
  "0",
  "SECTION",
  "2",
  "BLOCKS",
  "0",
  "BLOCK",
  "8",
  "0",
  "2",
  "UNIT-LINE",
  "3",
  "UNIT-LINE",
  "70",
  "0",
  "10",
  "0",
  "20",
  "0",
  "30",
  "0",
  "0",
  "LINE",
  "5",
  "b10c",
  "8",
  "0",
  "10",
  "0",
  "20",
  "0",
  "30",
  "0",
  "11",
  "300",
  "21",
  "0",
  "31",
  "0",
  "0",
  "ENDBLK",
  "0",
  "ENDSEC",
  "0",
  "SECTION",
  "2",
  "ENTITIES",
  "0",
  "INSERT",
  "5",
  "ab12",
  "8",
  "a-wall",
  "2",
  "UNIT-LINE",
  "10",
  "120",
  "20",
  "100",
  "30",
  "0",
  "41",
  "1",
  "42",
  "1",
  "43",
  "1",
  "50",
  "0",
  "0",
  "ENDSEC",
  "0",
  "EOF",
  "",
].join("\n");
export const M4_DXF_SHA256 =
  "56d1004aa7f35fdab257cf294614332453a1fd9c7ba8876f74b58bc2a972a261";

const RVT_SENTINEL = Buffer.from(
  "1HK-M1-RVT-IMMUTABILITY-SENTINEL-v1\n",
  "utf8",
);

type Evidence = {
  metadataSha256: string;
  storageByteSha256: string;
  byteLength: number;
};

export type DrawingEstimatorFixture = DrawingFixture & {
  emptyProjectId: string;
  dxfFileId: string;
  dxfEvidence: Evidence;
  workspaceAttachPdfFileId: string;
  workspaceStartPdfFileId: string;
  mixedInvalidRateBookFileId: string;
  mixedInvalidRateBookEvidence: Evidence;
  rateBookFileId: string;
  rateBookEvidence: Evidence;
  rvtImmutabilitySentinelFileId: string;
  rvtImmutabilitySentinelEvidence: Evidence;
  rvtImmutabilitySentinelParseable: false;
};

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const M4_IFC_FIXTURE_CONVERTER_SHA256 = createHash("sha256")
  .update("1HK-M4-IFC-DERIVATIVE-FIXTURE-v1", "utf8")
  .digest("hex");

function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((child) => canonicalJson(child)).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Invalid canonical JSON value");
  return serialized;
}

export async function seedDrawingIfcDerivativeFixture(
  fixture: DrawingEstimatorFixture,
) {
  const template = JSON.parse(
    await readFile(
      new URL(
        "../../public/examples/synthetic-ifc-mapping.manifest.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    source: { fileId: string; sha256: string };
    elements: Array<{
      expressId: number;
      globalId: string;
      name: string | null;
    }>;
  };
  const sourceSha256 =
    fixture.sourceEvidence[fixture.ifcFileId]?.metadataSha256;
  if (!sourceSha256) throw new Error("M4 IFC source evidence is unavailable");
  const manifest = {
    ...template,
    source: { fileId: fixture.ifcFileId, sha256: sourceSha256 },
  };
  const target = manifest.elements.find(
    (element) => element.globalId === "0VNYAWfXv8JvIRVfOzYH1j",
  );
  if (!target?.name) throw new Error("M4 IFC focus target is unavailable");
  const manifestBytes = Buffer.from(canonicalJson(manifest), "utf8");
  const geometryBytes = new Uint8Array(
    await readFile(
      new URL(
        "../../public/examples/synthetic-ifc-mapping.glb",
        import.meta.url,
      ),
    ),
  );
  const workspaceServer = await import(
    "../../app/lukas/lib/drawing-workspace.server.ts"
  );
  let lease:
    | { job_id: string; lease_token: string; source_file_id: string }
    | undefined;
  for (let attempt = 0; attempt < 16 && !lease; attempt += 1) {
    const claimed = await fixture.admin.rpc(
      "lukas_drawing_claim_ifc_derivative_job_for_converter",
      {
        p_converter_sha256: M4_IFC_FIXTURE_CONVERTER_SHA256,
        p_lease_seconds: 900,
      },
    );
    const candidate = Array.isArray(claimed.data) ? claimed.data[0] : null;
    if (
      claimed.error ||
      !candidate ||
      typeof candidate.job_id !== "string" ||
      typeof candidate.lease_token !== "string" ||
      typeof candidate.source_file_id !== "string" ||
      !Number.isSafeInteger(candidate.derivative_version)
    )
      throw new Error("M4 IFC derivative lease is unavailable");
    if (candidate.source_file_id === fixture.ifcFileId) {
      lease = candidate;
      break;
    }
    const deferred = await fixture.admin.rpc(
      "lukas_drawing_fail_ifc_derivative_job",
      {
        p_job_id: candidate.job_id,
        p_lease_token: candidate.lease_token,
        p_derivative_version: candidate.derivative_version,
        p_retryable: true,
        p_error_code: "fixture_deferred",
        p_error_message: "Disposable fixture deferred another IFC source.",
      },
    );
    if (deferred.error)
      throw new Error("M4 IFC derivative fixture deferral failed");
  }
  if (!lease) throw new Error("M4 IFC derivative lease is unavailable");
  const activeLease = lease;
  const writer: ManagedIfcDerivativeReadyWriter = {
    async recordReady(input) {
      const published = await fixture.admin.rpc(
        "lukas_drawing_publish_leased_ifc_derivative_ready",
        {
          p_job_id: activeLease.job_id,
          p_lease_token: activeLease.lease_token,
          p_project_id: input.projectId,
          p_source_file_id: input.sourceFileId,
          p_source_sha256: input.sourceSha256,
          p_version: input.version,
          p_manifest_json: input.manifestJson,
          p_manifest_storage_path: input.manifestStoragePath,
          p_manifest_byte_size: input.manifestByteSize,
          p_manifest_sha256: input.manifestSha256,
          p_geometry_storage_path: input.geometryStoragePath,
          p_geometry_byte_size: input.geometryByteSize,
          p_geometry_sha256: input.geometrySha256,
          p_created_by: input.createdBy,
        },
      );
      if (published.error || typeof published.data !== "string")
        throw new Error("M4 IFC derivative leased publication failed");
      return { id: published.data };
    },
  };
  const published = await workspaceServer.publishManagedIfcDerivativeReady(
    fixture.admin.storage,
    writer,
    {
      projectId: fixture.projectId,
      sourceFileId: fixture.ifcFileId,
      sourceSha256,
      version: 1,
      createdBy: fixture.owner.id,
      manifestBytes,
      geometryBytes,
    },
  );
  return {
    derivativeId: published.id,
    expressId: target.expressId,
    geometrySha256: published.geometry.sha256,
    globalId: target.globalId,
    manifestSha256: published.manifest.sha256,
    name: target.name,
  };
}

async function assertNoProjectSources(
  fixture: DrawingFixture,
  projectId: string,
) {
  const [files, documents] = await Promise.all([
    fixture.admin
      .from("lukas_qto_files")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
    fixture.admin
      .from("lukas_drawing_documents")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
  ]);
  if (files.error || documents.error)
    throw (
      files.error ?? documents.error ?? new Error("Empty project check failed")
    );
  if (files.count !== 0 || documents.count !== 0)
    throw new Error("M1 empty project was not source and document empty");
}

async function ensureOrganizationPrerequisites(fixture: DrawingFixture) {
  const users = [
    fixture.editor,
    fixture.reviewer,
    fixture.approver,
    fixture.viewer,
  ];
  const existing = await fixture.admin
    .from("lukas_qto_organization_members")
    .select("user_id")
    .eq("organization_id", fixture.organizationId)
    .in(
      "user_id",
      users.map((user) => user.id),
    );
  if (existing.error) throw existing.error;
  const known = new Set((existing.data ?? []).map((row) => row.user_id));
  const missing = users.filter((user) => !known.has(user.id));
  if (!missing.length) return;
  const inserted = await fixture.admin
    .from("lukas_qto_organization_members")
    .insert(
      missing.map((user) => ({
        organization_id: fixture.organizationId,
        user_id: user.id,
        role: "member",
        library_access: true,
      })),
    );
  if (inserted.error) throw inserted.error;
}

async function setProjectRole(
  fixture: DrawingFixture,
  projectId: string,
  email: string,
  role: "estimator" | "reviewer" | "approver" | "viewer",
) {
  const result = await fixture.retentionClient.rpc(
    "lukas_qto_set_project_member",
    {
      p_organization_id: fixture.organizationId,
      p_project_id: projectId,
      p_email: email,
      p_role: role,
      p_request_id: randomUUID(),
    },
  );
  if (result.error) throw result.error;
}

async function uploadImmutableEvidence(
  fixture: DrawingFixture,
  input: {
    bytes: Uint8Array;
    contentType: string;
    filename: string;
    kind: "pdf" | "dxf" | "estimate" | "other";
  },
) {
  const extension = input.filename.split(".").pop();
  if (!extension) throw new Error("M1 fixture source extension is missing");
  const digest = sha256(input.bytes);
  const file = await finalizeVerifiedFixtureUpload({
    admin: fixture.admin,
    input: {
      ...input,
      extension,
      originalFilename: input.filename,
    },
    ownerClient: fixture.retentionClient,
    ownerId: fixture.owner.id,
    projectId: fixture.projectId,
    storagePaths: fixture.storagePaths,
  });
  const evidence = {
    metadataSha256: digest,
    storageByteSha256: digest,
    byteLength: input.bytes.byteLength,
  };
  fixture.sourceEvidence[file.fileId] = evidence;
  return { evidence, fileId: file.fileId };
}

export async function createDrawingEstimatorFixture(): Promise<DrawingEstimatorFixture> {
  if (process.env.M1_E2E_DISPOSABLE !== "1")
    throw new Error("M1 estimator fixture requires the disposable runner");
  const fixture = await createDrawingFixture();
  await ensureOrganizationPrerequisites(fixture);
  const emptyProject = await fixture.retentionClient
    .from("lukas_qto_projects")
    .insert({
      owner_id: fixture.owner.id,
      organization_id: fixture.organizationId,
      name: `1HK M1 empty ${randomUUID().slice(0, 8)}`,
      description: "Disposable source-free M1 acceptance project",
    })
    .select("id,organization_id")
    .single();
  if (emptyProject.error || !emptyProject.data)
    throw emptyProject.error ?? new Error("M1 empty project creation failed");
  if (emptyProject.data.organization_id !== fixture.organizationId)
    throw new Error("M1 empty project escaped the fixture organization");

  await setProjectRole(
    fixture,
    fixture.projectId,
    fixture.approver.email,
    "approver",
  );
  for (const [user, role] of [
    [fixture.editor, "estimator"],
    [fixture.reviewer, "reviewer"],
    [fixture.approver, "approver"],
    [fixture.viewer, "viewer"],
  ] as const)
    await setProjectRole(fixture, emptyProject.data.id, user.email, role);

  const originalReviewer = await fixture.admin
    .from("lukas_qto_project_members")
    .select("role")
    .eq("project_id", fixture.projectId)
    .eq("user_id", fixture.reviewer.id)
    .single();
  const originalApprover = await fixture.admin
    .from("lukas_qto_project_members")
    .select("role")
    .eq("project_id", fixture.projectId)
    .eq("user_id", fixture.approver.id)
    .single();
  if (
    originalReviewer.error ||
    originalApprover.error ||
    originalReviewer.data.role !== "reviewer" ||
    originalApprover.data.role !== "approver"
  )
    throw new Error("M1 project role normalization failed");
  const emptyRoles = await fixture.admin
    .from("lukas_qto_project_members")
    .select("user_id,role")
    .eq("project_id", emptyProject.data.id);
  if (emptyRoles.error) throw emptyRoles.error;
  const expectedRoles = new Map([
    [fixture.editor.id, "estimator"],
    [fixture.reviewer.id, "reviewer"],
    [fixture.approver.id, "approver"],
    [fixture.viewer.id, "viewer"],
  ]);
  for (const [userId, role] of expectedRoles)
    if (
      !emptyRoles.data?.some(
        (row) => row.user_id === userId && row.role === role,
      )
    )
      throw new Error("M1 empty-project role normalization failed");
  await assertNoProjectSources(fixture, emptyProject.data.id);

  const originalPdf = await fixture.admin
    .from("lukas_qto_files")
    .select("storage_path")
    .eq("id", fixture.pdfFileId)
    .single();
  if (originalPdf.error || !originalPdf.data)
    throw originalPdf.error ?? new Error("M1 source PDF is unavailable");
  const downloadedPdf = await fixture.admin.storage
    .from("lukas-qto")
    .download(originalPdf.data.storage_path);
  if (downloadedPdf.error || !downloadedPdf.data)
    throw (
      downloadedPdf.error ?? new Error("M1 source PDF bytes are unavailable")
    );
  const sourcePdfBytes = new Uint8Array(await downloadedPdf.data.arrayBuffer());
  const changedPdfDocument = await PDFDocument.load(sourcePdfBytes);
  changedPdfDocument.getPage(0).drawRectangle({
    x: 72,
    y: 72,
    width: 144,
    height: 96,
    color: rgb(0.9, 0.05, 0.05),
  });
  const changedPdfBytes = new Uint8Array(await changedPdfDocument.save());
  const workspaceStartPdf = await uploadImmutableEvidence(fixture, {
    bytes: new Uint8Array([...sourcePdfBytes, 0x0a, 0x0a]),
    contentType: "application/pdf",
    filename: "1HK-m1-new-background.pdf",
    kind: "pdf",
  });
  const workspaceAttachPdf = await uploadImmutableEvidence(fixture, {
    bytes: changedPdfBytes,
    contentType: "application/pdf",
    filename: "1HK-m2-attach-background.pdf",
    kind: "pdf",
  });
  const dxfBytes = Buffer.from(M4_DXF_ASCII, "ascii");
  if (sha256(dxfBytes) !== M4_DXF_SHA256)
    throw new Error("M4 canonical DXF fixture digest changed");
  const dxf = await uploadImmutableEvidence(fixture, {
    bytes: dxfBytes,
    contentType: "application/dxf",
    filename: "1HK-m4-canonical-line.dxf",
    kind: "dxf",
  });

  const rateBook = await uploadImmutableEvidence(fixture, {
    bytes: Buffer.from(RATE_BOOK_CSV, "utf8"),
    contentType: "text/csv",
    filename: "1hk-m1-company-rates.csv",
    kind: "estimate",
  });
  if (rateBook.evidence.metadataSha256 !== RATE_BOOK_SHA256)
    throw new Error("M1 rate-book fixture digest changed");
  const mixedInvalidRateBook = await uploadImmutableEvidence(fixture, {
    bytes: Buffer.from(MIXED_INVALID_RATE_BOOK_CSV, "utf8"),
    contentType: "text/csv",
    filename: "1hk-m1-company-rates-mixed-invalid.csv",
    kind: "estimate",
  });
  if (
    mixedInvalidRateBook.evidence.metadataSha256 !==
    MIXED_INVALID_RATE_BOOK_SHA256
  )
    throw new Error("M1 mixed-invalid rate-book fixture digest changed");
  const rvtSentinel = await uploadImmutableEvidence(fixture, {
    bytes: RVT_SENTINEL,
    contentType: "application/octet-stream",
    filename: "source-integrity-only.rvt",
    kind: "other",
  });
  return {
    ...fixture,
    emptyProjectId: emptyProject.data.id,
    dxfFileId: dxf.fileId,
    dxfEvidence: dxf.evidence,
    workspaceAttachPdfFileId: workspaceAttachPdf.fileId,
    workspaceStartPdfFileId: workspaceStartPdf.fileId,
    mixedInvalidRateBookFileId: mixedInvalidRateBook.fileId,
    mixedInvalidRateBookEvidence: mixedInvalidRateBook.evidence,
    rateBookFileId: rateBook.fileId,
    rateBookEvidence: rateBook.evidence,
    rvtImmutabilitySentinelFileId: rvtSentinel.fileId,
    rvtImmutabilitySentinelEvidence: rvtSentinel.evidence,
    rvtImmutabilitySentinelParseable: false,
  };
}

export async function seedEstimatorBoqStructure(
  fixture: DrawingEstimatorFixture,
  versionId: string,
) {
  const version = await fixture.admin
    .from("lukas_qto_boq_versions")
    .select("id,project_id,price_book_id,created_by,status")
    .eq("id", versionId)
    .eq("project_id", fixture.projectId)
    .eq("status", "draft")
    .single();
  if (version.error || !version.data?.price_book_id)
    throw version.error ?? new Error("M1 UI-created draft BOQ was not found");
  if (version.data.created_by !== fixture.editor.id)
    throw new Error("M1 UI-created draft BOQ has an unexpected maker");
  const estimator = await authenticateApiClient(fixture, fixture.editor);
  const resources = await fixture.admin
    .from("lukas_qto_price_resources")
    .select(
      "id,resource_code,resource_name,resource_type,unit,unit_price_krw,price_book_id",
    )
    .eq("project_id", fixture.projectId)
    .eq("price_book_id", version.data.price_book_id)
    .in("resource_code", ["W-001", "F-001", "D-001"]);
  if (resources.error) throw resources.error;
  const expected = new Map([
    ["W-001", { name: "경량벽체", unit: "m", price: "10000" }],
    ["F-001", { name: "바닥마감", unit: "m2", price: "30000" }],
    ["D-001", { name: "문 세트", unit: "EA", price: "150000" }],
  ]);
  if (resources.data?.length !== expected.size)
    throw new Error(
      "M1 browser rate import did not create exactly three resources",
    );
  for (const resource of resources.data) {
    const wanted = expected.get(resource.resource_code);
    if (
      !wanted ||
      resource.resource_type !== "material" ||
      resource.resource_name !== wanted.name ||
      resource.unit !== wanted.unit ||
      String(resource.unit_price_krw) !== wanted.price
    )
      throw new Error("M1 browser rate import changed approved resource bytes");
  }
  const sectionId = randomUUID();
  const section = await estimator.from("lukas_qto_boq_sections").insert({
    id: sectionId,
    project_id: fixture.projectId,
    version_id: versionId,
    parent_id: null,
    code: "M1",
    name: "M1 적산",
    sort_order: 0,
    created_by: version.data.created_by,
  });
  if (section.error) throw section.error;
  const lines = ["W-001", "F-001", "D-001", "M1-C-001"].map(
    (code, sortOrder) => ({
      id: randomUUID(),
      project_id: fixture.projectId,
      version_id: versionId,
      section_id: sectionId,
      item_code: code,
      item_name:
        code === "M1-C-001" ? "M1 임시 천장" : expected.get(code)!.name,
      specification: "",
      unit: code === "M1-C-001" ? "m" : expected.get(code)!.unit,
      signed_adjustment: 0,
      adjustment_reason: "",
      sort_order: sortOrder,
      created_by: version.data.created_by,
    }),
  );
  const lineInsert = await estimator.from("lukas_qto_boq_lines").insert(lines);
  if (lineInsert.error) throw lineInsert.error;
  const resourceByCode = new Map(
    resources.data.map((resource) => [resource.resource_code, resource]),
  );
  const components = lines
    .filter((line) => line.item_code !== "M1-C-001")
    .map((line) => ({
      id: randomUUID(),
      project_id: fixture.projectId,
      version_id: versionId,
      line_id: line.id,
      resource_id: resourceByCode.get(line.item_code)!.id,
      coefficient: 1,
      created_by: version.data.created_by,
    }));
  const componentInsert = await estimator
    .from("lukas_qto_boq_rate_components")
    .insert(components);
  if (componentInsert.error) throw componentInsert.error;
  return {
    componentIdsByCode: Object.fromEntries(
      components.map((component, index) => [
        lines[index].item_code,
        component.id,
      ]),
    ),
    lineIdsByCode: Object.fromEntries(
      lines.map((line) => [line.item_code, line.id]),
    ),
    negativeLineId: lines.find((line) => line.item_code === "M1-C-001")!.id,
    priceBookId: version.data.price_book_id,
    resourceIdsByCode: Object.fromEntries(
      resources.data.map((resource) => [resource.resource_code, resource.id]),
    ),
    sectionId,
  };
}

export async function removeEstimatorNegativeLine(
  fixture: DrawingEstimatorFixture,
  input: { lineId: string; versionId: string },
) {
  const { lineId, versionId } = input;
  const version = await fixture.admin
    .from("lukas_qto_boq_versions")
    .select("id")
    .eq("id", versionId)
    .eq("project_id", fixture.projectId)
    .eq("created_by", fixture.editor.id)
    .eq("status", "draft")
    .single();
  if (version.error) throw version.error;
  const estimator = await authenticateApiClient(fixture, fixture.editor);
  const line = await fixture.admin
    .from("lukas_qto_boq_lines")
    .select("id,item_code,project_id,version_id")
    .eq("id", lineId)
    .eq("project_id", fixture.projectId)
    .eq("version_id", versionId)
    .eq("item_code", "M1-C-001")
    .single();
  if (line.error) throw line.error;
  const components = await fixture.admin
    .from("lukas_qto_boq_rate_components")
    .select("id", { count: "exact", head: true })
    .eq("project_id", fixture.projectId)
    .eq("version_id", versionId)
    .eq("line_id", lineId);
  if (components.error) throw components.error;
  if (components.count !== 0)
    throw new Error("M1 negative BOQ line unexpectedly has rate components");
  const removed = await estimator
    .from("lukas_qto_boq_lines")
    .delete()
    .eq("id", lineId)
    .eq("project_id", fixture.projectId)
    .eq("version_id", versionId)
    .eq("item_code", "M1-C-001")
    .select("id");
  if (removed.error || removed.data?.length !== 1)
    throw (
      removed.error ?? new Error("M1 negative BOQ line removal was not exact")
    );
}
