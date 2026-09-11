import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const databaseUrl = process.env.M5_STORAGE_REAL_POSTGRES_DATABASE_URL;
const required = process.env.M5_STORAGE_REAL_POSTGRES_REQUIRED === "1";
const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const migrationSuffix = "_material_storage_authority.sql";
const quotaMigrationSuffix = "_material_transaction_project_quota.sql";

const ids = Object.freeze({
  factor: "53000000-0000-4000-8000-000000000001",
  factorFile: "53000000-0000-4000-8000-000000000002",
  estimator: "53000000-0000-4000-8000-000000000011",
  estimatorManifestFile: "53000000-0000-4000-8000-000000000012",
  foreignPrefixManifestFile: "53000000-0000-4000-8000-000000000013",
  malformedManifestFile: "53000000-0000-4000-8000-000000000014",
  materialEvidenceRegressionFile: "53000000-0000-4000-8000-000000000016",
  manifestFile: "53000000-0000-4000-8000-000000000003",
  manifestReservationFile: "53000000-0000-4000-8000-000000000010",
  owner: "53000000-0000-4000-8000-000000000004",
  order: "53000000-0000-4000-8000-00000000000f",
  plan: "53000000-0000-4000-8000-000000000005",
  procurement: "53000000-0000-4000-8000-000000000006",
  procurementStagedFile: "53000000-0000-4000-8000-000000000007",
  project: "53000000-0000-4000-8000-000000000008",
  reviewer: "53000000-0000-4000-8000-000000000015",
  site: "53000000-0000-4000-8000-000000000009",
  siteStagedFile: "53000000-0000-4000-8000-00000000000a",
  staff: "53000000-0000-4000-8000-00000000000b",
  transaction: "53000000-0000-4000-8000-00000000000c",
  transactionFile: "53000000-0000-4000-8000-00000000000d",
  transactionQuotaAllowed: "53000000-0000-4000-8000-000000000017",
  transactionQuotaRaceA: "53000000-0000-4000-8000-000000000018",
  transactionQuotaRaceB: "53000000-0000-4000-8000-000000000019",
  transactionQuotaOverflow: "53000000-0000-4000-8000-00000000001a",
  transactionQuotaRecovery: "53000000-0000-4000-8000-00000000001b",
  transactionQuotaBatchA: "53000000-0000-4000-8000-00000000001c",
  transactionQuotaBatchB: "53000000-0000-4000-8000-00000000001d",
  viewer: "53000000-0000-4000-8000-00000000000e",
});
const digest = Object.freeze({
  factor: "b".repeat(64),
  manifest: "a".repeat(64),
  estimatorManifest: "1".repeat(64),
  foreignPrefixManifest: "2".repeat(64),
  manifestReservation: "f".repeat(64),
  manifestUnregistered: "9".repeat(64),
  materialEvidenceRegression: "4".repeat(64),
  procurementStaged: "e".repeat(64),
  siteStaged: "d".repeat(64),
  transaction: "c".repeat(64),
  unauthorizedManifest: "3".repeat(64),
});
const paths = Object.freeze({
  factor: `${ids.owner}/${ids.project}/material-evidence/carbon-source.pdf`,
  manifest: `${ids.owner}/${ids.project}/boq-manifests/${digest.manifest}.manifest.json`,
  estimatorManifest: `${ids.estimator}/${ids.project}/boq-manifests/${digest.estimatorManifest}.manifest.json`,
  foreignPrefixManifest: `${ids.estimator}/${ids.project}/boq-manifests/${digest.foreignPrefixManifest}.manifest.json`,
  malformedManifest: `${ids.owner}/${ids.project}/boq-manifests/not-a-sha.manifest.json`,
  materialEvidenceRegression: `${ids.site}/${ids.project}/material-evidence/namespace-regression.jpg`,
  manifestReservation: `${ids.owner}/${ids.project}/boq-manifests/${digest.manifestReservation}.manifest.json`,
  manifestUnregistered: `${ids.owner}/${ids.project}/boq-manifests/${digest.manifestUnregistered}.manifest.json`,
  unauthorizedManifest: `${ids.owner}/${ids.project}/boq-manifests/${digest.unauthorizedManifest}.manifest.json`,
  procurementStaged: `${ids.procurement}/${ids.project}/material-evidence/procurement-staged.pdf`,
  siteStaged: `${ids.site}/${ids.project}/material-evidence/site-staged.jpg`,
  transaction: `${ids.site}/${ids.project}/material-evidence/receipt.jpg`,
});

function quoteIdentifier(value) {
  assert.match(value, /^[a-z][a-z0-9_]{0,62}$/);
  return `"${value}"`;
}

function isolatedUrl(source, databaseName) {
  const url = new URL(source);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function readMigration() {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(migrationSuffix))
    .sort();
  assert.equal(names.length, 1, "exactly one material storage migration");
  return readFile(new URL(names[0], migrationsDirectory), "utf8");
}

async function readQuotaMigration() {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(quotaMigrationSuffix))
    .sort();
  assert.equal(
    names.length,
    1,
    "exactly one material transaction quota migration",
  );
  return readFile(new URL(names[0], migrationsDirectory), "utf8");
}

