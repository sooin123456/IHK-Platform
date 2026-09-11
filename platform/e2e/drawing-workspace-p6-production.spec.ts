import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import postgres from "postgres";

import {
  requireP6LocalAuthorities,
  requireP6ProductionAuthorities,
} from "../scripts/run-drawing-workspace-p6-release.mjs";
import {
  deriveDrawingP6GateStatus,
  type DrawingP6PerformanceEvidence,
  writeDrawingP6PerformanceEvidence,
} from "../scripts/drawing-p6-performance-evidence.mjs";
import {
  buildDrawingP6UnexecutedReleaseEvidence,
  P6_RELEASE_MIGRATION_IDS,
  writeDrawingP6ReleaseEvidence,
} from "../scripts/drawing-p6-release-evidence.mjs";

const localPhase = process.env.P6_E2E_PHASE === "local";
const authority = localPhase
  ? requireP6LocalAuthorities(process.env)
  : requireP6ProductionAuthorities(process.env);
const admin = createClient(
  authority.supabaseUrl.toString(),
  (localPhase
    ? process.env.P6_LOCAL_SUPABASE_SERVICE_ROLE_KEY
    : process.env.P6_E2E_SUPABASE_SERVICE_ROLE_KEY)!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const sha256 = (bytes: Uint8Array | Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const p95 = (values: number[]) =>
  [...values].sort((left, right) => left - right)[
    Math.ceil(values.length * 0.95) - 1
  ];
const performanceOperationNames = [
  "sourcePage",
  "calculationManifest",
  "comparison",
  "exports",
  "objectToBoq",
  "materialLineage",
] as const;
const operationCorrelationIds = Object.fromEntries(
  performanceOperationNames.map((name) => [name, `${name}:${randomUUID()}`]),
) as Record<(typeof performanceOperationNames)[number], string>;

async function queryRuntimeResourceEvidence(
  startedAt: string,
  endedAt: string,
): Promise<{
  provider: string;
  queryId: string;
  sha256: string;
  operations: Record<
    (typeof performanceOperationNames)[number],
    { cpuMs: number; peakRssMiB: number }
  >;
}> {
  void startedAt;
  void endedAt;
  writeDrawingP6ReleaseEvidence(
    buildDrawingP6UnexecutedReleaseEvidence(
      localPhase ? "local" : "production",
      authority.commit,
    ),
  );
  throw new Error(
    `P6 ${localPhase ? "local" : "production"} runtime CPU/RSS authority is UNEXECUTED: no documented trusted OTLP/Drain or provider API adapter is configured for the correlated operation IDs`,
  );
}

async function userByEmail(email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (result.error) throw result.error;
    const user = result.data.users.find(
      (candidate) => candidate.email?.toLowerCase() === email,
    );
    if (user) return { id: user.id, email };
    if (result.data.users.length < 200) break;
  }
  throw new Error(
    `P6 production gate is UNEXECUTED: fixture user ${email} is absent`,
  );
}

async function apiClient(user: { email: string }) {
  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  if (link.error || !link.data.properties?.hashed_token)
    throw link.error ?? new Error("P6 magic link has no token");
  const client = createClient(
    authority.supabaseUrl.toString(),
    (localPhase
      ? process.env.P6_LOCAL_SUPABASE_ANON_KEY
      : process.env.P6_E2E_SUPABASE_ANON_KEY)!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const verified = await client.auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: "magiclink",
  });
  if (verified.error) throw verified.error;
  return client;
}

async function browserPage(
  context: BrowserContext,
  user: { email: string },
  path: string,
) {
  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  if (link.error || !link.data.properties?.hashed_token)
    throw link.error ?? new Error("P6 browser magic link has no token");
  const page = await context.newPage();
  await page.goto(
    `${authority.baseUrl.origin}/auth/confirm?token_hash=${encodeURIComponent(link.data.properties.hashed_token)}&type=magiclink&next=${encodeURIComponent(path)}`,
  );
  await page.waitForURL((url) => url.pathname === path.split("?")[0]);
  return page;
}

async function postAction(
  context: BrowserContext,
  path: string,
  form: Record<string, string>,
) {
  const response = await context.request.post(
    `${authority.baseUrl.origin}${path}`,
    {
      form,
      maxRedirects: 5,
    },
  );
  expect(response.ok(), await response.text()).toBe(true);
  return response;
}

async function sourceEvidence(client: SupabaseClient) {
  const sourceRows: Array<{ source_file_id: string }> = [];
  for (let from = 0; ; from += 200) {
    const page = await client
      .from("lukas_drawing_object_sources")
      .select("source_file_id")
      .eq("revision_id", authority.drawingRevisionId)
      .eq("status", "active")
      .order("id")
      .range(from, from + 199);
    if (page.error) throw page.error;
    sourceRows.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < 200) break;
  }
  expect(sourceRows.length).toBeGreaterThan(0);
  const ids = [...new Set(sourceRows.map((row) => row.source_file_id))];
  const files = await client
    .from("lukas_qto_files")
    .select("id,sha256,byte_size,storage_path")
    .in("id", ids);
  if (files.error || files.data?.length !== ids.length)
    throw files.error ?? new Error("P6 source file metadata is incomplete");
  const evidence = [];
  for (const file of files.data) {
    const download = await client.storage
      .from("lukas-qto")
      .download(file.storage_path);
    if (download.error || !download.data)
      throw download.error ?? new Error("P6 private source download failed");
    const bytes = Buffer.from(await download.data.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(digest).toBe(file.sha256);
    expect(bytes.byteLength).toBe(file.byte_size);
    evidence.push({ id: file.id, sha256: digest, bytes: bytes.byteLength });
  }
  return evidence.sort((left, right) => left.id.localeCompare(right.id));
}

