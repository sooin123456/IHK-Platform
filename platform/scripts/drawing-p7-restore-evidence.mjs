import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
export const DRAWING_P7_RESTORE_EVIDENCE_PATH = resolve(
  here,
  "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-5-restore-evidence.json",
);
const DOMAINS = [
  "schema",
  "database",
  "storage",
  "yjs",
  "approvals",
  "lineage",
];
const APPROVAL_TABLES = [
  "lukas_drawing_revision_approvals",
  "lukas_drawing_issue_approvals",
  "lukas_qto_boq_approvals",
];
const LINEAGE_TABLES = [
  "lukas_drawing_quantity_links",
  "lukas_drawing_boq_links",
  "lukas_drawing_material_links",
  "lukas_qto_boq_versions",
  "lukas_qto_boq_sections",
  "lukas_qto_boq_lines",
  "lukas_qto_boq_quantity_mappings",
  "lukas_qto_material_plans",
  "lukas_qto_material_transactions",
];

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`UNEXECUTED: missing ${name}`);
  return value;
}

function hostedPostgres(value, projectRef, name) {
  const url = new URL(value);
  if (
    !/^postgres(ql)?:$/.test(url.protocol) ||
    !url.hostname.endsWith(".supabase.co")
  )
    throw new Error(
      `UNEXECUTED: ${name} must be a hosted Supabase PostgreSQL URL`,
    );
  if (!url.hostname.includes(projectRef))
    throw new Error(`UNEXECUTED: ${name} does not identify ${projectRef}`);
  return value;
}

function timestamp(value, name) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`UNEXECUTED: invalid ${name}`);
  return new Date(time).toISOString();
}

export function requireManagedRestoreAuthority(environment = process.env) {
  const managementAccessToken = required(
    environment,
    "P7_RESTORE_MANAGEMENT_ACCESS_TOKEN",
  );
  const sourceProjectRef = required(
    environment,
    "P7_RESTORE_SOURCE_PROJECT_REF",
  );
  const targetProjectRef = required(
    environment,
    "P7_RESTORE_TARGET_PROJECT_REF",
  );
  if (
    !/^[a-z0-9]{20}$/.test(sourceProjectRef) ||
    !/^[a-z0-9]{20}$/.test(targetProjectRef)
  )
    throw new Error("UNEXECUTED: invalid Supabase project reference");
  if (sourceProjectRef === targetProjectRef)
    throw new Error(
      "UNEXECUTED: isolated restore project must differ from source",
    );
  const organizationId = required(environment, "P7_RESTORE_ORGANIZATION_ID");
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(organizationId))
    throw new Error("UNEXECUTED: invalid P7_RESTORE_ORGANIZATION_ID");
  const sourceCommit = required(environment, "P7_RESTORE_COMMIT");
  if (!/^[0-9a-f]{40}$/.test(sourceCommit))
    throw new Error("UNEXECUTED: invalid P7_RESTORE_COMMIT");
  const sourceSupabaseUrl = required(
    environment,
    "P7_RESTORE_SOURCE_SUPABASE_URL",
  );
  const targetSupabaseUrl = required(
    environment,
    "P7_RESTORE_TARGET_SUPABASE_URL",
  );
  if (sourceSupabaseUrl !== `https://${sourceProjectRef}.supabase.co`)
    throw new Error("UNEXECUTED: source Supabase URL/ref mismatch");
  if (targetSupabaseUrl !== `https://${targetProjectRef}.supabase.co`)
    throw new Error("UNEXECUTED: target Supabase URL/ref mismatch");
  return {
    organizationId,
    sourceProjectRef,
    targetProjectRef,
    backupId: required(environment, "P7_RESTORE_BACKUP_ID"),
    managementAccessToken,
    sourcePostgresUrl: hostedPostgres(
      required(environment, "P7_RESTORE_SOURCE_POSTGRES_URL"),
      sourceProjectRef,
      "P7_RESTORE_SOURCE_POSTGRES_URL",
    ),
    targetPostgresUrl: hostedPostgres(
      required(environment, "P7_RESTORE_TARGET_POSTGRES_URL"),
      targetProjectRef,
      "P7_RESTORE_TARGET_POSTGRES_URL",
    ),
    sourceSupabaseUrl,
    targetSupabaseUrl,
    sourceServiceKey: required(
      environment,
      "P7_RESTORE_SOURCE_SERVICE_ROLE_KEY",
    ),
    targetServiceKey: required(
      environment,
      "P7_RESTORE_TARGET_SERVICE_ROLE_KEY",
    ),
    sourceCommit,
  };
}