test("material storage authority blocks every metadata-backed object mutation", async () => {
  const migration = await readMigration();
  const authority = migration.match(
    /create or replace function private\.lukas_qto_material_storage_path_is_referenced[\s\S]*?\$\$;/,
  )?.[0];
  assert.ok(authority);
  assert.match(authority, /where f\.storage_path=p_storage_path\s*\)/);
  assert.doesNotMatch(authority, /lukas_qto_material_plans/);
  assert.doesNotMatch(authority, /lukas_qto_carbon_factors/);
  assert.doesNotMatch(authority, /lukas_qto_material_transactions/);
  const fileReference = migration.match(
    /create or replace function private\.lukas_qto_material_file_is_referenced[\s\S]*?\$\$;/,
  )?.[0];
  assert.ok(fileReference);
  assert.match(fileReference, /lukas_qto_material_plans/);
  assert.match(fileReference, /lukas_qto_carbon_factors/);
  assert.match(fileReference, /lukas_qto_material_transactions/);
  assert.match(
    migration,
    /not private\.lukas_qto_material_file_is_referenced\(id,project_id,sha256\)/,
  );
  assert.match(
    migration,
    /create policy "material evidence metadata delete authority"[\s\S]*?on public\.lukas_qto_files as restrictive[\s\S]*?for delete to authenticated/,
  );
  assert.match(
    migration,
    /coalesce\(\(storage\.foldername\(storage_path\)\)\[3\],''\)\s+not in\('material-evidence','boq-manifests'\)[\s\S]*?\(storage\.foldername\(storage_path\)\)\[3\]='material-evidence'[\s\S]*?uploaded_by=\(select auth\.uid\(\)\)[\s\S]*?not private\.lukas_qto_material_file_is_referenced\(id,project_id,sha256\)/,
  );
  assert.match(
    migration,
    /create policy "material authority rejects authenticated delete"[\s\S]*?coalesce\(\(storage\.foldername\(name\)\)\[3\],''\)<>'boq-manifests'/,
  );
  assert.match(
    migration,
    /create policy "material authority rejects authenticated update"[\s\S]*?coalesce\(\(storage\.foldername\(name\)\)\[3\],''\)<>'boq-manifests'/,
  );
  const manifestUpload = migration.match(
    /create policy "material manifest upload authority"[\s\S]*?\n\);\n\n(?=drop policy)/,
  )?.[0];
  assert.ok(manifestUpload);
  assert.match(
    manifestUpload,
    /on storage\.objects as restrictive\s+for insert to authenticated/,
  );
  assert.match(
    manifestUpload,
    /bucket_id<>'lukas-qto'\s+or coalesce\(\(storage\.foldername\(name\)\)\[3\],''\)<>'boq-manifests'/,
  );
  assert.match(
    manifestUpload,
    /\(storage\.foldername\(name\)\)\[1\]=\(select auth\.uid\(\)::text\)/,
  );
  assert.match(
    manifestUpload,
    /private\.lukas_qto_storage_project_role\(name\)\s+in\('owner','staff','estimator'\)/,
  );
  assert.match(
    manifestUpload,
    /'\^'\|\|\(select auth\.uid\(\)::text\)[\s\S]*?\|\|'\/\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[1-8\]\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}'[\s\S]*?\|\|'\/boq-manifests\/\[0-9a-f\]\{64\}\[\.\]manifest\[\.\]json\$'/,
  );
  const manifestMetadata = migration.match(
    /create policy "material manifest metadata insert authority"[\s\S]*?\n\);\n\n(?=drop policy)/,
  )?.[0];
  assert.ok(manifestMetadata);
  assert.match(
    manifestMetadata,
    /on public\.lukas_qto_files as restrictive\s+for insert to authenticated/,
  );
  assert.match(
    manifestMetadata,
    /coalesce\(\(storage\.foldername\(storage_path\)\)\[3\],''\)<>'boq-manifests'/,
  );
  assert.match(
    manifestMetadata,
    /uploaded_by=\(select auth\.uid\(\)\)[\s\S]*?and immutable[\s\S]*?and kind='other'[\s\S]*?and content_type='application\/json'/,
  );
  assert.match(
    manifestMetadata,
    /private\.lukas_qto_project_role\(project_id\)\s+in\('owner','staff','estimator'\)/,
  );
  assert.match(
    manifestMetadata,
    /storage_path=\(select auth\.uid\(\)::text\)\|\|'\/'\|\|project_id::text\s+\|\|'\/boq-manifests\/'\|\|sha256\|\|'\.manifest\.json'/,
  );
  assert.match(
    migration,
    /update storage\.buckets[\s\S]*?coalesce\(allowed_mime_types,'\{\}'::text\[\]\)[\s\S]*?array\['application\/json','model\/gltf-binary'\][\s\S]*?where id='lukas-qto'/,
  );
});

test("material transaction quota serializes each project before enforcing the loader bound", async () => {
  const migration = await readQuotaMigration();
  const quotaFunction = migration.match(
    /create or replace function private\.lukas_qto_enforce_material_transaction_project_quota[\s\S]*?\$\$;/,
  )?.[0];
  assert.ok(quotaFunction);
  assert.match(quotaFunction, /security invoker[\s\S]*?set search_path=''/);
  assert.match(
    quotaFunction,
    /pg_catalog\.pg_advisory_xact_lock\([\s\S]*?new\.project_id::text[\s\S]*?\)/,
  );
  assert.match(
    quotaFunction,
    /pg_catalog\.count\(\*\)[\s\S]*?from public\.lukas_qto_material_transactions[\s\S]*?project_id=new\.project_id[\s\S]*?>=10000/,
  );
  assert.match(
    quotaFunction,
    /raise exception 'Material transaction project limit exceeded'/,
  );
  assert.match(
    migration,
    /create trigger lukas_qto_material_transactions_write_quota\s+before insert on public\.lukas_qto_material_transactions\s+for each row execute function private\.lukas_qto_enforce_material_transaction_project_quota\(\)/,
  );
});

