import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

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
const PROJECT_REF = /^[a-z0-9]{20}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function providerTimestamp(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
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
  const requestId = required(environment, "P7_RESTORE_REQUEST_ID");
  if (!UUID.test(requestId))
    throw new Error("UNEXECUTED: invalid P7_RESTORE_REQUEST_ID");
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
    requestId,
    drillStartedAt: timestamp(
      required(environment, "P7_RESTORE_DRILL_STARTED_AT"),
      "P7_RESTORE_DRILL_STARTED_AT",
    ),
  };
}

export function buildUnexecutedRestoreEvidence(
  sourceCommit = null,
  missing = [],
) {
  return {
    schemaVersion: 2,
    status: "UNEXECUTED",
    sourceCommit: /^[0-9a-f]{40}$/.test(sourceCommit ?? "")
      ? sourceCommit
      : null,
    requestId: null,
    organizationId: null,
    provider: {
      sourceProjectRef: null,
      targetProjectRef: null,
      backupId: null,
      backupStatus: null,
      backupIsPhysical: null,
      backupCreatedAt: null,
      restoreProjectId: null,
      restoreProjectRef: null,
      restoreStatus: null,
      restoreCreatedAt: null,
      correlation: {
        status: "UNEXECUTED",
        physicalClusterSystemIdentifier: null,
      },
      directBinding: { status: "UNEXECUTED", authority: null },
    },
    source: null,
    target: null,
    comparison: { status: "UNEXECUTED", mismatches: DOMAINS },
    rpoSeconds: null,
    rtoSeconds: null,
    drillStartedAt: null,
    measuredAt: null,
    missingAuthorities: missing.length
      ? missing
      : ["managed restore authorities unavailable"],
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

export function classifyDrawingP7RestoreFailure(error, sourceCommit) {
  const message = error instanceof Error ? error.message : String(error);
  if (error !== null && typeof error === "object" && "restoreEvidence" in error)
    return {
      evidence: inspectDrawingP7RestoreEvidence(error.restoreEvidence),
      message,
      exitCode: 1,
    };
  return {
    evidence: buildUnexecutedRestoreEvidence(sourceCommit, [message]),
    message,
    exitCode: 2,
  };
}

function exactKeys(value, keys, name) {
  assert.equal(
    value !== null && typeof value === "object" && !Array.isArray(value),
    true,
    `${name} object`,
  );
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${name} keys`);
}

function inspectIso(value, name) {
  assert.equal(typeof value, "string", `${name} string`);
  assert.equal(new Date(Date.parse(value)).toISOString(), value, `${name} ISO`);
  return Date.parse(value);
}

function inspectDigest(value, domain) {
  const keys =
    domain === "storage"
      ? ["count", "digest", "integrity"]
      : ["count", "digest"];
  exactKeys(value, keys, domain);
  assert.equal(Number.isSafeInteger(value.count) && value.count >= 0, true);
  assert.match(value.digest, SHA256);
  if (domain === "storage") assert.equal(typeof value.integrity, "boolean");
}

function inspectSnapshot(value, name) {
  exactKeys(value, ["systemIdentifier", ...DOMAINS], name);
  assert.equal(
    value.systemIdentifier === null ||
      (typeof value.systemIdentifier === "string" &&
        value.systemIdentifier.length > 0),
    true,
    `${name} system identifier`,
  );
  for (const domain of DOMAINS) inspectDigest(value[domain], domain);
}

function providerCorrelation(provider, source, target, ordered) {
  const sameSystem =
    typeof source.systemIdentifier === "string" &&
    source.systemIdentifier.length > 0 &&
    source.systemIdentifier === target.systemIdentifier;
  const matched =
    provider.backupStatus === "COMPLETED" &&
    provider.backupIsPhysical &&
    typeof provider.restoreProjectId === "string" &&
    provider.restoreProjectId !== provider.targetProjectRef &&
    provider.targetProjectRef !== provider.sourceProjectRef &&
    provider.restoreProjectRef === provider.targetProjectRef &&
    ["ACTIVE_HEALTHY", "ACTIVE"].includes(provider.restoreStatus) &&
    ordered &&
    sameSystem;
  return {
    status: matched ? "MATCHED" : "NOT MET",
    physicalClusterSystemIdentifier: sameSystem
      ? source.systemIdentifier
      : null,
  };
}

export function inspectDrawingP7RestoreEvidence(evidence) {
  exactKeys(
    evidence,
    [
      "schemaVersion",
      "status",
      "sourceCommit",
      "requestId",
      "organizationId",
      "provider",
      "source",
      "target",
      "comparison",
      "rpoSeconds",
      "rtoSeconds",
      "drillStartedAt",
      "measuredAt",
      "missingAuthorities",
      "recordedAt",
    ],
    "restore evidence",
  );
  assert.equal(evidence.schemaVersion, 2);
  inspectIso(evidence.recordedAt, "recordedAt");
  assert.equal(Array.isArray(evidence.missingAuthorities), true);
  for (const item of evidence.missingAuthorities)
    assert.equal(typeof item === "string" && item.length > 0, true);
  exactKeys(
    evidence.provider,
    [
      "sourceProjectRef",
      "targetProjectRef",
      "backupId",
      "backupStatus",
      "backupIsPhysical",
      "backupCreatedAt",
      "restoreProjectId",
      "restoreProjectRef",
      "restoreStatus",
      "restoreCreatedAt",
      "correlation",
      "directBinding",
    ],
    "provider",
  );
  exactKeys(
    evidence.provider.correlation,
    ["status", "physicalClusterSystemIdentifier"],
    "provider correlation",
  );
  exactKeys(
    evidence.provider.directBinding,
    ["status", "authority"],
    "provider direct binding",
  );
  exactKeys(evidence.comparison, ["status", "mismatches"], "comparison");

  if (evidence.source === null || evidence.target === null) {
    assert.equal(evidence.source, null);
    assert.equal(evidence.target, null);
    assert.equal(evidence.status, "UNEXECUTED");
    assert.equal(
      evidence.sourceCommit === null ||
        /^[0-9a-f]{40}$/.test(evidence.sourceCommit),
      true,
    );
    assert.equal(evidence.requestId, null);
    assert.equal(evidence.organizationId, null);
    assert.equal(evidence.drillStartedAt, null);
    assert.equal(evidence.measuredAt, null);
    assert.equal(evidence.rpoSeconds, null);
    assert.equal(evidence.rtoSeconds, null);
    assert.equal(evidence.provider.correlation.status, "UNEXECUTED");
    assert.equal(
      evidence.provider.correlation.physicalClusterSystemIdentifier,
      null,
    );
    assert.equal(evidence.provider.directBinding.status, "UNEXECUTED");
    assert.equal(evidence.provider.directBinding.authority, null);
    for (const [key, value] of Object.entries(evidence.provider))
      if (!["correlation", "directBinding"].includes(key))
        assert.equal(value, null);
    assert.deepEqual(evidence.comparison, {
      status: "UNEXECUTED",
      mismatches: DOMAINS,
    });
    assert.equal(evidence.missingAuthorities.length > 0, true);
    return evidence;
  }

  assert.match(evidence.sourceCommit, /^[0-9a-f]{40}$/);
  assert.match(evidence.requestId, UUID);
  assert.match(evidence.organizationId, UUID);
  assert.deepEqual(evidence.missingAuthorities, []);
  inspectSnapshot(evidence.source, "source snapshot");
  inspectSnapshot(evidence.target, "target snapshot");
  const provider = evidence.provider;
  assert.match(provider.sourceProjectRef, PROJECT_REF);
  assert.match(provider.targetProjectRef, PROJECT_REF);
  assert.equal(
    typeof provider.backupId === "string" && provider.backupId.length > 0,
    true,
  );
  assert.equal(
    provider.backupStatus === null || typeof provider.backupStatus === "string",
    true,
  );
  assert.equal(typeof provider.backupIsPhysical, "boolean");
  assert.equal(
    provider.restoreProjectId === null ||
      (typeof provider.restoreProjectId === "string" &&
        provider.restoreProjectId.length > 0),
    true,
  );
  assert.equal(
    provider.restoreProjectRef === null ||
      (typeof provider.restoreProjectRef === "string" &&
        provider.restoreProjectRef.length > 0),
    true,
  );
  assert.equal(
    provider.restoreStatus === null ||
      typeof provider.restoreStatus === "string",
    true,
  );
  const drill = inspectIso(evidence.drillStartedAt, "drillStartedAt");
  const measured = inspectIso(evidence.measuredAt, "measuredAt");
  const backup =
    provider.backupCreatedAt === null
      ? null
      : inspectIso(provider.backupCreatedAt, "backupCreatedAt");
  const restore =
    provider.restoreCreatedAt === null
      ? null
      : inspectIso(provider.restoreCreatedAt, "restoreCreatedAt");
  const ordered =
    backup !== null &&
    restore !== null &&
    backup <= drill &&
    drill <= restore &&
    restore <= measured;
  assert.equal(
    evidence.rpoSeconds,
    ordered ? Math.round((drill - backup) / 1000) : null,
  );
  assert.equal(
    evidence.rtoSeconds,
    ordered ? Math.round((measured - drill) / 1000) : null,
  );

  const compared = compareRestoreSnapshots(evidence.source, evidence.target);
  assert.deepEqual(evidence.comparison.mismatches, compared.mismatches);
  assert.equal(
    evidence.comparison.status,
    compared.status === "NOT MET" ? "NOT MET" : "UNEXECUTED",
  );
  const correlation = providerCorrelation(
    provider,
    evidence.source,
    evidence.target,
    ordered,
  );
  assert.deepEqual(provider.correlation, correlation);
  assert.equal(provider.directBinding.status, "UNEXECUTED");
  assert.equal(provider.directBinding.authority, null);
  assert.equal(
    evidence.status,
    compared.status === "NOT MET" || correlation.status === "NOT MET"
      ? "NOT MET"
      : "UNEXECUTED",
  );
  return evidence;
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
  const backupCreatedAt = providerTimestamp(
    backup?.inserted_at ?? backup?.created_at,
  );
  const restoreProject = await adapters.getProject(
    authority.targetProjectRef,
    authority.managementAccessToken,
  );
  const restoreCreatedAt = providerTimestamp(restoreProject?.created_at);
  const drillStartedAt = timestamp(
    authority.drillStartedAt,
    "restore drill start time",
  );
  const [sourceDatabase, targetDatabase, sourceStorage, targetStorage] =
    await Promise.all([
      adapters.captureDatabase("source", authority),
      adapters.captureDatabase("target", authority),
      adapters.captureStorage("source", authority),
      adapters.captureStorage("target", authority),
    ]);
  const source = { ...sourceDatabase, storage: sourceStorage };
  const target = { ...targetDatabase, storage: targetStorage };
  const compared = compareRestoreSnapshots(source, target);
  const measuredAt = timestamp(adapters.now(), "restore measurement time");
  const ordered =
    backupCreatedAt !== null &&
    restoreCreatedAt !== null &&
    Date.parse(backupCreatedAt) <= Date.parse(drillStartedAt) &&
    Date.parse(drillStartedAt) <= Date.parse(restoreCreatedAt) &&
    Date.parse(restoreCreatedAt) <= Date.parse(measuredAt);
  const comparison = {
    status: compared.status === "NOT MET" ? "NOT MET" : "UNEXECUTED",
    mismatches: compared.mismatches,
  };
  const rpoSeconds = ordered
    ? Math.round(
        (Date.parse(drillStartedAt) - Date.parse(backupCreatedAt)) / 1000,
      )
    : null;
  const rtoSeconds = ordered
    ? Math.round((Date.parse(measuredAt) - Date.parse(drillStartedAt)) / 1000)
    : null;
  const providerIdentity = {
    sourceProjectRef: authority.sourceProjectRef,
    targetProjectRef: authority.targetProjectRef,
    backupId: backup?.id === undefined ? authority.backupId : String(backup.id),
    backupStatus: typeof backup?.status === "string" ? backup.status : null,
    backupIsPhysical: backup?.is_physical_backup === true,
    backupCreatedAt: backupCreatedAt ?? null,
    restoreProjectId:
      typeof restoreProject?.id === "string" && restoreProject.id.length > 0
        ? restoreProject.id
        : null,
    restoreProjectRef:
      typeof restoreProject?.ref === "string" && restoreProject.ref.length > 0
        ? restoreProject.ref
        : null,
    restoreStatus:
      typeof restoreProject?.status === "string" ? restoreProject.status : null,
    restoreCreatedAt: restoreCreatedAt ?? null,
  };
  const correlation = providerCorrelation(
    providerIdentity,
    source,
    target,
    ordered,
  );
  const evidence = {
    schemaVersion: 2,
    status:
      compared.status === "NOT MET" || correlation.status === "NOT MET"
        ? "NOT MET"
        : "UNEXECUTED",
    sourceCommit: authority.sourceCommit,
    requestId: authority.requestId,
    organizationId: authority.organizationId,
    provider: {
      ...providerIdentity,
      correlation,
      directBinding: { status: "UNEXECUTED", authority: null },
    },
    source,
    target,
    comparison,
    rpoSeconds,
    rtoSeconds,
    drillStartedAt,
    measuredAt,
    missingAuthorities: [],
    recordedAt: measuredAt,
  };
  const inspected = inspectDrawingP7RestoreEvidence(evidence);
  if (
    inspected.status === "NOT MET" &&
    inspected.rpoSeconds !== null &&
    inspected.rtoSeconds !== null
  )
    try {
      await adapters.record(inspected, authority);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure = new Error(
        `NOT MET: restore evidence record failed: ${message}`,
        { cause: error },
      );
      failure.restoreEvidence = inspected;
      throw failure;
    }
  return inspected;
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
          pg_catalog.format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||
          coalesce(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'')||':'||a.attidentity||':'||
          a.attgenerated||':'||coalesce(coll.collname,'') definition
        from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid
        join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        left join pg_catalog.pg_collation coll on coll.oid=a.attcollation
        where n.nspname in('public','private') and a.attnum>0 and not a.attisdropped
        union all
        select 'relation',n.nspname||'.'||c.relname,
          c.relkind||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||
          coalesce(c.relacl::text,'')
        from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname in('public','private') and c.relkind in('r','p','v','m','S')
        union all
        select 'constraint',n.nspname||'.'||c.relname||'.'||con.conname,
          pg_catalog.pg_get_constraintdef(con.oid,true)
        from pg_catalog.pg_constraint con join pg_catalog.pg_class c on c.oid=con.conrelid
        join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname in('public','private')
        union all
        select 'function',n.nspname||'.'||p.proname||'('||
          pg_catalog.pg_get_function_identity_arguments(p.oid)||')',
          pg_catalog.pg_get_functiondef(p.oid)||':'||coalesce(p.proacl::text,'')
        from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where n.nspname in('public','private') and p.prokind in('f','p')
        union all
        select 'policy',schemaname||'.'||tablename||'.'||policyname,
          permissive||':'||coalesce(roles::text,'')||':'||coalesce(cmd,'')||':'||
          coalesce(qual,'')||':'||coalesce(with_check,'')
        from pg_catalog.pg_policies where schemaname in('public','private')
        union all
        select 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,
          pg_catalog.pg_get_triggerdef(t.oid,true)||':'||t.tgenabled
        from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
        join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname in('public','private') and not t.tgisinternal
        union all
        select 'index',n.nspname||'.'||c.relname||'.'||i.relname,
          pg_catalog.pg_get_indexdef(i.oid)
        from pg_catalog.pg_index x join pg_catalog.pg_class i on i.oid=x.indexrelid
        join pg_catalog.pg_class c on c.oid=x.indrelid
        join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname in('public','private')
        union all
        select 'type',n.nspname||'.'||t.typname,
          t.typtype||':'||t.typcategory||':'||coalesce(t.typacl::text,'')||':'||
          coalesce((select pg_catalog.string_agg(e.enumlabel,',' order by e.enumsortorder)
            from pg_catalog.pg_enum e where e.enumtypid=t.oid),'')
        from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid=t.typnamespace
        where n.nspname in('public','private') and t.typtype in('e','d')
        union all
        select 'view',schemaname||'.'||viewname,definition
        from pg_catalog.pg_views where schemaname in('public','private')
        union all
        select 'extension',e.extname,e.extversion||':'||n.nspname
        from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid=e.extnamespace
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
        p_request_id: authority.requestId,
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
  const evidence = inspectDrawingP7RestoreEvidence(value);
  await mkdir(dirname(DRAWING_P7_RESTORE_EVIDENCE_PATH), { recursive: true });
  await writeFile(
    DRAWING_P7_RESTORE_EVIDENCE_PATH,
    `${JSON.stringify(evidence, null, 2)}\n`,
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
    const failure = classifyDrawingP7RestoreFailure(
      error,
      authority.sourceCommit,
    );
    await writeEvidence(failure.evidence);
    console.error(failure.message);
    process.exitCode = failure.exitCode;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
