import { createHash, randomUUID } from "node:crypto";

import {
  authenticateApiClient,
  createDrawingFixture,
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
  rateBookFileId: string;
  rateBookEvidence: Evidence;
  rvtImmutabilitySentinelFileId: string;
  rvtImmutabilitySentinelEvidence: Evidence;
  rvtImmutabilitySentinelParseable: false;
};

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

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
    kind: "estimate" | "other";
  },
) {
  const storagePath = `${fixture.owner.id}/${fixture.projectId}/${randomUUID()}-${input.filename}`;
  const digest = sha256(input.bytes);
  const upload = await fixture.retentionClient.storage
    .from("lukas-qto")
    .upload(storagePath, input.bytes, {
      contentType: input.contentType,
      upsert: false,
    });
  if (upload.error) throw upload.error;
  fixture.storagePaths.push(storagePath);
  const file = await fixture.retentionClient
    .from("lukas_qto_files")
    .insert({
      project_id: fixture.projectId,
      uploaded_by: fixture.owner.id,
      kind: input.kind,
      storage_path: storagePath,
      original_filename: input.filename,
      content_type: input.contentType,
      byte_size: input.bytes.byteLength,
      sha256: digest,
      immutable: true,
    })
    .select("id")
    .single();
  if (file.error || !file.data?.id)
    throw file.error ?? new Error("M1 immutable evidence insert failed");
  const evidence = {
    metadataSha256: digest,
    storageByteSha256: digest,
    byteLength: input.bytes.byteLength,
  };
  fixture.sourceEvidence[file.data.id] = evidence;
  return { evidence, fileId: file.data.id };
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

  const rateBook = await uploadImmutableEvidence(fixture, {
    bytes: Buffer.from(RATE_BOOK_CSV, "utf8"),
    contentType: "text/csv",
    filename: "1hk-m1-company-rates.csv",
    kind: "estimate",
  });
  if (rateBook.evidence.metadataSha256 !== RATE_BOOK_SHA256)
    throw new Error("M1 rate-book fixture digest changed");
  const rvtSentinel = await uploadImmutableEvidence(fixture, {
    bytes: RVT_SENTINEL,
    contentType: "application/octet-stream",
    filename: "source-integrity-only.rvt",
    kind: "other",
  });
  return {
    ...fixture,
    emptyProjectId: emptyProject.data.id,
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