async function ensureRoles(sql) {
  const currentUser = (await sql`select current_user`)[0].current_user;
  const state = [];
  for (const role of ["anon", "authenticated", "service_role"]) {
    const [existing] = await sql`
      select exists(
        select 1 from pg_catalog.pg_roles where rolname=${role}
      ) present
    `;
    const item = { created: false, granted: false, role };
    state.push(item);
    if (!existing.present) {
      await sql.unsafe(
        `create role ${quoteIdentifier(role)} nologin${
          role === "service_role" ? " bypassrls" : ""
        }`,
      );
      item.created = true;
    }
    const [membership] = await sql`
      select pg_catalog.pg_has_role(${currentUser},${role},'MEMBER') member
    `;
    if (!membership.member) {
      await sql.unsafe(
        `grant ${quoteIdentifier(role)} to ${quoteIdentifier(currentUser)}`,
      );
      item.granted = true;
    }
  }
  return state;
}

async function bootstrap(sql) {
  await sql.unsafe(`
    create publication supabase_realtime;
    create schema auth;
    create schema extensions;
    create schema private;
    create schema storage;
    create extension pgcrypto with schema extensions;
    alter default privileges in schema public
      grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public
      grant all on sequences to anon,authenticated,service_role;
    alter default privileges in schema public
      grant all on functions to anon,authenticated,service_role;
    create table auth.users(
      id uuid primary key,
      email text,
      email_confirmed_at timestamptz,
      is_anonymous boolean not null default false,
      raw_app_meta_data jsonb not null default '{}'::jsonb,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid() returns uuid language sql stable set search_path=''
    as $$
      select (nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable set search_path=''
    as $$
      select coalesce(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)
    $$;
    create table storage.buckets(
      id text primary key,name text not null,public boolean not null default false,
      file_size_limit bigint,allowed_mime_types text[]
    );
    create table storage.objects(
      id uuid primary key default extensions.gen_random_uuid(),
      bucket_id text not null references storage.buckets(id),name text not null,
      unique(bucket_id,name)
    );
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable
    as $$ select pg_catalog.string_to_array($1,'/') $$;
    grant usage on schema auth,storage to anon,authenticated,service_role;
    grant execute on function auth.uid(),auth.jwt(),storage.foldername(text)
      to anon,authenticated,service_role;
  `);
  const migrations = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migration of migrations)
    await sql.unsafe(
      await readFile(new URL(migration, migrationsDirectory), "utf8"),
    );
  await sql.unsafe(`
    grant select,insert,update,delete on storage.objects to authenticated,service_role;
    create policy "M5 full-chain update probe"
      on storage.objects for update to authenticated
      using(bucket_id='lukas-qto')
      with check(bucket_id='lukas-qto');
  `);
}