export function buildUnexecutedRestoreEvidence(
  sourceCommit = null,
  missing = [],
) {
  return {
    schemaVersion: 1,
    status: "UNEXECUTED",
    sourceCommit,
    provider: { status: "UNEXECUTED", backupId: null, restoreProjectRef: null },
    comparison: { status: "UNEXECUTED", mismatches: DOMAINS },
    rpoSeconds: null,
    rtoSeconds: null,
    missingAuthorities: missing,
    recordedAt: new Date().toISOString(),
  };
}

export function compareRestoreSnapshots(source, target) {
  const mismatches = DOMAINS.filter(
    (domain) =>
      source?.[domain]?.count !== target?.[domain]?.count ||
      source?.[domain]?.digest !== target?.[domain]?.digest ||
      source?.[domain]?.integrity === false ||
      target?.[domain]?.integrity === false,
  );
  return { status: mismatches.length ? "NOT MET" : "PASS", mismatches };
}

function normalizeBackups(value) {
  return Array.isArray(value) ? value : (value?.backups ?? value?.data ?? []);
}

export async function runManagedRestoreComparison(authority, adapters) {
  const checkedOutCommit = await adapters.getSourceCommit();
  if (checkedOutCommit !== authority.sourceCommit)
    throw new Error(
      "UNEXECUTED: P7 restore commit does not match the checkout",
    );
  const backups = normalizeBackups(
    await adapters.listBackups(
      authority.sourceProjectRef,
      authority.managementAccessToken,
    ),
  );
  const backup = backups.find(
    (candidate) => String(candidate.id) === authority.backupId,
  );
  const backupCreatedAt = backup?.inserted_at ?? backup?.created_at;
  const restoreProject = await adapters.getProject(
    authority.targetProjectRef,
    authority.managementAccessToken,
  );
  const restoreCreatedAt = restoreProject?.created_at;
  const measuredAt = timestamp(adapters.now(), "restore measurement time");
  const providerIdentityPass =
    backup?.status === "COMPLETED" &&
    backup?.is_physical_backup === true &&
    Boolean(backupCreatedAt) &&
    typeof restoreProject?.id === "string" &&
    restoreProject.id.length > 0 &&
    restoreProject.id !== authority.targetProjectRef &&
    restoreProject?.ref === authority.targetProjectRef &&
    ["ACTIVE_HEALTHY", "ACTIVE"].includes(restoreProject?.status) &&
    Boolean(restoreCreatedAt) &&
    Date.parse(restoreCreatedAt) >= Date.parse(backupCreatedAt) &&
    Date.parse(measuredAt) >= Date.parse(restoreCreatedAt);
  const [sourceDatabase, targetDatabase, sourceStorage, targetStorage] =
    await Promise.all([
      adapters.captureDatabase("source", authority),
      adapters.captureDatabase("target", authority),
      adapters.captureStorage("source", authority),
      adapters.captureStorage("target", authority),
    ]);
  const source = { ...sourceDatabase, storage: sourceStorage };
  const target = { ...targetDatabase, storage: targetStorage };
  const providerPass =
    providerIdentityPass &&
    typeof source.systemIdentifier === "string" &&
    source.systemIdentifier.length > 0 &&
    source.systemIdentifier === target.systemIdentifier;
  const comparison = compareRestoreSnapshots(source, target);
  const rpoSeconds =
    backupCreatedAt && restoreCreatedAt
      ? Math.max(
          0,
          Math.round(
            (Date.parse(restoreCreatedAt) - Date.parse(backupCreatedAt)) / 1000,
          ),
        )
      : null;
  const rtoSeconds = restoreCreatedAt
    ? Math.max(
        0,
        Math.round(
          (Date.parse(measuredAt) - Date.parse(restoreCreatedAt)) / 1000,
        ),
      )
    : null;
  const evidence = {
    schemaVersion: 1,
    status: providerPass && comparison.status === "PASS" ? "PASS" : "NOT MET",
    sourceCommit: authority.sourceCommit,
    organizationId: authority.organizationId,
    provider: {
      status: providerPass ? "VERIFIED" : "NOT MET",
      sourceProjectRef: authority.sourceProjectRef,
      backupId: backup?.id ?? null,
      backupStatus: backup?.status ?? null,
      backupCreatedAt: backupCreatedAt ?? null,
      restoreId: restoreProject?.id ?? null,
      restoreProjectRef: restoreProject?.ref ?? null,
      restoreStatus: restoreProject?.status ?? null,
      restoreCreatedAt: restoreCreatedAt ?? null,
      physicalClusterSystemIdentifier: providerPass
        ? source.systemIdentifier
        : null,
    },
    source,
    target,
    comparison,
    rpoSeconds,
    rtoSeconds,
    measuredAt,
  };
  await adapters.record(evidence, authority);
  return evidence;
}

