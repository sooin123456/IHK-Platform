import { createHash, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";

const IFC_URL =
  "https://raw.githubusercontent.com/ThatOpen/engine_web-ifc/3f6f3640b8317664194911fad63bcd407f7e32ca/examples/example.ifc";
const IFC_SHA256 =
  "db372f3f57796e2f572958c1c144bf3d8be7912493738636a2152cf18f08a14d";

type TestUser = { id: string; email: string };

type WorkspaceFixture = {
  documentId: string;
  revisionId: string;
  pageId: string;
  sourceLayerId: string;
  workLayerId: string;
  fileId: string;
};

export type DrawingFixture = {
  admin: SupabaseClient;
  owner: TestUser;
  reviewer: TestUser;
  viewer: TestUser;
  nonMember: TestUser;
  projectId: string;
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
  storagePaths: string[],
  projectId: string | null | undefined,
  users: TestUser[],
) {
  const cleanupErrors: Error[] = [];
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
      }
    } catch (error) {
      cleanupErrors.push(
        new Error(
          `${label}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  };

  // Cleanup dependency order: project cascade releases DB/user references,
  // Storage removes immutable fixture bytes, then Auth users are removed.
  if (projectId) {
    await attempt(
      "project cleanup",
      async () =>
        await admin.from("lukas_qto_projects").delete().eq("id", projectId),
    );
  }
  if (storagePaths.length > 0) {
    await attempt("storage cleanup", () =>
      admin.storage.from("lukas-qto").remove(storagePaths),
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

async function createUser(admin: SupabaseClient, label: string, runId: string) {
  const email = `1hk-e2e-${label}-${runId}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user)
    throw error ?? new Error(`Could not create ${label}`);
  return { id: data.user.id, email };
}

export async function createDrawingFixture(): Promise<DrawingFixture> {
  const url = required("SUPABASE_URL");
  const anonKey = required("SUPABASE_ANON_KEY");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUsers: TestUser[] = [];
  let createdProjectId: string | null = null;
  const storagePaths: string[] = [];
  const addUser = async (label: string) => {
    const user = await createUser(admin, label, runId);
    createdUsers.push(user);
    return user;
  };

  try {
    const owner = await addUser("owner");
    const reviewer = await addUser("reviewer");
    const viewer = await addUser("viewer");
    const nonMember = await addUser("nonmember");

    const { data: link, error: linkError } =
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email: owner.email,
      });
    if (linkError || !link.properties?.hashed_token)
      throw linkError ?? new Error("Could not create owner setup token");
    const ownerAuth = createClient(url, anonKey, {
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
        description: "Disposable maker-reviewer browser verification",
      })
      .select("id")
      .single();
    if (projectError || !project)
      throw projectError ?? new Error("Project setup failed");
    createdProjectId = project.id;

    const { error: memberError } = await ownerAuth
      .from("lukas_qto_project_members")
      .insert([
        { project_id: project.id, user_id: reviewer.id, role: "reviewer" },
        { project_id: project.id, user_id: viewer.id, role: "viewer" },
      ]);
    if (memberError) throw memberError;

    const pdf = twoPagePdf();
    const ifcResponse = await fetch(IFC_URL);
    if (!ifcResponse.ok)
      throw new Error(`IFC fixture download failed: ${ifcResponse.status}`);
    const ifc = new Uint8Array(await ifcResponse.arrayBuffer());
    if (sha256(ifc).toLowerCase() !== IFC_SHA256)
      throw new Error("Pinned IFC fixture hash changed");

    storagePaths.push(
      `${owner.id}/${project.id}/${randomUUID()}.pdf`,
      `${owner.id}/${project.id}/${randomUUID()}.ifc`,
      `${owner.id}/${project.id}/${randomUUID()}.pdf`,
      `${owner.id}/${project.id}/${randomUUID()}.ifc`,
    );
    for (const [path, bytes, contentType] of [
      [storagePaths[0], pdf, "application/pdf"],
      [storagePaths[1], ifc, "application/octet-stream"],
      [storagePaths[2], pdf, "application/pdf"],
      [storagePaths[3], ifc, "application/octet-stream"],
    ] as const) {
      const { error } = await ownerAuth.storage
        .from("lukas-qto")
        .upload(path, bytes, {
          contentType,
          upsert: false,
        });
      if (error) throw error;
    }

    const { data: files, error: fileError } = await ownerAuth
      .from("lukas_qto_files")
      .insert([
        {
          project_id: project.id,
          uploaded_by: owner.id,
          kind: "pdf",
          storage_path: storagePaths[0],
          original_filename: "1HK-test-drawing.pdf",
          content_type: "application/pdf",
          byte_size: pdf.byteLength,
          sha256: sha256(pdf),
          immutable: true,
        },
        {
          project_id: project.id,
          uploaded_by: owner.id,
          kind: "ifc",
          storage_path: storagePaths[1],
          original_filename: "1HK-test-model.ifc",
          content_type: "application/octet-stream",
          byte_size: ifc.byteLength,
          sha256: sha256(ifc),
          immutable: true,
        },
        {
          project_id: project.id,
          uploaded_by: owner.id,
          kind: "pdf",
          storage_path: storagePaths[2],
          original_filename: "1HK-test-drawing-r2.pdf",
          content_type: "application/pdf",
          byte_size: pdf.byteLength,
          sha256: sha256(pdf),
          immutable: true,
        },
        {
          project_id: project.id,
          uploaded_by: owner.id,
          kind: "ifc",
          storage_path: storagePaths[3],
          original_filename: "1HK-test-model-r2.ifc",
          content_type: "application/octet-stream",
          byte_size: ifc.byteLength,
          sha256: sha256(ifc),
          immutable: true,
        },
      ])
      .select("id,kind,original_filename");
    if (fileError || !files)
      throw fileError ?? new Error("File metadata setup failed");
    const fileId = (name: string) =>
      files.find((file) => file.original_filename === name)?.id;
    const pdfFileId = fileId("1HK-test-drawing.pdf");
    const ifcFileId = fileId("1HK-test-model.ifc");
    const revisedPdfFileId = fileId("1HK-test-drawing-r2.pdf");
    const revisedIfcFileId = fileId("1HK-test-model-r2.ifc");
    if (!pdfFileId || !ifcFileId || !revisedPdfFileId || !revisedIfcFileId)
      throw new Error("Drawing IDs missing after setup");

    const { error: revisionError } = await admin
      .from("lukas_qto_file_revisions")
      .insert([
        {
          project_id: project.id,
          previous_file_id: pdfFileId,
          previous_sha256: sha256(pdf),
          current_file_id: revisedPdfFileId,
          current_sha256: sha256(pdf),
          relation_kind: "supersedes",
          created_by: owner.id,
        },
        {
          project_id: project.id,
          previous_file_id: ifcFileId,
          previous_sha256: sha256(ifc),
          current_file_id: revisedIfcFileId,
          current_sha256: sha256(ifc),
          relation_kind: "supersedes",
          created_by: owner.id,
        },
      ]);
    if (revisionError) throw revisionError;

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
      owner,
      reviewer,
      viewer,
      nonMember,
      projectId: project.id,
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
        storagePaths,
        createdProjectId,
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
  const objects = Array.from({ length: count }, (_, index) => {
    const isolated = index === 0;
    const gridIndex = index - 1;
    const type = isolated ? "circle" : types[gridIndex % types.length];
    composition[type] += 1;
    const x = isolated ? 820 : 12 + (gridIndex % 100) * 7;
    const y = isolated ? 580 : 12 + Math.floor(gridIndex / 100) * 5;
    const geometry =
      isolated
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
    composition,
    count,
    objects,
    selectionTarget: {
      id: target.id,
      name: target.name,
      world: { x: 820, y: 580 },
      minimumZoom: 0.5,
      tolerancePixels: 6,
    },
  };
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
  const { objects } = performanceFixture;

  for (let offset = 0; offset < objects.length; offset += 250) {
    const chunk = objects.slice(offset, offset + 250);
    const { error } = await owner.rpc("lukas_drawing_apply_operation", {
      p_revision_id: fixture.blankWorkspace.revisionId,
      p_client_operation_id: randomUUID(),
      p_operation_type: "add_objects",
      p_base_versions: {},
      p_forward: { type: "add_objects", objects: chunk },
      p_inverse: {
        type: "delete_objects",
        objectIds: chunk.map((object) => object.id),
      },
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
  await page.goto(
    `${baseUrl}/auth/confirm?token_hash=${encodeURIComponent(token)}&type=magiclink&next=${encodeURIComponent(next)}`,
  );
  await page.waitForURL((url) => url.pathname === next);
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
    fixture.storagePaths,
    fixture.projectId,
    [fixture.owner, fixture.reviewer, fixture.viewer, fixture.nonMember],
  );
}