async function seed(sql) {
  for (const [name, userId] of [
    ["owner", ids.owner],
    ["estimator", ids.estimator],
    ["procurement", ids.procurement],
    ["reviewer", ids.reviewer],
    ["site", ids.site],
    ["staff", ids.staff],
    ["viewer", ids.viewer],
  ])
    await sql`
      insert into auth.users(id,email,email_confirmed_at,is_anonymous)
      values(${userId}::uuid,${`${name}@m5.example.test`},
        pg_catalog.clock_timestamp(),false)
    `;
  await sql`select pg_catalog.set_config(
    'request.jwt.claims',${JSON.stringify({
      role: "authenticated",
      sub: ids.owner,
      is_anonymous: false,
      app_metadata: {},
    })},false
  )`;
  await sql`
    insert into public.lukas_qto_projects(id,owner_id,name,description)
    values(${ids.project}::uuid,${ids.owner}::uuid,
      'M5 full-chain storage authority','Temporary disposable proof')
  `;
  for (const [userId, role] of [
    [ids.estimator, "estimator"],
    [ids.site, "site"],
    [ids.procurement, "procurement"],
    [ids.reviewer, "reviewer"],
    [ids.viewer, "viewer"],
  ])
    await sql`
      insert into public.lukas_qto_project_members(project_id,user_id,role)
      values(${ids.project}::uuid,${userId}::uuid,${role})
    `;
  for (const file of [
    [ids.manifestFile, ids.owner, paths.manifest, digest.manifest, true],
    [
      ids.manifestReservationFile,
      ids.owner,
      paths.manifestReservation,
      digest.manifestReservation,
      true,
    ],
    [ids.factorFile, ids.owner, paths.factor, digest.factor, true],
    [
      ids.transactionFile,
      ids.site,
      paths.transaction,
      digest.transaction,
      true,
    ],
    [ids.siteStagedFile, ids.site, paths.siteStaged, digest.siteStaged, true],
    [
      ids.procurementStagedFile,
      ids.procurement,
      paths.procurementStaged,
      digest.procurementStaged,
      true,
    ],
  ]) {
    await sql`
      insert into public.lukas_qto_files(
        id,project_id,uploaded_by,kind,storage_path,original_filename,
        content_type,byte_size,sha256,immutable
      ) values(
        ${file[0]}::uuid,${ids.project}::uuid,${file[1]}::uuid,'other',
        ${file[2]},'m5-evidence.bin','application/octet-stream',32,
        ${file[3]},${file[4]}
      )
    `;
    await sql`
      insert into storage.objects(id,bucket_id,name)
      values(${randomUUID()}::uuid,'lukas-qto',${file[2]})
    `;
  }
  await sql`
    insert into storage.objects(id,bucket_id,name)
    values(${randomUUID()}::uuid,'lukas-qto',${paths.manifestUnregistered})
  `;
  await sql`
    insert into public.lukas_qto_material_plans(
      id,project_id,material_code,material_name,specification,unit,
      design_quantity,allowance_rate,required_quantity,rule_id,
      source_file_id,source_sha256,created_by
    ) values(
      ${ids.plan}::uuid,${ids.project}::uuid,
      'M5-001','M5 자재','검증 규격','EA',1,0,1,'M5_STORAGE_V1',
      ${ids.manifestFile}::uuid,${digest.manifest},${ids.owner}::uuid
    )
  `;
  await sql`
    insert into public.lukas_qto_carbon_factors(
      id,project_id,material_code,product_name,declared_unit,
      gwp_a1_a3_per_unit,source_type,standard,geography,
      source_file_id,source_sha256,created_by
    ) values(
      ${ids.factor}::uuid,${ids.project}::uuid,
      'M5-001','M5 탄소계수','EA',1,'generic','ISO 14040','KR',
      ${ids.factorFile}::uuid,${digest.factor},${ids.owner}::uuid
    )
  `;
  await sql`
    insert into public.lukas_qto_material_transactions(
      id,project_id,material_plan_id,transaction_type,document_number,
      supplier_name,occurred_on,quantity,related_order_id,
      evidence_file_id,evidence_sha256,received_by_name,event_location,
      site_acknowledgement,note,created_by
    ) values(
      ${ids.order}::uuid,${ids.project}::uuid,${ids.plan}::uuid,
      'purchase_order','M5-PO-1','M5 공급사','2026-09-02',1,null,
      null,null,'','',false,'',${ids.owner}::uuid
    )
  `;
  await sql`
    insert into public.lukas_qto_material_transactions(
      id,project_id,material_plan_id,transaction_type,document_number,
      supplier_name,occurred_on,quantity,related_order_id,carbon_factor_id,
      evidence_file_id,evidence_sha256,received_by_name,event_location,
      site_acknowledgement,note,created_by
    ) values(
      ${ids.transaction}::uuid,${ids.project}::uuid,${ids.plan}::uuid,
      'goods_receipt','M5-GR-1','M5 공급사','2026-09-02',1,
      ${ids.order}::uuid,${ids.factor}::uuid,
      ${ids.transactionFile}::uuid,${digest.transaction},'현장 담당','A동',
      true,'M5 storage proof',${ids.site}::uuid
    )
  `;
}

async function session(sql, actorId, callback, { staff = false } = {}) {
  return sql.begin(async (tx) => {
    await tx.unsafe("set local role authenticated");
    await tx`select pg_catalog.set_config(
      'request.jwt.claims',${JSON.stringify({
        sub: actorId,
        is_anonymous: false,
        app_metadata: staff ? { role: "hangil_staff" } : {},
      })},true
    )`;
    return callback(tx);
  });
}

async function insertQuotaPurchaseOrder(sql, actorId, id, documentNumber) {
  return session(
    sql,
    actorId,
    (tx) => tx`
    insert into public.lukas_qto_material_transactions(
      id,project_id,material_plan_id,transaction_type,document_number,
      supplier_name,occurred_on,quantity,created_by
    ) values(
      ${id}::uuid,${ids.project}::uuid,${ids.plan}::uuid,'purchase_order',
      ${documentNumber},'M5 quota supplier','2026-09-02',1,${actorId}::uuid
    ) returning id
  `,
  );
}

test(
  "M5 material storage real PostgreSQL gate is configured",
  { skip: !required || Boolean(databaseUrl) },
  () => assert.fail("M5_STORAGE_REAL_POSTGRES_DATABASE_URL is required"),
);