async function managementGet(path, token) {
  const response = await fetch(`https://api.supabase.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok)
    throw new Error(`UNEXECUTED: Supabase Management API ${response.status}`);
  return response.json();
}

function canonicalRows(rows) {
  return rows.map((row) => JSON.stringify(row)).sort();
}

async function rowsForTables(sql, schema, tables) {
  const rows = [];
  for (const table of tables) {
    const exists =
      await sql`select to_regclass(${`${schema}.${table}`})::text as name`;
    if (!exists[0]?.name) continue;
    const values = await sql`
      select to_jsonb(t) as row from ${sql(schema)}.${sql(table)} t
      order by to_jsonb(t)::text`;
    for (const value of values)
      rows.push(`${schema}.${table}:${JSON.stringify(value.row)}`);
  }
  return rows.sort();
}

async function captureDatabaseUrl(url) {
  const sql = postgres(url, { max: 1, idle_timeout: 2, connect_timeout: 15 });
  try {
    const schemaRows = await sql`
      select kind,identity,definition from (
        select 'column' kind,
          n.nspname||'.'||c.relname||'.'||a.attname identity,
          pg_catalog.format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text definition
        from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid
        join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname in('public','private') and a.attnum>0 and not a.attisdropped
        union all
        select 'constraint',n.nspname||'.'||c.relname||'.'||con.conname,
          pg_catalog.pg_get_constraintdef(con.oid,true)
        from pg_catalog.pg_constraint con join pg_catalog.pg_class c on c.oid=con.conrelid
        join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname in('public','private')
        union all
        select 'function',n.nspname||'.'||p.proname||'('||
          pg_catalog.pg_get_function_identity_arguments(p.oid)||')',
          pg_catalog.pg_get_functiondef(p.oid)
        from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where n.nspname in('public','private') and p.prokind='f'
        union all
        select 'policy',schemaname||'.'||tablename||'.'||policyname,
          coalesce(cmd,'')||':'||coalesce(qual,'')||':'||coalesce(with_check,'')
        from pg_catalog.pg_policies where schemaname in('public','private')
      ) catalog order by kind,identity`;
    const applicationTables = await sql`
      select tablename from pg_catalog.pg_tables
      where schemaname='public'
        and (tablename like 'lukas_qto_%' or tablename like 'lukas_drawing_%')
      order by tablename`;
    const [control] = await sql`
      select system_identifier::text system_identifier
      from pg_catalog.pg_control_system()`;
    const data = await rowsForTables(
      sql,
      "public",
      applicationTables.map((row) => row.tablename),
    );
    const yjs = await rowsForTables(sql, "private", [
      "lukas_drawing_collaboration_states",
    ]);
    const approvals = await rowsForTables(sql, "public", APPROVAL_TABLES);
    const lineage = await rowsForTables(sql, "public", LINEAGE_TABLES);
    const summary = (rows) => ({
      count: rows.length,
      digest: digest(rows.join("\n")),
    });
    return {
      systemIdentifier: control?.system_identifier ?? null,
      schema: summary(canonicalRows(schemaRows)),
      database: summary(data),
      yjs: summary(yjs),
      approvals: summary(approvals),
      lineage: summary(lineage),
    };
  } finally {
    await sql.end();
  }
}

async function captureStorageUrl(postgresUrl, supabaseUrl, serviceKey) {
  const sql = postgres(postgresUrl, {
    max: 1,
    idle_timeout: 2,
    connect_timeout: 15,
  });
  try {
    const files = await sql`
      select storage_path,sha256,byte_size from public.lukas_qto_files
      where immutable order by storage_path,id`;
    const verified = [];
    let integrity = true;
    for (const file of files) {
      const response = await fetch(
        `${supabaseUrl}/storage/v1/object/authenticated/lukas-qto/${file.storage_path
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
        {
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
          },
        },
      );
      if (response.status === 404) {
        integrity = false;
        verified.push(
          `${file.storage_path}:${file.sha256}:${file.byte_size}:MISSING:0`,
        );
        continue;
      }
      if (!response.ok)
        throw new Error(`UNEXECUTED: storage authority ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const actual = digest(bytes);
      if (actual !== file.sha256 || bytes.byteLength !== Number(file.byte_size))
        integrity = false;
      verified.push(
        `${file.storage_path}:${file.sha256}:${file.byte_size}:${actual}:${bytes.byteLength}`,
      );
    }
    return {
      count: verified.length,
      digest: digest(verified.join("\n")),
      integrity,
    };
  } finally {
    await sql.end();
  }
}

async function recordEvidence(evidence, authority) {
  const body = JSON.stringify(evidence);
  const result = await fetch(
    `${authority.sourceSupabaseUrl}/rest/v1/rpc/lukas_qto_record_restore_run`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authority.sourceServiceKey}`,
        apikey: authority.sourceServiceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_organization_id: authority.organizationId,
        p_source_project_ref: authority.sourceProjectRef,
        p_provider_backup_id: evidence.provider.backupId,
        p_provider_backup_created_at: evidence.provider.backupCreatedAt,
        p_provider_restore_project_ref: evidence.provider.restoreProjectRef,
        p_provider_restore_created_at: evidence.provider.restoreCreatedAt,
        p_source_commit: authority.sourceCommit,
        p_schema_sha256: evidence.source.schema.digest,
        p_database_sha256: evidence.source.database.digest,
        p_storage_sha256: evidence.source.storage.digest,
        p_yjs_sha256: evidence.source.yjs.digest,
        p_approval_sha256: evidence.source.approvals.digest,
        p_lineage_sha256: evidence.source.lineage.digest,
        p_evidence_sha256: digest(body),
        p_rpo_seconds: evidence.rpoSeconds,
        p_rto_seconds: evidence.rtoSeconds,
        p_status: evidence.status,
      }),
    },
  );
  if (!result.ok)
    throw new Error(`NOT MET: restore evidence record ${result.status}`);
}

