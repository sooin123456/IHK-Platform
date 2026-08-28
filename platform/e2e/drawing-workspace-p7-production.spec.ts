import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { requireP7ProductionAuthorities } from "../scripts/run-drawing-workspace-p7-release.mjs";

const authority = requireP7ProductionAuthorities(process.env);
const evidencePath = process.env.P7_PRODUCTION_RAW_EVIDENCE_PATH;
const invocationId = process.env.P7_PRODUCTION_INVOCATION_ID;
if (!evidencePath || !invocationId)
  throw new Error(
    "P7 production gate is UNEXECUTED: runner evidence path and invocation are required",
  );

const admin = createClient(
  authority.supabaseUrl.toString(),
  authority.serviceRoleKey,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);
const sha256 = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");

async function exactUser(identity: { id: string; email: string }) {
  const result = await admin.auth.admin.getUserById(identity.id);
  if (result.error || !result.data.user)
    throw (
      result.error ??
      new Error(`P7 production identity ${identity.id} is absent`)
    );
  expect(result.data.user.email?.toLowerCase()).toBe(identity.email);
  return identity;
}

async function apiClient(identity: { id: string; email: string }) {
  await exactUser(identity);
  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: identity.email,
  });
  if (link.error || !link.data.properties?.hashed_token)
    throw (
      link.error ?? new Error("P7 production identity has no exact login token")
    );
  const client = createClient(
    authority.supabaseUrl.toString(),
    authority.anonKey,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
  const verified = await client.auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: "magiclink",
  });
  if (verified.error || verified.data.user?.id !== identity.id)
    throw verified.error ?? new Error("P7 exact production identity mismatch");
  return client;
}

async function mountedPage(
  context: BrowserContext,
  identity: { id: string; email: string },
) {
  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: identity.email,
  });
  if (link.error || !link.data.properties?.hashed_token)
    throw (
      link.error ?? new Error("P7 production browser login token is absent")
    );
  const path = `/projects/${authority.project}/drawings/${authority.file}/workspace?document=${authority.document}`;
  const page = await context.newPage();
  await page.goto(
    `${authority.baseUrl.origin}/auth/confirm?token_hash=${encodeURIComponent(link.data.properties.hashed_token)}&type=magiclink&next=${encodeURIComponent(path)}`,
  );
  await page.waitForURL((url) => url.pathname === path.split("?")[0]);
  await expect(page.getByLabel(/도면 화면/)).toBeVisible();
  await expect(
    page.getByRole("status", { name: "공동 편집 상태: connected" }),
  ).toBeVisible({ timeout: 30_000 });
  return page;
}

async function readSourceEvidence(client: SupabaseClient) {
  const files = await client
    .from("lukas_qto_files")
    .select("id,kind,sha256,byte_size,storage_path")
    .eq("project_id", authority.project)
    .in("kind", ["pdf", "ifc"])
    .order("id");
  if (files.error || !files.data?.length)
    throw files.error ?? new Error("P7 PDF/IFC source evidence is absent");
  const result = [];
  for (const file of files.data) {
    const download = await client.storage
      .from("lukas-qto")
      .download(file.storage_path);
    if (download.error || !download.data)
      throw download.error ?? new Error(`P7 source ${file.id} download failed`);
    const bytes = new Uint8Array(await download.data.arrayBuffer());
    expect(sha256(bytes)).toBe(file.sha256);
    expect(bytes.byteLength).toBe(file.byte_size);
    result.push({
      id: file.id,
      kind: file.kind,
      sha256: file.sha256,
      bytes: file.byte_size,
    });
  }
  expect(result.some(({ kind }) => kind === "pdf")).toBe(true);
  expect(result.some(({ kind }) => kind === "ifc")).toBe(true);
  return result;
}

async function waitSaved(page: Page) {
  await expect(
    page.getByRole("status", { name: "저장 상태: 저장됨" }),
  ).toBeVisible({
    timeout: 45_000,
  });
}

async function canvasPoint(page: Page, world: { x: number; y: number }) {
  const canvas = page.getByLabel(/도면 화면/);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("P7 production canvas has no layout box");
  return {
    x:
      box.x +
      Number(await canvas.getAttribute("data-viewport-x")) +
      world.x * Number(await canvas.getAttribute("data-viewport-zoom")),
    y:
      box.y +
      Number(await canvas.getAttribute("data-viewport-y")) +
      world.y * Number(await canvas.getAttribute("data-viewport-zoom")),
  };
}

