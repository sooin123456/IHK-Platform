import { createHash, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";

const IFC_URL =
  "https://raw.githubusercontent.com/ThatOpen/engine_web-ifc/main/examples/example.ifc";
const IFC_SHA256 =
  "db372f3f57796e2f572958c1c144bf3d8be7912493738636a2152cf18f08a14d";

type TestUser = { id: string; email: string };

export type DrawingFixture = {
  admin: SupabaseClient;
  owner: TestUser;
  reviewer: TestUser;
  viewer: TestUser;
  nonMember: TestUser;
  projectId: string;
  pdfFileId: string;
  ifcFileId: string;
  storagePaths: string[];
};

function required(name: string) {
  const value = process.env[name];
  if (!value || value === "[SENSITIVE]")
    throw new Error(
      `${name} must be supplied as an actual secret for drawing E2E; masked Vercel env output is not usable`,
    );
  return value;
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
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
    );
    for (const [path, bytes, contentType] of [
      [storagePaths[0], pdf, "application/pdf"],
      [storagePaths[1], ifc, "application/octet-stream"],
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
      ])
      .select("id,kind");
    if (fileError || !files)
      throw fileError ?? new Error("File metadata setup failed");
    const pdfFileId = files.find((file) => file.kind === "pdf")?.id;
    const ifcFileId = files.find((file) => file.kind === "ifc")?.id;
    if (!pdfFileId || !ifcFileId)
      throw new Error("Drawing IDs missing after setup");

    return {
      admin,
      owner,
      reviewer,
      viewer,
      nonMember,
      projectId: project.id,
      pdfFileId,
      ifcFileId,
      storagePaths,
    };
  } catch (error) {
    if (storagePaths.length > 0)
      await admin.storage.from("lukas-qto").remove(storagePaths);
    if (createdProjectId)
      await admin
        .from("lukas_qto_projects")
        .delete()
        .eq("id", createdProjectId);
    for (const user of createdUsers) await admin.auth.admin.deleteUser(user.id);
    throw error;
  }
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

export async function destroyDrawingFixture(
  fixture: DrawingFixture | undefined,
) {
  if (!fixture) return;
  await fixture.admin.storage.from("lukas-qto").remove(fixture.storagePaths);
  await fixture.admin
    .from("lukas_qto_projects")
    .delete()
    .eq("id", fixture.projectId);
  for (const user of [
    fixture.owner,
    fixture.reviewer,
    fixture.viewer,
    fixture.nonMember,
  ])
    await fixture.admin.auth.admin.deleteUser(user.id);
}