test(
  "referenced material bytes survive owner staff and viewer while staged uploads clean up",
  {
    skip: databaseUrl
      ? false
      : "M5 material storage real PostgreSQL gate is UNEXECUTED",
    timeout: 120_000,
  },
  async () => {
    const { default: postgres } = await import("postgres");
    const databaseName = `m5_storage_${process.pid}_${randomBytes(4).toString("hex")}`;
    const admin = postgres(databaseUrl, { max: 1, prepare: false });
    let database;
    let quotaRaceDatabases = [];
    let collaborationRoleCreated = false;
    let roleState = [];
    let primaryError;
    const cleanupErrors = [];
    const cleanup = async (label, operation) => {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(
          new Error(`M5 storage cleanup failed: ${label}`, { cause: error }),
        );
      }
    };
    try {
      roleState = await ensureRoles(admin);
      const [collaborationRole] = await admin`
        select exists(
          select 1 from pg_catalog.pg_roles
          where rolname='lukas_drawing_collaboration'
        ) present
      `;
      collaborationRoleCreated = !collaborationRole.present;
      await admin.unsafe(`create database ${quoteIdentifier(databaseName)}`);
      database = postgres(isolatedUrl(databaseUrl, databaseName), {
        max: 1,
        prepare: false,
      });
      await bootstrap(database);
      await seed(database);

      const [bucket] = await database`
        select
          'application/json'=any(allowed_mime_types) allows_json,
          'model/gltf-binary'=any(allowed_mime_types) allows_glb,
          'application/pdf'=any(allowed_mime_types) keeps_pdf,
          'application/dxf'=any(allowed_mime_types) keeps_dxf
        from storage.buckets where id='lukas-qto'
      `;
      assert.deepEqual(bucket, {
        allows_glb: true,
        allows_json: true,
        keeps_dxf: true,
        keeps_pdf: true,
      });

      await database.begin(async (tx) => {
        await tx.unsafe(
          "alter table public.lukas_qto_material_transactions disable trigger lukas_qto_material_transactions_write_quota",
        );
        await tx`
          insert into public.lukas_qto_material_transactions(
            project_id,material_plan_id,transaction_type,document_number,
            supplier_name,occurred_on,quantity,created_by
          )
          select ${ids.project}::uuid,${ids.plan}::uuid,'purchase_order',
            'M5-BULK-'||series::text,'M5 quota supplier','2026-09-02',1,
            ${ids.owner}::uuid
          from pg_catalog.generate_series(1,9996) series
        `;
        await tx.unsafe(
          "alter table public.lukas_qto_material_transactions enable trigger lukas_qto_material_transactions_write_quota",
        );
      });
      const [beforeQuota] = await database`
        select pg_catalog.count(*)::integer count
        from public.lukas_qto_material_transactions
        where project_id=${ids.project}::uuid
      `;
      assert.equal(beforeQuota.count, 9998);
      const allowed = await insertQuotaPurchaseOrder(
        database,
        ids.procurement,
        ids.transactionQuotaAllowed,
        "M5-QUOTA-ALLOWED",
      );
      assert.deepEqual(Array.from(allowed), [
        { id: ids.transactionQuotaAllowed },
      ]);

      let waiting = 0;
      let releaseRace;
      const raceReady = new Promise((resolve) => {
        releaseRace = resolve;
      });
      const raceInsert = (sql, actorId, id, documentNumber) =>
        session(sql, actorId, async (tx) => {
          waiting += 1;
          if (waiting === 2) releaseRace();
          await raceReady;
          return tx`
            insert into public.lukas_qto_material_transactions(
              id,project_id,material_plan_id,transaction_type,document_number,
              supplier_name,occurred_on,quantity,created_by
            ) values(
              ${id}::uuid,${ids.project}::uuid,${ids.plan}::uuid,
              'purchase_order',${documentNumber},'M5 quota supplier',
              '2026-09-02',1,${actorId}::uuid
            ) returning id
          `;
        });
      quotaRaceDatabases = [
        postgres(isolatedUrl(databaseUrl, databaseName), {
          max: 1,
          prepare: false,
        }),
        postgres(isolatedUrl(databaseUrl, databaseName), {
          max: 1,
          prepare: false,
        }),
      ];
      const raceResults = await Promise.allSettled([
        raceInsert(
          quotaRaceDatabases[0],
          ids.owner,
          ids.transactionQuotaRaceA,
          "M5-QUOTA-RACE-A",
        ),
        raceInsert(
          quotaRaceDatabases[1],
          ids.procurement,
          ids.transactionQuotaRaceB,
          "M5-QUOTA-RACE-B",
        ),
      ]);
      const raceSuccesses = raceResults.filter(
        (result) => result.status === "fulfilled",
      );
      const raceFailures = raceResults.filter(
        (result) => result.status === "rejected",
      );
      assert.equal(raceSuccesses.length, 1);
      assert.equal(raceFailures.length, 1);
      assert.match(
        String(raceFailures[0].reason?.message ?? raceFailures[0].reason),
        /Material transaction project limit exceeded/,
      );
      const [atQuota] = await database`
        select pg_catalog.count(*)::integer count
        from public.lukas_qto_material_transactions
        where project_id=${ids.project}::uuid
      `;
      assert.equal(atQuota.count, 10_000);
      await assert.rejects(
        insertQuotaPurchaseOrder(
          database,
          ids.procurement,
          ids.transactionQuotaOverflow,
          "M5-QUOTA-OVERFLOW",
        ),
        /Material transaction project limit exceeded/,
      );
      await database.begin(async (tx) => {
        await tx.unsafe("set local role service_role");
        const removed = await tx`
          delete from public.lukas_qto_material_transactions
          where project_id=${ids.project}::uuid
            and document_number='M5-BULK-1'
          returning id
        `;
        assert.equal(removed.length, 1);
      });
      await assert.rejects(
        session(
          database,
          ids.procurement,
          (tx) => tx`
            insert into public.lukas_qto_material_transactions(
              id,project_id,material_plan_id,transaction_type,document_number,
              supplier_name,occurred_on,quantity,created_by
            ) values
              (
                ${ids.transactionQuotaBatchA}::uuid,${ids.project}::uuid,
                ${ids.plan}::uuid,'purchase_order','M5-QUOTA-BATCH-A',
                'M5 quota supplier','2026-09-02',1,${ids.procurement}::uuid
              ),
              (
                ${ids.transactionQuotaBatchB}::uuid,${ids.project}::uuid,
                ${ids.plan}::uuid,'purchase_order','M5-QUOTA-BATCH-B',
                'M5 quota supplier','2026-09-02',1,${ids.procurement}::uuid
              )
            returning id
          `,
        ),
        /Material transaction project limit exceeded/,
        "one multi-row statement cannot cross the project quota",
      );
      const [afterBatchRollback] = await database`
        select pg_catalog.count(*)::integer count
        from public.lukas_qto_material_transactions
        where project_id=${ids.project}::uuid
      `;
      assert.equal(afterBatchRollback.count, 9_999);
      const recovery = await insertQuotaPurchaseOrder(
        database,
        ids.procurement,
        ids.transactionQuotaRecovery,
        "M5-QUOTA-RECOVERY",
      );
      assert.deepEqual(Array.from(recovery), [
        { id: ids.transactionQuotaRecovery },
      ]);

      for (const actor of [ids.reviewer, ids.site, ids.procurement]) {
        await assert.rejects(
          session(
            database,
            actor,
            (tx) => tx`
            insert into storage.objects(id,bucket_id,name)
            values(${randomUUID()}::uuid,'lukas-qto',${paths.unauthorizedManifest})
            returning name
          `,
          ),
          /row-level security policy/,
        );
      }
      await assert.rejects(
        session(
          database,
          ids.owner,
          (tx) => tx`
          insert into storage.objects(id,bucket_id,name)
          values(${randomUUID()}::uuid,'lukas-qto',${paths.foreignPrefixManifest})
          returning name
        `,
        ),
        /row-level security policy/,
      );
      await assert.rejects(
        session(
          database,
          ids.owner,
          (tx) => tx`
          insert into storage.objects(id,bucket_id,name)
          values(${randomUUID()}::uuid,'lukas-qto',${paths.malformedManifest})
          returning name
        `,
        ),
        /row-level security policy/,
      );
      const estimatorManifest = await session(
        database,
        ids.estimator,
        (tx) => tx`
          insert into storage.objects(id,bucket_id,name)
          values(${randomUUID()}::uuid,'lukas-qto',${paths.estimatorManifest})
          returning name
        `,
      );
      assert.deepEqual(Array.from(estimatorManifest), [
        { name: paths.estimatorManifest },
      ]);

      for (const [actor, role] of [
        [ids.reviewer, "reviewer"],
        [ids.site, "site"],
        [ids.procurement, "procurement"],
      ]) {
        await assert.rejects(
          session(
            database,
            actor,
            (tx) => tx`
            insert into public.lukas_qto_files(
              id,project_id,uploaded_by,kind,storage_path,original_filename,
              content_type,byte_size,sha256,immutable
            ) values(
              ${randomUUID()}::uuid,${ids.project}::uuid,${actor}::uuid,'other',
              ${`${actor}/${ids.project}/boq-manifests/${digest.unauthorizedManifest}.manifest.json`},
              'unauthorized.manifest.json','application/json',32,
              ${digest.unauthorizedManifest},true
            ) returning id
          `,
          ),
          /row-level security policy/,
          `${role} cannot reserve BOQ manifest metadata`,
        );
      }
      await assert.rejects(
        session(
          database,
          ids.owner,
          (tx) => tx`
          insert into public.lukas_qto_files(
            id,project_id,uploaded_by,kind,storage_path,original_filename,
            content_type,byte_size,sha256,immutable
          ) values(
            ${ids.foreignPrefixManifestFile}::uuid,${ids.project}::uuid,
            ${ids.owner}::uuid,'other',${paths.foreignPrefixManifest},
            'foreign-prefix.manifest.json','application/json',32,
            ${digest.foreignPrefixManifest},true
          ) returning id
        `,
        ),
        /row-level security policy/,
      );
      await assert.rejects(
        session(
          database,
          ids.owner,
          (tx) => tx`
          insert into public.lukas_qto_files(
            id,project_id,uploaded_by,kind,storage_path,original_filename,
            content_type,byte_size,sha256,immutable
          ) values(
            ${ids.malformedManifestFile}::uuid,${ids.project}::uuid,
            ${ids.owner}::uuid,'other',${paths.malformedManifest},
            'malformed.manifest.json','application/json',32,
            ${digest.manifest},true
          ) returning id
        `,
        ),
        /row-level security policy/,
      );
      const estimatorMetadata = await session(
        database,
        ids.estimator,
        (tx) => tx`
          insert into public.lukas_qto_files(
            id,project_id,uploaded_by,kind,storage_path,original_filename,
            content_type,byte_size,sha256,immutable
          ) values(
            ${ids.estimatorManifestFile}::uuid,${ids.project}::uuid,
            ${ids.estimator}::uuid,'other',${paths.estimatorManifest},
            'estimator.manifest.json','application/json',32,
            ${digest.estimatorManifest},true
          ) returning id
        `,
      );
      assert.deepEqual(Array.from(estimatorMetadata), [
        { id: ids.estimatorManifestFile },
      ]);

      const materialEvidenceObject = await session(
        database,
        ids.site,
        (tx) => tx`
          insert into storage.objects(id,bucket_id,name)
          values(${randomUUID()}::uuid,'lukas-qto',${paths.materialEvidenceRegression})
          returning name
        `,
      );
      assert.deepEqual(Array.from(materialEvidenceObject), [
        { name: paths.materialEvidenceRegression },
      ]);
      const materialEvidenceMetadata = await session(
        database,
        ids.site,
        (tx) => tx`
          insert into public.lukas_qto_files(
            id,project_id,uploaded_by,kind,storage_path,original_filename,
            content_type,byte_size,sha256,immutable
          ) values(
            ${ids.materialEvidenceRegressionFile}::uuid,${ids.project}::uuid,
            ${ids.site}::uuid,'other',${paths.materialEvidenceRegression},
            'namespace-regression.jpg','image/jpeg',32,
            ${digest.materialEvidenceRegression},true
          ) returning id
        `,
      );
      assert.deepEqual(Array.from(materialEvidenceMetadata), [
        { id: ids.materialEvidenceRegressionFile },
      ]);

      await database.begin(async (tx) => {
        await tx.unsafe("set local role service_role");
        const changed = await tx`
          update storage.objects set name=${`${paths.manifest}.service-probe`}
          where bucket_id='lukas-qto' and name=${paths.manifest}
          returning name
        `;
        assert.deepEqual(Array.from(changed), [
          { name: `${paths.manifest}.service-probe` },
        ]);
        const restored = await tx`
          update storage.objects set name=${paths.manifest}
          where bucket_id='lukas-qto'
            and name=${`${paths.manifest}.service-probe`}
          returning name
        `;
        assert.deepEqual(Array.from(restored), [{ name: paths.manifest }]);
      });

      for (const staged of [
        { actor: ids.site, path: paths.siteStaged },
        { actor: ids.procurement, path: paths.procurementStaged },
      ]) {
        const storageFirst = await session(
          database,
          staged.actor,
          (tx) => tx`
            delete from storage.objects
            where bucket_id='lukas-qto' and name=${staged.path}
            returning name
          `,
        );
        assert.deepEqual(Array.from(storageFirst), []);
      }

      for (const attempt of [
        { actor: ids.owner, path: paths.manifest },
        { actor: ids.owner, path: paths.manifestUnregistered },
        { actor: ids.staff, path: paths.factor, staff: true },
        {
          actor: ids.staff,
          path: paths.manifestUnregistered,
          staff: true,
        },
        { actor: ids.staff, path: paths.transaction, staff: true },
        { actor: ids.viewer, path: paths.manifest },
      ]) {
        const deleted = await session(
          database,
          attempt.actor,
          (tx) => tx`
            delete from storage.objects
            where bucket_id='lukas-qto' and name=${attempt.path}
            returning name
          `,
          { staff: attempt.staff },
        );
        assert.deepEqual(Array.from(deleted), []);
      }
      for (const attempt of [
        { actor: ids.owner, path: paths.manifest },
        { actor: ids.owner, path: paths.manifestUnregistered },
        { actor: ids.staff, path: paths.transaction, staff: true },
        {
          actor: ids.staff,
          path: paths.manifestUnregistered,
          staff: true,
        },
      ]) {
        const updated = await session(
          database,
          attempt.actor,
          (tx) => tx`
            update storage.objects set name=name || '.mutated'
            where bucket_id='lukas-qto' and name=${attempt.path}
            returning name
          `,
          { staff: attempt.staff },
        );
        assert.deepEqual(Array.from(updated), []);
      }

      for (const attempt of [
        { actor: ids.owner, file: ids.siteStagedFile },
        {
          actor: ids.staff,
          file: ids.procurementStagedFile,
          staff: true,
        },
      ]) {
        const deleted = await session(
          database,
          attempt.actor,
          (tx) => tx`
            delete from public.lukas_qto_files
            where id=${attempt.file}::uuid returning id
          `,
          { staff: attempt.staff },
        );
        assert.deepEqual(Array.from(deleted), []);
      }

      for (const attempt of [
        { actor: ids.owner },
        { actor: ids.staff, staff: true },
      ]) {
        const deleted = await session(
          database,
          attempt.actor,
          (tx) => tx`
            delete from public.lukas_qto_files
            where id=${ids.manifestReservationFile}::uuid returning id
          `,
          { staff: attempt.staff },
        );
        assert.deepEqual(Array.from(deleted), []);
      }

      for (const staged of [
        { actor: ids.site, file: ids.siteStagedFile, path: paths.siteStaged },
        {
          actor: ids.site,
          file: ids.materialEvidenceRegressionFile,
          path: paths.materialEvidenceRegression,
        },
        {
          actor: ids.procurement,
          file: ids.procurementStagedFile,
          path: paths.procurementStaged,
        },
      ]) {
        const metadata = await session(
          database,
          staged.actor,
          (tx) => tx`
          delete from public.lukas_qto_files where id=${staged.file}::uuid
          returning id
        `,
        );
        assert.equal(metadata.length, 1);
        const object = await session(
          database,
          staged.actor,
          (tx) => tx`
          delete from storage.objects
          where bucket_id='lukas-qto' and name=${staged.path}
          returning name
        `,
        );
        assert.equal(object.length, 1);
      }

      const linkedMetadata = await session(
        database,
        ids.site,
        (tx) => tx`
        delete from public.lukas_qto_files
        where id=${ids.transactionFile}::uuid returning id
      `,
      );
      assert.deepEqual(Array.from(linkedMetadata), []);
      const linkedObject = await session(
        database,
        ids.site,
        (tx) => tx`
        delete from storage.objects
        where bucket_id='lukas-qto' and name=${paths.transaction}
        returning name
      `,
      );
      assert.deepEqual(Array.from(linkedObject), []);

      const retained = await database`
        select name
        from storage.objects order by name
      `;
      assert.deepEqual(
        Array.from(retained),
        [
          { name: paths.factor },
          { name: paths.estimatorManifest },
          { name: paths.manifest },
          { name: paths.manifestReservation },
          { name: paths.manifestUnregistered },
          { name: paths.transaction },
        ].sort((left, right) => left.name.localeCompare(right.name)),
      );
      const policies = await database`
        select cmd,permissive
        from pg_catalog.pg_policies
        where schemaname='storage'
          and (
            policyname like 'material authority rejects authenticated %'
            or policyname='material manifest upload authority'
          )
        order by cmd
      `;
      assert.deepEqual(Array.from(policies), [
        { cmd: "DELETE", permissive: "RESTRICTIVE" },
        { cmd: "INSERT", permissive: "RESTRICTIVE" },
        { cmd: "UPDATE", permissive: "RESTRICTIVE" },
      ]);
      const [authority] = await database`
        select
          p.prosecdef security_definer,
          p.provolatile volatility,
          p.proconfig settings,
          pg_catalog.has_function_privilege(
            'anon',p.oid,'execute'
          ) anon_execute,
          pg_catalog.has_function_privilege(
            'authenticated',p.oid,'execute'
          ) authenticated_execute,
          pg_catalog.has_function_privilege(
            'service_role',p.oid,'execute'
          ) service_execute,
          pg_catalog.has_schema_privilege(
            'anon','private','usage'
          ) anon_schema_usage,
          pg_catalog.has_schema_privilege(
            'authenticated','private','usage'
          ) authenticated_schema_usage,
          pg_catalog.has_schema_privilege(
            'service_role','private','usage'
          ) service_schema_usage
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where n.nspname='private'
          and p.proname='lukas_qto_material_storage_path_is_referenced'
          and pg_catalog.pg_get_function_identity_arguments(p.oid)='p_storage_path text'
      `;
      assert.deepEqual(authority, {
        anon_execute: false,
        anon_schema_usage: false,
        authenticated_execute: true,
        authenticated_schema_usage: true,
        security_definer: true,
        service_execute: true,
        service_schema_usage: true,
        settings: ['search_path=""'],
        volatility: "s",
      });
      await database.begin(async (tx) => {
        await tx.unsafe("set local role service_role");
        const metadata = await tx`
          delete from public.lukas_qto_files
          where id=${ids.manifestReservationFile}::uuid returning id
        `;
        const object = await tx`
          delete from storage.objects
          where bucket_id='lukas-qto'
            and name in(${paths.manifestReservation},${paths.manifestUnregistered})
          returning name
        `;
        assert.equal(metadata.length, 1);
        assert.equal(object.length, 2);
        const estimatorCleanup = await tx`
          delete from public.lukas_qto_files
          where id=${ids.estimatorManifestFile}::uuid returning id
        `;
        const estimatorObjectCleanup = await tx`
          delete from storage.objects
          where bucket_id='lukas-qto' and name=${paths.estimatorManifest}
          returning name
        `;
        assert.equal(estimatorCleanup.length, 1);
        assert.equal(estimatorObjectCleanup.length, 1);
      });
    } catch (error) {
      primaryError = error;
    } finally {
      for (const [index, raceDatabase] of quotaRaceDatabases.entries())
        await cleanup(`quota race connection ${index + 1}`, () =>
          raceDatabase.end({ timeout: 5 }),
        );
      if (database)
        await cleanup("database connection", () =>
          database.end({ timeout: 5 }),
        );
      await cleanup(
        "terminate database",
        () => admin`
          select pg_catalog.pg_terminate_backend(pid)
          from pg_catalog.pg_stat_activity
          where datname=${databaseName} and pid<>pg_catalog.pg_backend_pid()
        `,
      );
      await cleanup("drop database", () =>
        admin.unsafe(
          `drop database if exists ${quoteIdentifier(databaseName)}`,
        ),
      );
      if (collaborationRoleCreated)
        await cleanup("drop collaboration role", () =>
          admin.unsafe("drop role if exists lukas_drawing_collaboration"),
        );
      for (const state of roleState.reverse()) {
        if (state.granted)
          await cleanup(`revoke ${state.role}`, () =>
            admin.unsafe(
              `revoke ${quoteIdentifier(state.role)} from current_user`,
            ),
          );
        if (state.created)
          await cleanup(`drop ${state.role}`, () =>
            admin.unsafe(`drop role if exists ${quoteIdentifier(state.role)}`),
          );
      }
      await cleanup("admin connection", () => admin.end({ timeout: 5 }));
    }
    if (primaryError) {
      if (cleanupErrors.length)
        throw new AggregateError(
          [primaryError, ...cleanupErrors],
          "M5 material storage proof and cleanup both failed",
        );
      throw primaryError;
    }
    if (cleanupErrors.length)
      throw new AggregateError(
        cleanupErrors,
        "M5 material storage cleanup failed",
      );
  },
);