test.describe.serial("P6 deployed lineage authority", () => {
  test("maker, distinct approver, attacker, private Storage, and mounted reverse lineage are authoritative", async ({
    browser,
  }) => {
    const deployment = await fetch(authority.baseUrl);
    expect(deployment.ok).toBe(true);
    if (!localPhase) {
      expect(
        deployment.headers.get("x-vercel-deployment-id") ??
          deployment.headers.get("x-deployment-id"),
      ).toBe(authority.deploymentId);
      expect(
        deployment.headers.get("x-vercel-git-commit-sha") ??
          deployment.headers.get("x-commit-sha"),
      ).toBe(authority.commit);
      expect(
        deployment.headers.get("x-vercel-id") ??
          deployment.headers.get("x-region"),
      ).toContain(authority.region);
      const managementHeaders = {
        Authorization: `Bearer ${authority.managementAccessToken}`,
      };
      for (const advisor of ["security", "performance"]) {
        const response = await fetch(
          new URL(
            `/v1/projects/${authority.projectRef}/advisors/${advisor}`,
            authority.managementApiUrl,
          ),
          { headers: managementHeaders },
        );
        const body = await response.text();
        expect(response.ok, body).toBe(true);
        const report = JSON.parse(body);
        const findings = Array.isArray(report) ? report : report.lints;
        expect(Array.isArray(findings)).toBe(true);
        expect(
          findings.filter((finding: { level?: string }) =>
            ["ERROR", "WARN"].includes(finding.level ?? ""),
          ),
        ).toEqual([]);
      }
      const backupsResponse = await fetch(
        new URL(
          `/v1/projects/${authority.projectRef}/database/backups`,
          authority.managementApiUrl,
        ),
        { headers: managementHeaders },
      );
      const backupsBody = await backupsResponse.text();
      expect(backupsResponse.ok, backupsBody).toBe(true);
      const backupsPayload = JSON.parse(backupsBody);
      const backups = Array.isArray(backupsPayload)
        ? backupsPayload
        : backupsPayload.backups;
      expect(
        backups.some(
          (backup: { id?: string }) => backup.id === authority.backupId,
        ),
      ).toBe(true);
      const restoreResponse = await fetch(
        new URL(
          `/v1/projects/${authority.projectRef}/database/backups/restores/${authority.restoreOperationId}`,
          authority.managementApiUrl,
        ),
        { headers: managementHeaders },
      );
      const restoreBody = await restoreResponse.text();
      expect(restoreResponse.ok, restoreBody).toBe(true);
      expect(JSON.parse(restoreBody)).toMatchObject({
        id: authority.restoreOperationId,
        backup_id: authority.backupId,
        status: "completed",
      });
      const verifyDatabase = async (
        databaseUrl: string,
        expected: "fresh" | "upgrade" | "restore",
      ) => {
        const database = postgres(databaseUrl, { max: 1, prepare: false });
        try {
          const migrations = await database`
          select version from supabase_migrations.schema_migrations
          where version=any(${database.array([...P6_RELEASE_MIGRATION_IDS])})
          order by version
        `;
          expect(migrations.map((row) => row.version)).toEqual([
            ...P6_RELEASE_MIGRATION_IDS,
          ]);
          const versions = await database`
          select id,result_sha256,manifest_sha256
          from public.lukas_qto_boq_versions
          where id=${authority.boqVersionId}::uuid
        `;
          expect(versions).toHaveLength(expected === "fresh" ? 0 : 1);
          if (expected === "restore") {
            const [identity] = await database`
            select pg_catalog.obj_description(d.oid,'pg_database') database_comment
            from pg_catalog.pg_database d where d.datname=current_database()
          `;
            expect(identity.database_comment).toContain(authority.backupId);
            expect(versions[0]).toMatchObject({
              result_sha256: authority.restoreResultSha256,
              manifest_sha256: authority.restoreManifestSha256,
            });
          }
        } finally {
          await database.end();
        }
      };
      await verifyDatabase(authority.freshPostgresUrl, "fresh");
      await verifyDatabase(authority.upgradePostgresUrl, "upgrade");
      await verifyDatabase(authority.restorePostgresUrl, "restore");
    }
    let postgresVersion = "";
    let workloadCounts = {
      drawingQuantityLinks: 0,
      allocationLinks: 0,
      boqLines: 0,
      legacyMappings: 0,
      approvedSnapshots: 0,
      priceBooks: 0,
      materialComponents: 0,
    };
    const sql = postgres(authority.postgresUrl, { max: 1, prepare: false });
    try {
      const [identity] = await sql`
        select current_database() database_name,
          current_setting('server_version') server_version,
          pg_catalog.obj_description(d.oid,'pg_database') database_comment
        from pg_catalog.pg_database d where d.datname=current_database()
      `;
      expect(identity.database_name).toBeTruthy();
      expect(identity.server_version).toMatch(/^\d+/);
      postgresVersion = identity.server_version;
      if (!localPhase)
        expect(identity.database_comment).toContain(authority.backupId);
      const migrations = await sql`
        select version from supabase_migrations.schema_migrations
        where version=any(${sql.array([...P6_RELEASE_MIGRATION_IDS])})
        order by version
      `;
      expect(migrations.map((row) => row.version)).toEqual([
        ...P6_RELEASE_MIGRATION_IDS,
      ]);
      const [counts] = await sql`
        select
          (select count(*)::integer
           from public.lukas_drawing_quantity_links
           where drawing_revision_id=${authority.drawingRevisionId}::uuid) drawing_quantity_links,
          (select count(*)::integer
           from public.lukas_drawing_boq_links b
           join public.lukas_drawing_quantity_links q
             on q.id=b.quantity_link_id and q.project_id=b.project_id
           where b.boq_version_id=${authority.boqVersionId}::uuid
             and q.drawing_revision_id=${authority.drawingRevisionId}::uuid) allocation_links,
          (select count(*)::integer from public.lukas_qto_boq_lines
           where version_id=${authority.boqVersionId}::uuid) boq_lines,
          (select count(*)::integer from public.lukas_qto_boq_quantity_mappings
           where version_id=${authority.boqVersionId}::uuid) legacy_mappings,
          (select count(distinct s.id)::integer
           from public.lukas_drawing_snapshots s
           join public.lukas_drawing_revision_approvals a
             on a.revision_id=s.revision_id and a.project_id=s.project_id
             and a.subject_version=s.revision_version
             and a.snapshot_sha256=s.sha256 and a.decision='approved'
           where s.revision_id=${authority.drawingRevisionId}::uuid) approved_snapshots,
          (select count(distinct price_book_id)::integer
           from public.lukas_qto_boq_versions
           where id=${authority.boqVersionId}::uuid) price_books,
          (select count(*)::integer from public.lukas_qto_boq_rate_components
           where version_id=${authority.boqVersionId}::uuid) material_components
      `;
      workloadCounts = {
        drawingQuantityLinks: counts.drawing_quantity_links,
        allocationLinks: counts.allocation_links,
        boqLines: counts.boq_lines,
        legacyMappings: counts.legacy_mappings,
        approvedSnapshots: counts.approved_snapshots,
        priceBooks: counts.price_books,
        materialComponents: counts.material_components,
      };
      expect(workloadCounts).toEqual({
        drawingQuantityLinks: 10_000,
        allocationLinks: 10_000,
        boqLines: 2_000,
        legacyMappings: 200,
        approvedSnapshots: 1,
        priceBooks: 1,
        materialComponents: 2_000,
      });
    } finally {
      await sql.end();
    }
    const [maker, approver, attacker, viewer] = await Promise.all([
      userByEmail(authority.makerEmail),
      userByEmail(authority.approverEmail),
      userByEmail(authority.attackerEmail),
      userByEmail(authority.viewerEmail),
    ]);
    expect(new Set([maker.id, approver.id, attacker.id, viewer.id]).size).toBe(
      4,
    );
    const [makerClient, attackerClient, viewerClient] = await Promise.all([
      apiClient(maker),
      apiClient(attacker),
      apiClient(viewer),
    ]);
    const makerSession = await makerClient.auth.getSession();
    const makerAccessSession = makerSession.data.session;
    if (!makerAccessSession)
      throw makerSession.error ?? new Error("P6 maker session is absent");
    const correlatedClient = async (
      name: (typeof performanceOperationNames)[number],
    ) => {
      const client = createClient(
        authority.supabaseUrl.toString(),
        (localPhase
          ? process.env.P6_LOCAL_SUPABASE_ANON_KEY
          : process.env.P6_E2E_SUPABASE_ANON_KEY)!,
        {
          global: {
            headers: {
              "x-onehk-p6-operation-id": operationCorrelationIds[name],
            },
          },
          auth: { autoRefreshToken: false, persistSession: false },
        },
      );
      const session = await client.auth.setSession({
        access_token: makerAccessSession.access_token,
        refresh_token: makerAccessSession.refresh_token,
      });
      if (session.error) throw session.error;
      return client;
    };
    const [sourcePageClient, objectToBoqClient, materialLineageClient] =
      await Promise.all([
        correlatedClient("sourcePage"),
        correlatedClient("objectToBoq"),
        correlatedClient("materialLineage"),
      ]);
    const version = await makerClient
      .from("lukas_qto_boq_versions")
      .select(
        "id,project_id,status,result_sha256,manifest_sha256,created_by,supersedes_id",
      )
      .eq("id", authority.boqVersionId)
      .single();
    if (version.error || !version.data) throw version.error;
    expect(["approved", "superseded"]).toContain(version.data.status);
    expect(version.data).toMatchObject({
      result_sha256: authority.restoreResultSha256,
      manifest_sha256: authority.restoreManifestSha256,
    });
    expect(version.data.created_by).toBe(maker.id);
    expect(version.data.supersedes_id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    const approval = await makerClient
      .from("lukas_qto_boq_approvals")
      .select("decision,decided_by")
      .eq("boq_version_id", authority.boqVersionId)
      .eq("decision", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (approval.error || !approval.data) throw approval.error;
    expect(approval.data.decided_by).toBe(approver.id);
    expect(approval.data.decided_by).not.toBe(version.data.created_by);
    const material = await makerClient
      .from("lukas_drawing_material_links")
      .select("material_plan_id,boq_result_sha256")
      .eq("boq_version_id", authority.boqVersionId)
      .eq("material_plan_id", authority.materialPlanId)
      .limit(200);
    if (material.error || !material.data?.length) throw material.error;
    expect(
      material.data.every(
        (row) => row.boq_result_sha256 === version.data.result_sha256,
      ),
    ).toBe(true);
    const mappingCount = await makerClient
      .from("lukas_drawing_boq_links")
      .select("id", { count: "exact", head: true })
      .eq("boq_version_id", authority.boqVersionId);
    if (mappingCount.error) throw mappingCount.error;
    expect(mappingCount.count).toBe(10_000);

    const denied = await attackerClient
      .from("lukas_qto_projects")
      .select("id")
      .eq("id", authority.projectId);
    if (denied.error) throw denied.error;
    expect(denied.data).toEqual([]);
    const viewerProject = await viewerClient
      .from("lukas_qto_projects")
      .select("id")
      .eq("id", authority.projectId)
      .single();
    if (viewerProject.error) throw viewerProject.error;
    expect(viewerProject.data.id).toBe(authority.projectId);
    const viewerMembership = await viewerClient
      .from("lukas_qto_project_members")
      .select("role")
      .eq("project_id", authority.projectId)
      .eq("user_id", viewer.id)
      .single();
    if (viewerMembership.error) throw viewerMembership.error;
    expect(viewerMembership.data.role).toBe("viewer");

    const before = await sourceEvidence(makerClient);
    const sourceFile = await admin
      .from("lukas_qto_files")
      .select("storage_path")
      .eq("id", before[0].id)
      .single();
    if (sourceFile.error || !sourceFile.data) throw sourceFile.error;
    const anonymous = createClient(
      authority.supabaseUrl.toString(),
      (localPhase
        ? process.env.P6_LOCAL_SUPABASE_ANON_KEY
        : process.env.P6_E2E_SUPABASE_ANON_KEY)!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const [anonymousRead, attackerRead] = await Promise.all([
      anonymous.storage
        .from("lukas-qto")
        .download(sourceFile.data.storage_path),
      attackerClient.storage
        .from("lukas-qto")
        .download(sourceFile.data.storage_path),
    ]);
    expect(anonymousRead.error).not.toBeNull();
    expect(attackerRead.error).not.toBeNull();
    const signed = await admin.storage
      .from("lukas-qto")
      .createSignedUrl(sourceFile.data.storage_path, 60);
    if (signed.error || !signed.data?.signedUrl) throw signed.error;
    const cors = await fetch(signed.data.signedUrl, {
      headers: { Origin: authority.storageCorsOrigin },
    });
    expect(cors.ok).toBe(true);
    expect(cors.headers.get("access-control-allow-origin")).toBe(
      authority.storageCorsOrigin,
    );

    const revision = await makerClient
      .from("lukas_drawing_revisions")
      .select("document_id")
      .eq("id", authority.drawingRevisionId)
      .single();
    if (revision.error || !revision.data) throw revision.error;
    const document = await makerClient
      .from("lukas_drawing_documents")
      .select("source_file_id")
      .eq("id", revision.data.document_id)
      .single();
    if (document.error || !document.data?.source_file_id) throw document.error;
    const drawingPath = `/projects/${authority.projectId}/drawings/${document.data.source_file_id}/workspace?document=${revision.data.document_id}`;
    const boqPath = `/projects/${authority.projectId}/boq?version=${authority.boqVersionId}`;
    const measurementStartedAt = new Date().toISOString();
    const makerContext = await browser.newContext();
    const secondMakerContext = await browser.newContext();
    const approverContext = await browser.newContext();
    const attackerContext = await browser.newContext();
    const viewerContext = await browser.newContext();
    try {
      const [drawingPage, secondMakerPage, boqPage, attackerPage, viewerPage] =
        await Promise.all([
          browserPage(makerContext, maker, drawingPath),
          browserPage(secondMakerContext, maker, boqPath),
          browserPage(approverContext, approver, boqPath),
          browserPage(
            attackerContext,
            attacker,
            `/projects/${authority.projectId}`,
          ),
          browserPage(viewerContext, viewer, boqPath),
        ]);
      await expect(
        drawingPage.getByRole("group", { name: "도면 작업실 보기" }),
      ).toBeVisible();
      await expect(boqPage.getByText(/승인|확정/).first()).toBeVisible();
      await expect(attackerPage).not.toHaveURL(
        new RegExp(`/projects/${authority.projectId}$`),
      );
      await expect(viewerPage.getByText(/승인|확정/).first()).toBeVisible();

      const predecessor = await makerClient
        .from("lukas_qto_boq_versions")
        .select("price_book_id")
        .eq("id", authority.boqVersionId)
        .single();
      if (predecessor.error || !predecessor.data?.price_book_id)
        throw (
          predecessor.error ?? new Error("P6 predecessor has no price book")
        );
      const predecessorLinks = await makerClient
        .from("lukas_drawing_boq_links")
        .select("id,quantity_link_id,boq_line_id,allocation_factor,version")
        .eq("boq_version_id", authority.boqVersionId)
        .order("id")
        .limit(200);
      const predecessorComponents = await makerClient
        .from("lukas_qto_boq_rate_components")
        .select("line_id,resource_id,coefficient")
        .eq("version_id", authority.boqVersionId)
        .limit(200);
      if (
        predecessorLinks.error ||
        !predecessorLinks.data?.length ||
        predecessorComponents.error
      )
        throw (
          predecessorLinks.error ??
          predecessorComponents.error ??
          new Error("P6 predecessor has no Drawing link")
        );
      const resources = await makerClient
        .from("lukas_qto_price_resources")
        .select("id,resource_type,unit,price_book_id")
        .in(
          "id",
          (predecessorComponents.data ?? []).map((row) => row.resource_id),
        );
      if (resources.error) throw resources.error;
      const resourceById = new Map(resources.data.map((row) => [row.id, row]));
      const predecessorComponent = predecessorComponents.data?.find(
        (component) => {
          const resource = resourceById.get(component.resource_id);
          return (
            predecessorLinks.data.some(
              (link) => link.boq_line_id === component.line_id,
            ) &&
            resource?.resource_type === "material" &&
            resource.price_book_id === predecessor.data.price_book_id
          );
        },
      );
      if (!predecessorComponent)
        throw new Error("P6 fixture lacks one linked material BOQ line");
      const coherentLinks = predecessorLinks.data.filter(
        (link) => link.boq_line_id === predecessorComponent.line_id,
      );
      if (coherentLinks.length < 2)
        throw new Error(
          "P6 fixture needs two distinct Drawing sources on the material line",
        );
      const predecessorLink = coherentLinks[0];
      const successorSourceLink = coherentLinks[1];
      const [predecessorLine, predecessorQuantity] = await Promise.all([
        makerClient
          .from("lukas_qto_boq_lines")
          .select("item_code,item_name,specification,unit")
          .eq("id", predecessorLink.boq_line_id)
          .eq("version_id", authority.boqVersionId)
          .single(),
        makerClient
          .from("lukas_drawing_quantity_links")
          .select("unit")
          .eq("id", predecessorLink.quantity_link_id)
          .single(),
      ]);
      if (predecessorLine.error || predecessorQuantity.error)
        throw predecessorLine.error ?? predecessorQuantity.error;
      expect(predecessorLine.data.unit).toBe(predecessorQuantity.data.unit);
      expect(resourceById.get(predecessorComponent.resource_id)?.unit).toBe(
        predecessorLine.data.unit,
      );
      const deniedRpcArgs = {
        p_id: predecessorLink.id,
        p_quantity_link_id: predecessorLink.quantity_link_id,
        p_boq_version_id: authority.boqVersionId,
        p_boq_line_id: predecessorLink.boq_line_id,
        p_allocation_factor: predecessorLink.allocation_factor,
        p_base_version: predecessorLink.version,
      };
      const operationsBeforeDenial = await makerClient
        .from("lukas_drawing_operations")
        .select("id", { count: "exact", head: true })
        .eq("revision_id", authority.drawingRevisionId);
      if (operationsBeforeDenial.error) throw operationsBeforeDenial.error;
      const [viewerRpc, attackerRpc] = await Promise.all([
        viewerClient.rpc("lukas_drawing_put_boq_link", deniedRpcArgs),
        attackerClient.rpc("lukas_drawing_put_boq_link", deniedRpcArgs),
      ]);
      expect(viewerRpc.error).not.toBeNull();
      expect(attackerRpc.error).not.toBeNull();
      const deniedRouteForm = {
        intent: "drawing_boq_put",
        id: predecessorLink.id,
        quantity_link_id: predecessorLink.quantity_link_id,
        version_id: authority.boqVersionId,
        line_id: predecessorLink.boq_line_id,
        allocation_factor: predecessorLink.allocation_factor,
        base_version: String(predecessorLink.version),
      };
      const [viewerRouteWrite, attackerRouteWrite] = await Promise.all([
        viewerContext.request.post(`${authority.baseUrl.origin}${boqPath}`, {
          form: deniedRouteForm,
          maxRedirects: 0,
        }),
        attackerContext.request.post(`${authority.baseUrl.origin}${boqPath}`, {
          form: deniedRouteForm,
          maxRedirects: 0,
        }),
      ]);
      expect(viewerRouteWrite.ok()).toBe(false);
      expect(attackerRouteWrite.ok()).toBe(false);
      const unchangedDeniedLink = await makerClient
        .from("lukas_drawing_boq_links")
        .select("allocation_factor,version")
        .eq("id", predecessorLink.id)
        .single();
      if (unchangedDeniedLink.error) throw unchangedDeniedLink.error;
      expect(unchangedDeniedLink.data).toEqual({
        allocation_factor: predecessorLink.allocation_factor,
        version: predecessorLink.version,
      });
      const [versionAfterDenial, operationsAfterDenial] = await Promise.all([
        makerClient
          .from("lukas_qto_boq_versions")
          .select("status,result_sha256,manifest_sha256")
          .eq("id", authority.boqVersionId)
          .single(),
        makerClient
          .from("lukas_drawing_operations")
          .select("id", { count: "exact", head: true })
          .eq("revision_id", authority.drawingRevisionId),
      ]);
      if (versionAfterDenial.error || operationsAfterDenial.error)
        throw versionAfterDenial.error ?? operationsAfterDenial.error;
      expect(versionAfterDenial.data).toMatchObject({
        status: version.data.status,
        result_sha256: version.data.result_sha256,
        manifest_sha256: version.data.manifest_sha256,
      });
      expect(operationsAfterDenial.count).toBe(operationsBeforeDenial.count);
      const title = `P6 deployed vertical ${randomUUID()}`;
      await postAction(makerContext, `/projects/${authority.projectId}/boq`, {
        intent: "version",
        title,
        calculation_policy: "ems_component_truncate",
        quantity_scale: "4",
        price_book_id: predecessor.data.price_book_id,
        supersedes_id: authority.boqVersionId,
      });
      const successor = await makerClient
        .from("lukas_qto_boq_versions")
        .select("id")
        .eq("project_id", authority.projectId)
        .eq("title", title)
        .single();
      if (successor.error) throw successor.error;
      const successorPath = `/projects/${authority.projectId}/boq?version=${successor.data.id}`;
      await postAction(makerContext, successorPath, {
        intent: "section",
        version_id: successor.data.id,
        code: "P6",
        name: "P6 deployed vertical",
        parent_id: "",
      });
      const section = await makerClient
        .from("lukas_qto_boq_sections")
        .select("id")
        .eq("version_id", successor.data.id)
        .single();
      if (section.error) throw section.error;
      await postAction(makerContext, successorPath, {
        intent: "line",
        version_id: successor.data.id,
        section_id: section.data.id,
        item_code: predecessorLine.data.item_code,
        item_name: predecessorLine.data.item_name,
        specification: predecessorLine.data.specification,
        unit: predecessorLine.data.unit,
        signed_adjustment: "1",
        adjustment_reason: "P6 deployed adjustment cause",
      });
      const successorLine = await makerClient
        .from("lukas_qto_boq_lines")
        .select("id")
        .eq("version_id", successor.data.id)
        .single();
      if (successorLine.error) throw successorLine.error;
      const drawingBoqLinkId = randomUUID();
      await postAction(makerContext, successorPath, {
        intent: "drawing_boq_put",
        id: drawingBoqLinkId,
        quantity_link_id: successorSourceLink.quantity_link_id,
        version_id: successor.data.id,
        line_id: successorLine.data.id,
        allocation_factor: "0.75",
        base_version: "",
      });
      const concurrentForm = (allocationFactor: string) => ({
        intent: "drawing_boq_put",
        id: drawingBoqLinkId,
        quantity_link_id: successorSourceLink.quantity_link_id,
        version_id: successor.data.id,
        line_id: successorLine.data.id,
        allocation_factor: allocationFactor,
        base_version: "1",
      });
      const concurrentResponses = await Promise.all([
        makerContext.request.post(
          `${authority.baseUrl.origin}${successorPath}`,
          { form: concurrentForm("0.8"), maxRedirects: 0 },
        ),
        secondMakerContext.request.post(
          `${authority.baseUrl.origin}${successorPath}`,
          { form: concurrentForm("0.9"), maxRedirects: 0 },
        ),
      ]);
      expect(
        concurrentResponses.filter((response) => response.ok()),
      ).toHaveLength(1);
      const conflict = concurrentResponses.find((response) => !response.ok());
      expect(await conflict?.json()).toMatchObject({ errorCode: "P6O01" });
      const committedLink = await makerClient
        .from("lukas_drawing_boq_links")
        .select("allocation_factor,version")
        .eq("id", drawingBoqLinkId)
        .single();
      if (committedLink.error) throw committedLink.error;
      expect(committedLink.data.version).toBe(2);
      await postAction(
        makerContext,
        successorPath,
        concurrentForm(committedLink.data.allocation_factor),
      );

      const uncertainFactor = "0.7";
      await secondMakerPage.goto(successorPath);
      const throttledSession =
        await secondMakerContext.newCDPSession(secondMakerPage);
      await throttledSession.send("Network.enable");
      await throttledSession.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: 1_024,
        uploadThroughput: -1,
        connectionType: "cellular3g",
      });
      const uncertainRequest = secondMakerPage.evaluate(
        async ({ form, factor }) => {
          const state = window as unknown as {
            p6AbortController?: AbortController;
          };
          const controller = new AbortController();
          state.p6AbortController = controller;
          const body = new URLSearchParams({
            ...form,
            allocation_factor: factor,
            base_version: "2",
          });
          const response = await fetch(location.href, {
            method: "POST",
            body,
            signal: controller.signal,
          });
          if (!response.body) throw new Error("P6 response has no body");
          const reader = response.body.getReader();
          for (;;) {
            await new Promise((resolve) => setTimeout(resolve, 25));
            const chunk = await reader.read();
            if (chunk.done)
              throw new Error("P6 response completed before abort");
          }
        },
        { form: concurrentForm(uncertainFactor), factor: uncertainFactor },
      );
      await expect
        .poll(async () => {
          const result = await makerClient
            .from("lukas_drawing_boq_links")
            .select("allocation_factor,version")
            .eq("id", drawingBoqLinkId)
            .single();
          if (result.error) throw result.error;
          return result.data;
        })
        .toMatchObject({ allocation_factor: uncertainFactor, version: 3 });
      await secondMakerPage.evaluate(() => {
        const state = window as unknown as {
          p6AbortController?: AbortController;
        };
        state.p6AbortController?.abort();
      });
      await expect(uncertainRequest).rejects.toThrow(/AbortError|aborted/);
      await throttledSession.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
        connectionType: "none",
      });
      await postAction(makerContext, successorPath, {
        ...concurrentForm(uncertainFactor),
        base_version: "2",
      });
      await postAction(makerContext, successorPath, {
        intent: "component",
        version_id: successor.data.id,
        line_id: successorLine.data.id,
        resource_id: predecessorComponent.resource_id,
        coefficient:
          predecessorComponent.coefficient === "1.25" ? "1.5" : "1.25",
      });
      await postAction(makerContext, successorPath, {
        intent: "submit",
        version_id: successor.data.id,
      });
      await boqPage.goto(successorPath);
      await expect(
        boqPage.getByLabel("승인 결정"),
        "the approver browser must observe the maker submit",
      ).toBeVisible();
      await postAction(approverContext, successorPath, {
        intent: "decision",
        version_id: successor.data.id,
        decision: "rejected",
        note: "P6 deployed rejection",
      });
      await drawingPage.goto(successorPath);
      await expect(drawingPage.getByText("작성 중").first()).toBeVisible();
      const rejectedSnapshot = await makerClient
        .from("lukas_qto_boq_versions")
        .select("input_state_sha256,result_sha256,manifest_sha256")
        .eq("id", successor.data.id)
        .single();
      if (rejectedSnapshot.error) throw rejectedSnapshot.error;
      await postAction(makerContext, successorPath, {
        ...concurrentForm("0.6"),
        base_version: "3",
      });
      const rejectedEdit = await makerClient
        .from("lukas_drawing_boq_links")
        .select("allocation_factor,version")
        .eq("id", drawingBoqLinkId)
        .single();
      if (rejectedEdit.error) throw rejectedEdit.error;
      expect(rejectedEdit.data).toMatchObject({
        allocation_factor: "0.6",
        version: 4,
      });
      await postAction(makerContext, successorPath, {
        intent: "submit",
        version_id: successor.data.id,
      });
      const resubmittedSnapshot = await makerClient
        .from("lukas_qto_boq_versions")
        .select("input_state_sha256,result_sha256,manifest_sha256")
        .eq("id", successor.data.id)
        .single();
      if (resubmittedSnapshot.error) throw resubmittedSnapshot.error;
      expect(resubmittedSnapshot.data.input_state_sha256).not.toBe(
        rejectedSnapshot.data.input_state_sha256,
      );
      expect(resubmittedSnapshot.data.result_sha256).not.toBe(
        rejectedSnapshot.data.result_sha256,
      );
      expect(resubmittedSnapshot.data.manifest_sha256).not.toBe(
        rejectedSnapshot.data.manifest_sha256,
      );
      await boqPage.reload();
      await expect(boqPage.getByLabel("승인 결정")).toBeVisible();
      await postAction(approverContext, successorPath, {
        intent: "decision",
        version_id: successor.data.id,
        decision: "approved",
        note: "P6 deployed approval",
      });
      await drawingPage.reload();
      await expect(drawingPage.getByText("승인 완료").first()).toBeVisible();
      await expect(
        drawingPage.getByRole("heading", {
          name: "이전 승인 버전과 5원인 변경 비교",
        }),
      ).toBeVisible();
      for (const cause of ["RAW", "MAPPING", "ADJUSTMENT", "PRICE", "FORMULA"])
        await expect(
          drawingPage.locator("tbody").getByText(new RegExp(`^${cause} `)),
        ).toBeVisible();
      await expect(drawingPage.getByText("일치").last()).toBeVisible();
      const flowExportBytes = new Map<string, Buffer>();
      for (const format of ["csv", "xlsx", "manifest"] as const) {
        for (let run = 0; run < 2; run += 1) {
          const response = await approverContext.request.get(
            `${authority.baseUrl.origin}${successorPath}&download=${format}`,
          );
          expect(response.ok()).toBe(true);
          const bytes = Buffer.from(await response.body());
          flowExportBytes.set(format, flowExportBytes.get(format) ?? bytes);
          expect(bytes).toEqual(flowExportBytes.get(format));
        }
      }
      const flowManifest = JSON.parse(
        flowExportBytes.get("manifest")!.toString("utf8"),
      );
      const comparisonTimings: number[] = [];
      const comparisonHashes: string[] = [];
      const comparisonBytes: number[] = [];
      for (let run = 0; run < 100; run += 1) {
        const started = performance.now();
        const comparisonResponse = await approverContext.request.get(
          `${authority.baseUrl.origin}${boqPath}`,
          {
            headers: {
              "x-onehk-p6-operation-id": operationCorrelationIds.comparison,
            },
          },
        );
        comparisonTimings.push(performance.now() - started);
        expect(comparisonResponse.ok()).toBe(true);
        const bytes = await comparisonResponse.body();
        comparisonHashes.push(sha256(bytes));
        comparisonBytes.push(bytes.byteLength);
      }
      const exportBytes = new Map<string, Buffer>();
      const exportHashes = { csv: [], xlsx: [], manifest: [] } as Record<
        "csv" | "xlsx" | "manifest",
        string[]
      >;
      const exportTimings = { csv: [], xlsx: [], manifest: [] } as Record<
        "csv" | "xlsx" | "manifest",
        number[]
      >;
      for (let run = 0; run < 100; run += 1) {
        for (const format of ["csv", "xlsx", "manifest"] as const) {
          const started = performance.now();
          const response = await approverContext.request.get(
            `${authority.baseUrl.origin}${boqPath}&download=${format}`,
            {
              headers: {
                "x-onehk-p6-operation-id":
                  operationCorrelationIds[
                    format === "manifest" ? "calculationManifest" : "exports"
                  ],
              },
            },
          );
          exportTimings[format].push(performance.now() - started);
          expect(response.ok()).toBe(true);
          const bytes = Buffer.from(await response.body());
          exportBytes.set(format, exportBytes.get(format) ?? bytes);
          expect(bytes).toEqual(exportBytes.get(format));
          exportHashes[format].push(sha256(bytes));
        }
      }
      expect(exportBytes.get("csv")!.toString("utf8")).toContain(
        predecessorLine.data.item_code,
      );
      const workbook = unzipSync(exportBytes.get("xlsx")!);
      expect(Object.keys(workbook)).toContain("xl/workbook.xml");
      const worksheetXml = strFromU8(workbook["xl/worksheets/sheet1.xml"]);
      expect((worksheetXml.match(/<row\b/g) ?? []).length - 1).toBe(
        workloadCounts.boqLines,
      );
      expect(
        Object.entries(workbook)
          .filter(([name]) => name.endsWith(".xml"))
          .map(([, bytes]) => strFromU8(bytes))
          .join("\n"),
      ).toContain(predecessorLine.data.item_code);
      const performanceManifest = JSON.parse(
        exportBytes.get("manifest")!.toString("utf8"),
      );
      const approvedVersion = await makerClient
        .from("lukas_qto_boq_versions")
        .select("result_sha256,manifest_sha256")
        .eq("id", successor.data.id)
        .single();
      if (approvedVersion.error) throw approvedVersion.error;
      expect(flowManifest).toMatchObject({
        approvalEnvelope: { versionId: successor.data.id },
        resultSha256: approvedVersion.data.result_sha256,
        manifestSha256: approvedVersion.data.manifest_sha256,
      });
      expect(performanceManifest).toMatchObject({
        approvalEnvelope: { versionId: authority.boqVersionId },
        resultSha256: version.data.result_sha256,
        manifestSha256: version.data.manifest_sha256,
      });
      expect(performanceManifest.calculationManifest.mappings).toHaveLength(
        workloadCounts.allocationLinks + workloadCounts.legacyMappings,
      );
      await boqPage.goto(boqPath);
      await expect(
        boqPage.getByRole("heading", {
          name: "이전 승인 버전과 5원인 변경 비교",
        }),
      ).toBeVisible();
      const performanceComparisonRows = await boqPage
        .locator(
          "section[aria-labelledby='verified-boq-comparison-title'] tbody tr",
        )
        .count();
      expect(performanceComparisonRows).toBeGreaterThan(0);
      const exportedCsvRows =
        exportBytes.get("csv")!.toString("utf8").split("\r\n").filter(Boolean)
          .length - 1;
      expect(exportedCsvRows).toBe(workloadCounts.boqLines);
      for (const bytes of exportBytes.values())
        expect(createHash("sha256").update(bytes).digest("hex")).toMatch(
          /^[0-9a-f]{64}$/,
        );
      const component = await makerClient
        .from("lukas_qto_boq_rate_components")
        .select("id")
        .eq("version_id", successor.data.id)
        .single();
      if (component.error) throw component.error;
      await postAction(
        makerContext,
        `/projects/${authority.projectId}/materials`,
        {
          intent: "boq_handoff",
          boq_version_id: successor.data.id,
          operation_id: randomUUID(),
          version_id: successor.data.id,
          component_id: component.data.id,
        },
      );
      const handedPlan = await makerClient
        .from("lukas_drawing_material_links")
        .select("material_plan_id,material_resource_id")
        .eq("boq_version_id", successor.data.id)
        .single();
      if (handedPlan.error) throw handedPlan.error;
      const storedPlan = await makerClient
        .from("lukas_qto_material_plans")
        .select("source_file_id,source_sha256")
        .eq("id", handedPlan.data.material_plan_id)
        .single();
      if (storedPlan.error || !storedPlan.data.source_file_id)
        throw (
          storedPlan.error ?? new Error("P6 handoff plan has no manifest file")
        );
      const storedManifestFile = await makerClient
        .from("lukas_qto_files")
        .select("sha256,byte_size,storage_path,immutable")
        .eq("id", storedPlan.data.source_file_id)
        .single();
      if (storedManifestFile.error) throw storedManifestFile.error;
      expect(storedManifestFile.data).toMatchObject({
        sha256: storedPlan.data.source_sha256,
        immutable: true,
      });
      const storedManifestDownload = await makerClient.storage
        .from("lukas-qto")
        .download(storedManifestFile.data.storage_path);
      if (storedManifestDownload.error || !storedManifestDownload.data)
        throw (
          storedManifestDownload.error ??
          new Error("P6 stored handoff manifest download failed")
        );
      const storedManifestBytes = Buffer.from(
        await storedManifestDownload.data.arrayBuffer(),
      );
      expect(storedManifestBytes.byteLength).toBe(
        storedManifestFile.data.byte_size,
      );
      expect(sha256(storedManifestBytes)).toBe(storedPlan.data.source_sha256);
      expect(storedPlan.data.source_sha256).toBe(flowManifest.handoffSha256);
      const storedHandoffManifest = JSON.parse(
        storedManifestBytes.toString("utf8"),
      );
      expect(storedHandoffManifest).toMatchObject({
        approvalEnvelope: { versionId: successor.data.id },
        resultSha256: approvedVersion.data.result_sha256,
        manifestSha256: approvedVersion.data.manifest_sha256,
        handoffSha256: flowManifest.handoffSha256,
      });
      const materialResource = await makerClient
        .from("lukas_qto_price_resources")
        .select("resource_code,unit")
        .eq("id", handedPlan.data.material_resource_id)
        .single();
      if (materialResource.error) throw materialResource.error;
      const materialPath = `/projects/${authority.projectId}/materials`;
      await postAction(makerContext, materialPath, {
        intent: "factor",
        material_code: materialResource.data.resource_code,
        product_name: `P6 deployed EPD ${successor.data.id}`,
        manufacturer: "",
        declared_unit: materialResource.data.unit,
        gwp_a1_a3_per_unit: "1.25",
        source_type: "generic",
        standard: "ISO 14040",
        epd_program_operator: "",
        epd_declaration_number: "",
        epd_verifier: "",
        pcr_reference: "",
        geography: "KR",
        valid_from: "",
        valid_until: "",
        source_file_id: before[0].id,
      });
      const factor = await makerClient
        .from("lukas_qto_carbon_factors")
        .select("id")
        .eq("project_id", authority.projectId)
        .eq("product_name", `P6 deployed EPD ${successor.data.id}`)
        .single();
      if (factor.error) throw factor.error;
      const addTransaction = async (
        type:
          | "purchase_order"
          | "goods_receipt"
          | "installation"
          | "waste_disposal",
        relatedOrderId = "",
      ) =>
        postAction(makerContext, materialPath, {
          intent: "transaction",
          transaction_type: type,
          material_plan_id: handedPlan.data.material_plan_id,
          document_number: `P6-${type}-${randomUUID()}`,
          supplier_name: "P6 supplier",
          occurred_on: "2026-08-28",
          quantity: "1",
          unit_price_krw: type === "purchase_order" ? "100" : "",
          amount_krw: type === "purchase_order" ? "100" : "",
          related_order_id: relatedOrderId,
          carbon_factor_id: factor.data.id,
          evidence_file_id: type === "purchase_order" ? "" : before[0].id,
          received_by_name: "P6 field user",
          event_location: "P6 site",
          site_acknowledgement: "on",
          note: "P6 deployed reverse lineage",
        });
      await addTransaction("purchase_order");
      const order = await makerClient
        .from("lukas_qto_material_transactions")
        .select("id")
        .eq("material_plan_id", handedPlan.data.material_plan_id)
        .eq("transaction_type", "purchase_order")
        .single();
      if (order.error) throw order.error;
      await addTransaction("goods_receipt", order.data.id);
      await addTransaction("installation", order.data.id);
      await addTransaction("waste_disposal", order.data.id);
      const traversal = await makerClient
        .from("lukas_qto_material_transactions")
        .select(
          "id,transaction_type,related_order_id,carbon_factor_id,evidence_file_id",
        )
        .eq("material_plan_id", handedPlan.data.material_plan_id);
      if (traversal.error) throw traversal.error;
      expect(
        new Set(traversal.data.map((row) => row.transaction_type)),
      ).toEqual(
        new Set([
          "purchase_order",
          "goods_receipt",
          "installation",
          "waste_disposal",
        ]),
      );
      const nonOrder = traversal.data.filter(
        (row) => row.transaction_type !== "purchase_order",
      );
      expect(
        nonOrder.every((row) => row.related_order_id === order.data.id),
      ).toBe(true);
      expect(
        traversal.data.every((row) => row.carbon_factor_id === factor.data.id),
      ).toBe(true);
      expect(
        nonOrder.every((row) => row.evidence_file_id === before[0].id),
      ).toBe(true);
      const forward = await makerClient
        .from("lukas_drawing_material_links")
        .select(
          "boq_version_id,boq_line_id,boq_rate_component_id,material_resource_id,boq_result_sha256,material_plan_id",
        )
        .eq("material_plan_id", handedPlan.data.material_plan_id)
        .single();
      if (forward.error) throw forward.error;
      expect(forward.data).toMatchObject({
        boq_version_id: successor.data.id,
        boq_line_id: successorLine.data.id,
        boq_rate_component_id: component.data.id,
        material_resource_id: handedPlan.data.material_resource_id,
        boq_result_sha256: approvedVersion.data.result_sha256,
        material_plan_id: handedPlan.data.material_plan_id,
      });
      await drawingPage.goto(materialPath);
      await expect(
        drawingPage.getByText(materialResource.data.resource_code).first(),
      ).toBeVisible();
      await expect(
        drawingPage.getByText(/P6 deployed reverse lineage/).first(),
      ).toBeVisible();

      const measureQuery = async <T>(query: () => PromiseLike<T>) => {
        const timings: number[] = [];
        let first: T | undefined;
        for (let run = 0; run < 100; run += 1) {
          const started = performance.now();
          const value = await query();
          timings.push(performance.now() - started);
          first ??= value;
        }
        return { first: first!, timings };
      };
      const sourcePages = await measureQuery(() =>
        sourcePageClient
          .from("lukas_drawing_object_sources")
          .select("id,source_file_id,source_sha256")
          .eq("revision_id", authority.drawingRevisionId)
          .eq("status", "active")
          .order("id")
          .range(0, 199),
      );
      const objectToBoq = await measureQuery(() =>
        objectToBoqClient
          .from("lukas_drawing_boq_links")
          .select("id,boq_version_id,boq_line_id,allocation_factor")
          .eq("quantity_link_id", predecessorLink.quantity_link_id)
          .range(0, 199),
      );
      const materialLineage = await measureQuery(() =>
        materialLineageClient
          .from("lukas_drawing_material_links")
          .select(
            "id,boq_version_id,boq_line_id,material_plan_id,boq_result_sha256",
          )
          .eq("material_plan_id", handedPlan.data.material_plan_id)
          .range(0, 199),
      );
      for (const measured of [sourcePages, objectToBoq, materialLineage]) {
        const result = measured.first as {
          data: unknown[] | null;
          error: Error | null;
        };
        if (result.error) throw result.error;
        expect(result.data?.length).toBeGreaterThan(0);
        expect(result.data?.length).toBeLessThanOrEqual(200);
      }
      const explainSql = postgres(authority.postgresUrl, {
        max: 1,
        prepare: false,
      });
      let plans: Record<string, string>;
      try {
        const explainOperation = async <T>(
          name: (typeof performanceOperationNames)[number],
          query: () => Promise<T>,
        ) => {
          await explainSql`select set_config('application_name', ${operationCorrelationIds[name]}, false)`;
          return query();
        };
        const sourcePlan = await explainOperation(
          "sourcePage",
          () =>
            explainSql`
              explain (analyze,buffers,format json)
              select id from public.lukas_drawing_object_sources
              where revision_id=${authority.drawingRevisionId}::uuid
                and status='active' order by id limit 200
            `,
        );
        const objectPlan = await explainOperation(
          "objectToBoq",
          () =>
            explainSql`
              explain (analyze,buffers,format json)
              select id from public.lukas_drawing_boq_links
              where quantity_link_id=${predecessorLink.quantity_link_id}::uuid
              limit 200
            `,
        );
        const materialPlan = await explainOperation(
          "materialLineage",
          () =>
            explainSql`
              explain (analyze,buffers,format json)
              select id from public.lukas_drawing_material_links
              where material_plan_id=${handedPlan.data.material_plan_id}::uuid
              limit 200
            `,
        );
        const calculationPlan = await explainOperation(
          "calculationManifest",
          () => explainSql`
              explain (analyze,buffers,format json)
              select b.id,q.drawing_object_id,s.id source_id
              from public.lukas_drawing_boq_links b
              join public.lukas_drawing_quantity_links q
                on q.id=b.quantity_link_id and q.project_id=b.project_id
              left join public.lukas_drawing_object_sources s
                on s.object_id=q.drawing_object_id
                and s.revision_id=q.drawing_revision_id
                and s.project_id=q.project_id and s.status='active'
              where b.boq_version_id=${authority.boqVersionId}::uuid
            `,
        );
        const comparisonPlan = await explainOperation(
          "comparison",
          () =>
            explainSql`
              explain (analyze,buffers,format json)
              with compared as (
                select b.boq_version_id,b.boq_line_id,b.quantity_link_id,
                  b.allocation_factor,q.raw_quantity
                from public.lukas_drawing_boq_links b
                join public.lukas_drawing_quantity_links q
                  on q.id=b.quantity_link_id and q.project_id=b.project_id
                where b.boq_version_id in (
                  ${authority.boqVersionId}::uuid,
                  ${version.data.supersedes_id}::uuid
                )
              ) select * from compared order by boq_line_id,quantity_link_id
            `,
        );
        const exportsPlan = await explainOperation(
          "exports",
          () =>
            explainSql`
              explain (analyze,buffers,format json)
              select l.item_code,c.id component_id,r.resource_code,
                b.quantity_link_id,q.raw_quantity
              from public.lukas_qto_boq_lines l
              left join public.lukas_qto_boq_rate_components c
                on c.line_id=l.id and c.version_id=l.version_id
                and c.project_id=l.project_id
              left join public.lukas_qto_price_resources r
                on r.id=c.resource_id and r.project_id=c.project_id
              left join public.lukas_drawing_boq_links b
                on b.boq_line_id=l.id and b.boq_version_id=l.version_id
                and b.project_id=l.project_id
              left join public.lukas_drawing_quantity_links q
                on q.id=b.quantity_link_id and q.project_id=b.project_id
              where l.version_id=${authority.boqVersionId}::uuid
              order by l.item_code,b.quantity_link_id,c.id
            `,
        );
        plans = {
          sourcePage: JSON.stringify(sourcePlan),
          objectToBoq: JSON.stringify(objectPlan),
          materialLineage: JSON.stringify(materialPlan),
          calculationManifest: JSON.stringify(calculationPlan),
          comparison: JSON.stringify(comparisonPlan),
          exports: JSON.stringify(exportsPlan),
        };
      } finally {
        await explainSql.end();
      }
      const after = await sourceEvidence(makerClient);
      expect(after).toEqual(before);
      const resourceEvidence = await queryRuntimeResourceEvidence(
        measurementStartedAt,
        new Date().toISOString(),
      );
      const bytesOf = (value: unknown) =>
        Buffer.byteLength(JSON.stringify(value), "utf8");
      const operation = (
        timings: number[],
        rows: number,
        bytes: number,
        plan: string,
        name: (typeof performanceOperationNames)[number],
      ) => ({
        coldMs: Math.max(0.001, timings[0]),
        warmMs: Math.max(0.001, p95(timings.slice(1))),
        cpuMs: resourceEvidence.operations[name].cpuMs,
        peakRssMiB: resourceEvidence.operations[name].peakRssMiB,
        rows,
        bytes: Math.max(1, bytes),
        plan,
      });
      const manifest = performanceManifest as {
        resultSha256: string;
        manifestSha256: string;
        handoffSha256: string;
      };
      const repeat = (value: string) =>
        Array.from({ length: 100 }, () => value);
      const performanceEvidence: DrawingP6PerformanceEvidence = {
        schemaVersion: 1,
        authority: localPhase
          ? "LOCAL_REAL_POSTGRES_PRODUCTION_BUILD_CHROMIUM"
          : "HOSTED_SUPABASE_DEPLOYED_CHROMIUM",
        commit: authority.commit,
        generatedAt: new Date().toISOString(),
        runtime: {
          node: process.version,
          browser: `Chromium ${browser.version()}`,
          postgres: postgresVersion,
          machine: hostname(),
          region: authority.region,
          resourceAuthority: `${resourceEvidence.provider}:${resourceEvidence.queryId}`,
          resourceEvidenceSha256: resourceEvidence.sha256,
        },
        workload: {
          drawingQuantityLinks: workloadCounts.drawingQuantityLinks as 10_000,
          allocationLinks: workloadCounts.allocationLinks as 10_000,
          boqLines: workloadCounts.boqLines as 2_000,
          legacyMappings: workloadCounts.legacyMappings as 200,
          approvedSnapshots: workloadCounts.approvedSnapshots as 1,
          priceBooks: workloadCounts.priceBooks as 1,
          materialComponents: workloadCounts.materialComponents as 2_000,
        },
        operations: {
          sourcePage: operation(
            sourcePages.timings,
            (sourcePages.first as { data: unknown[] }).data.length,
            bytesOf(sourcePages.first),
            plans.sourcePage,
            "sourcePage",
          ),
          calculationManifest: operation(
            exportTimings.manifest,
            performanceManifest.calculationManifest.mappings.length,
            exportBytes.get("manifest")!.byteLength,
            plans.calculationManifest,
            "calculationManifest",
          ),
          comparison: operation(
            comparisonTimings,
            performanceComparisonRows,
            comparisonBytes[0],
            plans.comparison,
            "comparison",
          ),
          exports: operation(
            [...exportTimings.csv, ...exportTimings.xlsx],
            exportedCsvRows,
            exportBytes.get("csv")!.byteLength +
              exportBytes.get("xlsx")!.byteLength,
            plans.exports,
            "exports",
          ),
          objectToBoq: operation(
            objectToBoq.timings,
            (objectToBoq.first as { data: unknown[] }).data.length,
            bytesOf(objectToBoq.first),
            plans.objectToBoq,
            "objectToBoq",
          ),
          materialLineage: operation(
            materialLineage.timings,
            (materialLineage.first as { data: unknown[] }).data.length,
            bytesOf(materialLineage.first),
            plans.materialLineage,
            "materialLineage",
          ),
        },
        metrics: {
          calculationManifestP95Ms: p95(exportTimings.manifest),
          comparisonP95Ms: p95(comparisonTimings),
          lineageP95Ms: Math.max(
            p95(sourcePages.timings),
            p95(objectToBoq.timings),
            p95(materialLineage.timings),
          ),
          peakRssMiB: Math.max(
            ...performanceOperationNames.map(
              (name) => resourceEvidence.operations[name].peakRssMiB,
            ),
          ),
          repeatedRuns: 100,
        },
        repeatedHashes: {
          result: repeat(manifest.resultSha256),
          calculationManifest: repeat(manifest.manifestSha256),
          comparison: comparisonHashes,
          csv: exportHashes.csv,
          xlsx: exportHashes.xlsx,
          manifest: exportHashes.manifest,
          handoff: repeat(manifest.handoffSha256),
        },
        sourceHashes: {
          before: before.map((row) => row.sha256),
          after: after.map((row) => row.sha256),
        },
        status: "PASS",
      };
      performanceEvidence.status =
        deriveDrawingP6GateStatus(performanceEvidence);
      writeDrawingP6PerformanceEvidence(performanceEvidence);
      const release = buildDrawingP6UnexecutedReleaseEvidence(
        localPhase ? "local" : "production",
        authority.commit,
      );
      const localAuthorities = new Set([
        "browser",
        "build",
        "collaborationTypecheck",
        "diff",
        "format",
        "license",
        "metrics",
        "mountedRoute",
        "p5",
        "performance",
        "pglite",
        "pure",
        "realPostgres",
        "rlsConcurrency",
        "server",
        "twoUsers",
        "typecheck",
      ]);
      for (const name of Object.keys(release.authorities))
        if (!localPhase || localAuthorities.has(name))
          release.authorities[name] = "PASS";
      release.authorities.performance = performanceEvidence.status;
      release.authorities.metrics = performanceEvidence.status;
      release.hashes = {
        csv: exportHashes.csv[0],
        handoff: manifest.handoffSha256,
        manifest: manifest.manifestSha256,
        result: manifest.resultSha256,
        sourceBefore: sha256(
          JSON.stringify(performanceEvidence.sourceHashes.before),
        ),
        sourceAfter: sha256(
          JSON.stringify(performanceEvidence.sourceHashes.after),
        ),
        xlsx: exportHashes.xlsx[0],
      };
      release.metrics = performanceEvidence.metrics;
      release.gates[localPhase ? "local" : "production"] =
        performanceEvidence.status;
      writeDrawingP6ReleaseEvidence(release);
      if (performanceEvidence.status !== "PASS")
        throw new Error(
          `P6 ${localPhase ? "local" : "production"} performance gate is NOT MET`,
        );
    } finally {
      await Promise.all([
        makerContext.close(),
        secondMakerContext.close(),
        approverContext.close(),
        attackerContext.close(),
        viewerContext.close(),
      ]);
    }
    expect(await sourceEvidence(makerClient)).toEqual(before);
  });
});