test.describe.serial("P7 mounted production completion authority", () => {
  test("three actual identities open, author offline, comment, revise, review, approve, export, and preserve sources", async ({
    browser,
  }) => {
    const response = await fetch(authority.baseUrl);
    expect(response.ok).toBe(true);
    expect(
      response.headers.get("x-vercel-deployment-id") ??
        response.headers.get("x-deployment-id"),
    ).toBe(authority.deploymentId);
    expect(
      response.headers.get("x-vercel-git-commit-sha") ??
        response.headers.get("x-commit-sha"),
    ).toBe(authority.commit);
    expect(
      response.headers.get("x-vercel-id") ?? response.headers.get("x-region"),
    ).toContain(authority.region);

    const [authorIdentity, commenterIdentity, approverIdentity] =
      await Promise.all(authority.identities.map(exactUser));
    const [authorApi, commenterApi, approverApi] = await Promise.all([
      apiClient(authorIdentity),
      apiClient(commenterIdentity),
      apiClient(approverIdentity),
    ]);
    const membership = await admin
      .from("lukas_qto_project_members")
      .select("user_id,role")
      .eq("project_id", authority.project)
      .in(
        "user_id",
        authority.identities.map(({ id }) => id),
      );
    if (membership.error) throw membership.error;
    expect(new Set(membership.data.map(({ user_id }) => user_id))).toEqual(
      new Set(authority.identities.map(({ id }) => id)),
    );
    expect(
      membership.data.find(({ user_id }) => user_id === authorIdentity.id)
        ?.role,
    ).toBe("estimator");
    expect(
      membership.data.find(({ user_id }) => user_id === commenterIdentity.id)
        ?.role,
    ).toBe("reviewer");

    const sourceBefore = await readSourceEvidence(authorApi);
    const authorContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const commenterContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const approverContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const [authorPage, commenterPage, approverPage] = await Promise.all([
      mountedPage(authorContext, authorIdentity),
      mountedPage(commenterContext, commenterIdentity),
      mountedPage(approverContext, approverIdentity),
    ]);

    const operationsBefore = await admin
      .from("lukas_drawing_operations")
      .select("id")
      .eq("revision_id", authority.revision);
    if (operationsBefore.error) throw operationsBefore.error;
    await authorContext.setOffline(true);
    await authorPage.getByRole("button", { name: "선 도구" }).click();
    for (const point of [
      await canvasPoint(authorPage, { x: 60, y: 60 }),
      await canvasPoint(authorPage, { x: 180, y: 60 }),
    ])
      await authorPage.mouse.click(point.x, point.y);
    await expect(
      authorPage.getByRole("status", { name: /저장 상태/ }),
    ).toContainText(/오프라인|저장 중/);
    await authorContext.setOffline(false);
    await waitSaved(authorPage);
    await expect
      .poll(async () => {
        const rows = await admin
          .from("lukas_drawing_operations")
          .select("id")
          .eq("revision_id", authority.revision);
        if (rows.error) throw rows.error;
        return rows.data.length - operationsBefore.data.length;
      })
      .toBe(1);

    await commenterPage.getByRole("tab", { name: "댓글·이슈" }).click();
    const comment = `P7 mounted production comment ${authority.runId}`;
    await commenterPage.getByLabel("댓글").fill(comment);
    await commenterPage.getByRole("button", { name: "댓글 등록" }).click();
    await expect(authorPage.getByText(comment)).toBeVisible({
      timeout: 30_000,
    });

    const objects = await authorApi
      .from("lukas_drawing_objects")
      .select("id,name,version")
      .eq("revision_id", authority.revision)
      .eq("created_by", authorIdentity.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (objects.error) throw objects.error;
    const revisedName = `P7 revised ${authority.runId}`;
    const revisionOperation = await authorApi.rpc(
      "lukas_drawing_apply_operation",
      {
        p_revision_id: authority.revision,
        p_client_operation_id: randomUUID(),
        p_operation_type: "update_objects",
        p_base_versions: { [objects.data.id]: objects.data.version },
        p_forward: {
          type: "update_objects",
          updates: [
            { objectId: objects.data.id, patch: { name: revisedName } },
          ],
        },
        p_inverse: {
          type: "update_objects",
          updates: [
            { objectId: objects.data.id, patch: { name: objects.data.name } },
          ],
        },
      },
    );
    if (revisionOperation.error) throw revisionOperation.error;
    await expect(commenterPage.getByText(revisedName)).toBeVisible({
      timeout: 30_000,
    });

    await authorPage.getByRole("button", { name: "검토 요청" }).click();
    await expect
      .poll(async () => {
        const row = await admin
          .from("lukas_drawing_revisions")
          .select("status")
          .eq("id", authority.revision)
          .single();
        if (row.error) throw row.error;
        return row.data.status;
      })
      .toBe("review_requested");
    await approverPage.reload();
    await approverPage
      .getByLabel("검토 의견")
      .fill(`P7 independent approval ${authority.runId}`);
    await approverPage.getByRole("button", { name: "도면 승인" }).click();
    await expect
      .poll(async () => {
        const row = await admin
          .from("lukas_drawing_revisions")
          .select("status")
          .eq("id", authority.revision)
          .single();
        if (row.error) throw row.error;
        return row.data.status;
      })
      .toBe("approved");

    const directUpdate = await authorApi
      .from("lukas_drawing_revisions")
      .update({ status: "draft" })
      .eq("id", authority.revision);
    expect(directUpdate.error).toBeTruthy();
    const directDelete = await authorApi
      .from("lukas_drawing_revisions")
      .delete()
      .eq("id", authority.revision);
    expect(directDelete.error).toBeTruthy();
    const frozenOperation = await authorApi.rpc(
      "lukas_drawing_apply_operation",
      {
        p_revision_id: authority.revision,
        p_client_operation_id: randomUUID(),
        p_operation_type: "update_objects",
        p_base_versions: {
          [objects.data.id]: Number(objects.data.version) + 1,
        },
        p_forward: {
          type: "update_objects",
          updates: [
            { objectId: objects.data.id, patch: { name: "forbidden" } },
          ],
        },
        p_inverse: {
          type: "update_objects",
          updates: [
            { objectId: objects.data.id, patch: { name: revisedName } },
          ],
        },
      },
    );
    expect(frozenOperation.error).toBeTruthy();

    await approverPage.reload();
    const downloadPromise = approverPage.waitForEvent("download");
    await approverPage.getByRole("button", { name: "내보내기" }).click();
    const dialog = approverPage.getByRole("dialog", { name: "도면 내보내기" });
    await dialog.getByRole("radio", { name: "PDF" }).check();
    await dialog.getByRole("button", { name: "다운로드" }).click();
    const download = await downloadPromise;
    const exportPath = await download.path();
    if (!exportPath) throw new Error("P7 production export has no bytes");
    const exportBytes = new Uint8Array(
      await (await import("node:fs/promises")).readFile(exportPath),
    );
    expect(exportBytes.byteLength).toBeGreaterThan(0);
    const sourceAfter = await readSourceEvidence(approverApi);
    expect(sourceAfter).toEqual(sourceBefore);

    const exportAudit = await admin
      .from("lukas_qto_export_events")
      .select("sha256,byte_size,actor_id")
      .eq("project_id", authority.project)
      .eq("actor_id", approverIdentity.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (exportAudit.error) throw exportAudit.error;
    expect(exportAudit.data.sha256).toBe(sha256(exportBytes));
    expect(exportAudit.data.byte_size).toBe(exportBytes.byteLength);

    await writeFile(
      evidencePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          authority: "P7_MOUNTED_PRODUCTION_PLAYWRIGHT_V1",
          invocationId,
          runId: authority.runId,
          commit: authority.commit,
          deploymentId: authority.deploymentId,
          identities: authority.identities,
          projectId: authority.project,
          documentId: authority.document,
          revisionId: authority.revision,
          sourceBefore,
          sourceAfter,
          offlineOperationsAuthored: 1,
          offlineOperationsPersisted: 1,
          offlineLoss: 0,
          approvedImmutable: true,
          export: {
            sha256: sha256(exportBytes),
            byteSize: exportBytes.byteLength,
            auditActorId: exportAudit.data.actor_id,
          },
          recordedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
    await Promise.all([
      authorContext.close(),
      commenterContext.close(),
      approverContext.close(),
    ]);
    void commenterApi;
  });
});