export const realRestoreAdapters = {
  getSourceCommit: async () =>
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: resolve(here, ".."),
      encoding: "utf8",
    }).trim(),
  now: () => new Date().toISOString(),
  listBackups: (projectRef, token) =>
    managementGet(`/v1/projects/${projectRef}/database/backups`, token),
  getProject: (projectRef, token) =>
    managementGet(`/v1/projects/${projectRef}`, token),
  captureDatabase: (side, authority) =>
    captureDatabaseUrl(
      side === "source"
        ? authority.sourcePostgresUrl
        : authority.targetPostgresUrl,
    ),
  captureStorage: (side, authority) =>
    captureStorageUrl(
      side === "source"
        ? authority.sourcePostgresUrl
        : authority.targetPostgresUrl,
      side === "source"
        ? authority.sourceSupabaseUrl
        : authority.targetSupabaseUrl,
      side === "source"
        ? authority.sourceServiceKey
        : authority.targetServiceKey,
    ),
  record: recordEvidence,
};

async function writeEvidence(value) {
  await mkdir(dirname(DRAWING_P7_RESTORE_EVIDENCE_PATH), { recursive: true });
  await writeFile(
    DRAWING_P7_RESTORE_EVIDENCE_PATH,
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

async function main() {
  let authority;
  try {
    authority = requireManagedRestoreAuthority();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const evidence = buildUnexecutedRestoreEvidence(
      process.env.P7_RESTORE_COMMIT ?? null,
      [message],
    );
    await writeEvidence(evidence);
    console.error(message);
    process.exitCode = 2;
    return;
  }
  try {
    const evidence = await runManagedRestoreComparison(
      authority,
      realRestoreAdapters,
    );
    await writeEvidence(evidence);
    if (evidence.status !== "PASS") process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const evidence = buildUnexecutedRestoreEvidence(authority.sourceCommit, [
      message,
    ]);
    await writeEvidence(evidence);
    console.error(message);
    process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
