import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const authorityMigrationUrl = new URL(
  "../supabase/migrations/20260904064308_drawing_revision_share_authority.sql",
  import.meta.url,
);
const serverIssuedMigrationUrl = new URL(
  "../supabase/migrations/20260904122447_drawing_share_server_issued_authority.sql",
  import.meta.url,
);

const ids = Object.freeze({
  admin: "8d000000-0000-4000-8000-000000000001",
  editor: "8d000000-0000-4000-8000-000000000002",
  anonymousAdmin: "8d000000-0000-4000-8000-000000000003",
  project: "8d000000-0000-4000-8000-000000000010",
  otherProject: "8d000000-0000-4000-8000-000000000011",
  organization: "8d000000-0000-4000-8000-000000000012",
  otherOrganization: "8d000000-0000-4000-8000-000000000013",
  document: "8d000000-0000-4000-8000-000000000020",
  otherDocument: "8d000000-0000-4000-8000-000000000021",
  foreignDocument: "8d000000-0000-4000-8000-000000000022",
  reviewRequested: "8d000000-0000-4000-8000-000000000030",
  reviewed: "8d000000-0000-4000-8000-000000000031",
  approved: "8d000000-0000-4000-8000-000000000032",
  superseded: "8d000000-0000-4000-8000-000000000033",
  draft: "8d000000-0000-4000-8000-000000000034",
  request: "8d000000-0000-4000-8000-000000000040",
  revokeRequest: "8d000000-0000-4000-8000-000000000041",
});

const snapshotSha256 = "a".repeat(64);
const alternateSnapshotSha256 = "b".repeat(64);
const rawToken = "A".repeat(43);
const tokenHash = createHash("sha256").update(rawToken).digest("hex");
const canonicalJson = Object.freeze({
  schemaVersion: "2",
  projectId: ids.project,
  revisionId: ids.reviewRequested,
  revisionVersion: 7,
  operationSequence: 19,
  pages: [],
  canvases: [],
  layers: [],
  objects: [],
});

const authorityMigrationSql = await readFile(authorityMigrationUrl, "utf8");
const serverIssuedMigrationSql = await readFile(
  serverIssuedMigrationUrl,
  "utf8",
);

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function setupDatabase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema auth;
    create schema private;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create role anon;
    create role authenticated;
    create role service_role;

    create table auth.users(
      id uuid primary key,
      is_anonymous boolean not null default false
    );
    create table public.lukas_qto_projects(
      id uuid primary key,
      name text not null,
      organization_id uuid not null,
      archived_at timestamptz,
      deletion_requested_at timestamptz
    );
    create table public.lukas_drawing_documents(
      id uuid primary key,
      project_id uuid not null references public.lukas_qto_projects(id)
        on delete cascade,
      title text not null,
      unique(id,project_id)
    );
    create table public.lukas_drawing_revisions(
      id uuid primary key,
      document_id uuid not null,
      project_id uuid not null references public.lukas_qto_projects(id)
        on delete cascade,
      sequence integer not null,
      status text not null,
      version bigint not null,
      unique(id,project_id),
      unique(id,document_id,project_id),
      foreign key(document_id,project_id)
        references public.lukas_drawing_documents(id,project_id)
        on delete cascade
    );
    create table public.lukas_drawing_snapshots(
      id uuid primary key default extensions.gen_random_uuid(),
      revision_id uuid not null,
      project_id uuid not null references public.lukas_qto_projects(id)
        on delete cascade,
      revision_version bigint not null,
      operation_sequence bigint not null,
      canonical_json jsonb not null,
      sha256 text not null,
      schema_version smallint not null,
      unique(revision_id,project_id,revision_version,sha256),
      foreign key(revision_id,project_id)
        references public.lukas_drawing_revisions(id,project_id)
        on delete cascade
    );
    create table private.test_drawing_capabilities(
      actor_id uuid not null,
      project_id uuid not null,
      capability text not null,
      primary key(actor_id,project_id)
    );
    create table private.test_project_features(
      project_id uuid primary key,
      drawing_workspace boolean not null
    );

    create function auth.uid() returns uuid
    language sql stable set search_path='' as $$
      select nullif(
        pg_catalog.current_setting('request.jwt.claim.sub',true),''
      )::uuid
    $$;
    create function auth.jwt() returns jsonb
    language sql stable set search_path='' as $$
      select pg_catalog.jsonb_build_object(
        'role',coalesce(nullif(
          pg_catalog.current_setting('request.jwt.claim.role',true),''
        ),'anon'),
        'is_anonymous',coalesce(nullif(
          pg_catalog.current_setting('request.jwt.claim.is_anonymous',true),''
        ),'false')::boolean
      )
    $$;
    create function private.lukas_qto_verified_session()
    returns boolean language sql stable security invoker set search_path='' as $$
      select coalesce((select (auth.jwt()->>'is_anonymous')::boolean),false)=false
    $$;
    create function private.lukas_qto_project_feature_active(
      p_project_id uuid,p_feature text
    ) returns boolean language sql stable security definer set search_path='' as $$
      select coalesce(f.drawing_workspace,false)
      from private.test_project_features f
      where f.project_id=p_project_id and p_feature='drawing_workspace'
    $$;
    create function private.lukas_drawing_workspace_capability_pre_entitlement(
      p_project_id uuid
    )
    returns text language sql stable security definer set search_path='' as $$
      select c.capability
      from private.test_drawing_capabilities c
      where c.actor_id=(select auth.uid()) and c.project_id=p_project_id
    $$;
    create function private.lukas_drawing_workspace_capability(p_project_id uuid)
    returns text language sql stable security definer set search_path='' as $$
      select case when private.lukas_qto_project_feature_active(
        p_project_id,'drawing_workspace'
      ) then private.lukas_drawing_workspace_capability_pre_entitlement(
        p_project_id
      ) else null::text end
    $$;
    create function private.lukas_drawing_collaboration_capability_for_user(
      p_user_id uuid,p_project_id uuid
    ) returns text language sql stable security definer set search_path='' as $$
      select c.capability
      from private.test_drawing_capabilities c
      where c.actor_id=p_user_id and c.project_id=p_project_id
    $$;
    revoke all on function private.lukas_qto_verified_session()
      from public,anon;
    grant execute on function private.lukas_qto_verified_session()
      to authenticated,service_role;

    insert into auth.users(id,is_anonymous) values
      ('${ids.admin}',false),
      ('${ids.editor}',false),
      ('${ids.anonymousAdmin}',true);
    insert into public.lukas_qto_projects(id,name,organization_id) values
      ('${ids.project}','Tower Alpha','${ids.organization}'),
      ('${ids.otherProject}','Tower Beta','${ids.otherOrganization}');
    insert into public.lukas_drawing_documents(id,project_id,title) values
      ('${ids.document}','${ids.project}','Core plan'),
      ('${ids.otherDocument}','${ids.project}','Other plan'),
      ('${ids.foreignDocument}','${ids.otherProject}','Foreign plan');
    insert into private.test_drawing_capabilities(actor_id,project_id,capability)
    values
      ('${ids.admin}','${ids.project}','admin'),
      ('${ids.editor}','${ids.project}','editor'),
      ('${ids.anonymousAdmin}','${ids.project}','admin');
    insert into private.test_project_features(project_id,drawing_workspace)
    values('${ids.project}',true),('${ids.otherProject}',true);
  `);

  const revisions = [
    [ids.reviewRequested, "review_requested", 7, 1],
    [ids.reviewed, "reviewed", 8, 2],
    [ids.approved, "approved", 9, 3],
    [ids.superseded, "superseded", 10, 4],
    [ids.draft, "draft", 11, 5],
  ];
  for (const [revisionId, status, version, sequence] of revisions) {
    await db.query(
      `insert into public.lukas_drawing_revisions(
        id,document_id,project_id,sequence,status,version
      ) values($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::text,$6::bigint)`,
      [revisionId, ids.document, ids.project, sequence, status, version],
    );
    await db.query(
      `insert into public.lukas_drawing_snapshots(
        revision_id,project_id,revision_version,operation_sequence,
        canonical_json,sha256,schema_version
      ) values($1::uuid,$2::uuid,$3::bigint,19,$4::jsonb,$5::text,2)`,
      [
        revisionId,
        ids.project,
        version,
        JSON.stringify({
          ...canonicalJson,
          revisionId,
          revisionVersion: version,
        }),
        snapshotSha256,
      ],
    );
  }

  await db.exec(authorityMigrationSql);
  await db.exec(serverIssuedMigrationSql);
  return db;
}

async function useRole(db, role, actor = null, anonymous = false) {
  assert.ok(["anon", "authenticated", "service_role"].includes(role));
  await db.exec(`reset role; set role ${role}`);
  await db.query(
    `select
      pg_catalog.set_config('request.jwt.claim.role',$1,false),
      pg_catalog.set_config('request.jwt.claim.sub',$2,false),
      pg_catalog.set_config('request.jwt.claim.is_anonymous',$3,false)`,
    [role, actor ?? "", String(anonymous)],
  );
}

async function createShare(
  db,
  {
    projectId = ids.project,
    documentId = ids.document,
    revisionId = ids.reviewRequested,
    revisionVersion = 7,
    snapshotSha = snapshotSha256,
    suppliedTokenHash = tokenHash,
    requestId = ids.request,
    actorId,
  } = {},
) {
  const context = (
    await db.query(`select
      pg_catalog.current_setting('role',true) as role,
      pg_catalog.current_setting('request.jwt.claim.sub',true) as actor,
      pg_catalog.current_setting(
        'request.jwt.claim.is_anonymous',true
      ) as anonymous`)
  ).rows[0];
  const effectiveActor = actorId ?? (context.actor || null);
  await useRole(db, "service_role");
  try {
    const result = await db.query(
      `select public.lukas_qto_create_drawing_share(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bigint,$6::text,$7::text,$8::uuid
      ) as result`,
      [
        effectiveActor,
        projectId,
        documentId,
        revisionId,
        revisionVersion,
        snapshotSha,
        suppliedTokenHash,
        requestId,
      ],
    );
    return result.rows[0].result;
  } finally {
    await useRole(
      db,
      context.role,
      context.actor || null,
      context.anonymous === "true",
    );
  }
}

async function revokeShare(
  db,
  shareId,
  {
    projectId = ids.project,
    documentId = ids.document,
    revisionId = ids.reviewRequested,
    revisionVersion = 7,
    snapshotSha = snapshotSha256,
    reason = "External review completed",
    requestId = ids.revokeRequest,
  } = {},
) {
  const result = await db.query(
    `select public.lukas_qto_revoke_drawing_share(
      $1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::text,$6::uuid,$7::text,$8::uuid
    ) as result`,
    [
      projectId,
      documentId,
      revisionId,
      revisionVersion,
      snapshotSha,
      shareId,
      reason,
      requestId,
    ],
  );
  return result.rows[0].result;
}

async function resolveShare(db, token = rawToken) {
  const result = await db.query(
    "select public.lukas_qto_shared_drawing_revision($1::text) as result",
    [token],
  );
  return result.rows[0].result;
}

async function listShares(
  db,
  {
    projectId = ids.project,
    documentId = ids.document,
    revisionId = ids.reviewRequested,
    revisionVersion = 7,
    snapshotSha = snapshotSha256,
  } = {},
) {
  const result = await db.query(
    `select public.lukas_qto_list_drawing_shares(
      $1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::text
    ) as result`,
    [projectId, documentId, revisionId, revisionVersion, snapshotSha],
  );
  return result.rows[0].result;
}

test("only a verified drawing admin can create a hash-only seven-day share", async () => {
  const db = await setupDatabase();
  try {
    const privileges = await db.query(`
      select
        pg_catalog.has_table_privilege(
          'anon','public.lukas_qto_drawing_shares','select'
        ) as anon_select,
        pg_catalog.has_table_privilege(
          'authenticated','public.lukas_qto_drawing_shares','select'
        ) as authenticated_select,
        pg_catalog.has_table_privilege(
          'authenticated','public.lukas_qto_drawing_shares','insert'
        ) as authenticated_insert,
        pg_catalog.has_table_privilege(
          'service_role','public.lukas_qto_drawing_shares','select'
        ) as service_select
    `);
    assert.deepEqual(privileges.rows[0], {
      anon_select: false,
      authenticated_select: false,
      authenticated_insert: false,
      service_select: true,
    });

    await useRole(db, "authenticated", ids.admin);
    await assert.rejects(
      db.query("select * from public.lukas_qto_drawing_shares"),
      /permission denied/i,
    );
    await assert.rejects(
      db.query(
        `select public.lukas_qto_create_drawing_share(
          $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bigint,$6::text,$7::text,$8::uuid
        )`,
        [
          ids.admin,
          ids.project,
          ids.document,
          ids.reviewRequested,
          7,
          snapshotSha256,
          tokenHash,
          ids.request,
        ],
      ),
      /permission denied/i,
    );
    const created = await createShare(db);
    assert.equal(created.projectId, ids.project);
    assert.equal(created.documentId, ids.document);
    assert.equal(created.revisionId, ids.reviewRequested);
    assert.equal(created.revisionVersion, 7);
    assert.equal(created.snapshotSha256, snapshotSha256);
    assert.equal(created.revokedAt, null);
    assert.equal(created.requestId, ids.request);
    assert.equal(
      Date.parse(created.expiresAt) - Date.parse(created.createdAt),
      7 * 24 * 60 * 60 * 1_000,
    );

    await db.exec("reset role");
    const stored = await db.query(
      "select * from public.lukas_qto_drawing_shares where id=$1::uuid",
      [created.shareId],
    );
    assert.equal(stored.rows[0].token_hash, tokenHash);
    assert.equal(Object.hasOwn(stored.rows[0], "token"), false);
    assert.equal(JSON.stringify(stored.rows[0]).includes(rawToken), false);

    await useRole(db, "authenticated", ids.editor);
    await assert.rejects(
      createShare(db, {
        suppliedTokenHash: hashToken("B".repeat(43)),
        requestId: "8d000000-0000-4000-8000-000000000042",
      }),
      /authority denied/i,
    );

    await useRole(db, "authenticated", ids.anonymousAdmin, true);
    await assert.rejects(
      createShare(db, {
        suppliedTokenHash: hashToken("C".repeat(43)),
        requestId: "8d000000-0000-4000-8000-000000000043",
      }),
      /authority denied/i,
    );

    await useRole(db, "anon");
    await assert.rejects(
      createShare(db, {
        suppliedTokenHash: hashToken("D".repeat(43)),
        requestId: "8d000000-0000-4000-8000-000000000044",
      }),
      /authority denied/i,
    );
  } finally {
    await db.close();
  }
});

test("RLS and function grants expose only the intended RPC roles", async () => {
  const db = await setupDatabase();
  try {
    const rls = await db.query(`
      select relname,relrowsecurity
      from pg_catalog.pg_class
      where oid in(
        'public.lukas_qto_drawing_shares'::pg_catalog.regclass,
        'public.lukas_qto_drawing_share_events'::pg_catalog.regclass
      )
      order by relname
    `);
    assert.deepEqual(rls.rows, [
      { relname: "lukas_qto_drawing_share_events", relrowsecurity: true },
      { relname: "lukas_qto_drawing_shares", relrowsecurity: true },
    ]);

    const privileges = await db.query(`select
      pg_catalog.has_function_privilege(
        'anon',
        'public.lukas_qto_create_drawing_share(uuid,uuid,uuid,uuid,bigint,text,text,uuid)',
        'execute'
      ) anon_create,
      pg_catalog.has_function_privilege(
        'authenticated',
        'public.lukas_qto_create_drawing_share(uuid,uuid,uuid,uuid,bigint,text,text,uuid)',
        'execute'
      ) authenticated_create,
      pg_catalog.has_function_privilege(
        'service_role',
        'public.lukas_qto_create_drawing_share(uuid,uuid,uuid,uuid,bigint,text,text,uuid)',
        'execute'
      ) service_create,
      pg_catalog.to_regprocedure(
        'public.lukas_qto_create_drawing_share(uuid,uuid,uuid,bigint,text,text,uuid)'
      ) is not null as legacy_create_exists,
      pg_catalog.has_function_privilege(
        'authenticated',
        'public.lukas_qto_revoke_drawing_share(uuid,uuid,uuid,bigint,text,uuid,text,uuid)',
        'execute'
      ) authenticated_revoke,
      pg_catalog.has_function_privilege(
        'service_role',
        'public.lukas_qto_revoke_drawing_share(uuid,uuid,uuid,bigint,text,uuid,text,uuid)',
        'execute'
      ) service_revoke,
      pg_catalog.has_function_privilege(
        'authenticated',
        'public.lukas_qto_list_drawing_shares(uuid,uuid,uuid,bigint,text)',
        'execute'
      ) authenticated_list,
      pg_catalog.has_function_privilege(
        'service_role',
        'public.lukas_qto_list_drawing_shares(uuid,uuid,uuid,bigint,text)',
        'execute'
      ) service_list,
      pg_catalog.has_function_privilege(
        'anon','public.lukas_qto_shared_drawing_revision(text)','execute'
      ) anon_resolve,
      pg_catalog.has_function_privilege(
        'authenticated','public.lukas_qto_shared_drawing_revision(text)','execute'
      ) authenticated_resolve,
      pg_catalog.has_function_privilege(
        'service_role','public.lukas_qto_shared_drawing_revision(text)','execute'
      ) service_resolve`);
    assert.deepEqual(privileges.rows[0], {
      anon_create: false,
      authenticated_create: false,
      service_create: true,
      legacy_create_exists: false,
      authenticated_revoke: true,
      service_revoke: false,
      authenticated_list: true,
      service_list: false,
      anon_resolve: false,
      authenticated_resolve: false,
      service_resolve: true,
    });
  } finally {
    await db.close();
  }
});

test("creation accepts every frozen state and rejects stale or mismatched lineage", async () => {
  const db = await setupDatabase();
  try {
    await useRole(db, "authenticated", ids.admin);
    for (const [index, revisionId, revisionVersion] of [
      [0, ids.reviewRequested, 7],
      [1, ids.reviewed, 8],
      [2, ids.approved, 9],
      [3, ids.superseded, 10],
    ]) {
      const result = await createShare(db, {
        revisionId,
        revisionVersion,
        suppliedTokenHash: hashToken(String(index).repeat(43)),
        requestId: `8d000000-0000-4000-8000-00000000005${index}`,
      });
      assert.equal(result.revisionId, revisionId);
      assert.equal(result.revisionVersion, revisionVersion);
    }

    const deniedCases = [
      {
        revisionId: ids.draft,
        revisionVersion: 11,
        requestId: "8d000000-0000-4000-8000-000000000060",
      },
      {
        revisionVersion: 6,
        requestId: "8d000000-0000-4000-8000-000000000061",
      },
      {
        snapshotSha: alternateSnapshotSha256,
        requestId: "8d000000-0000-4000-8000-000000000062",
      },
      {
        documentId: ids.otherDocument,
        requestId: "8d000000-0000-4000-8000-000000000063",
      },
      {
        projectId: ids.otherProject,
        documentId: ids.foreignDocument,
        requestId: "8d000000-0000-4000-8000-000000000064",
      },
    ];
    for (const [index, denied] of deniedCases.entries()) {
      await assert.rejects(
        createShare(db, {
          ...denied,
          suppliedTokenHash: hashToken(`X${index}`.padEnd(43, "x")),
        }),
        /unavailable|authority denied/i,
      );
    }
  } finally {
    await db.close();
  }
});

test("create request replay is idempotent and its audit evidence is append-only", async () => {
  const db = await setupDatabase();
  try {
    await useRole(db, "authenticated", ids.admin);
    const first = await createShare(db);
    const replay = await createShare(db);
    assert.deepEqual(replay, first);

    await assert.rejects(
      createShare(db, { suppliedTokenHash: hashToken("Z".repeat(43)) }),
      /request conflict/i,
    );

    await db.exec("reset role");
    const counts = await db.query(`
      select
        (select pg_catalog.count(*)::integer
          from public.lukas_qto_drawing_shares) as shares,
        (select pg_catalog.count(*)::integer
          from public.lukas_qto_drawing_share_events) as events
    `);
    assert.deepEqual(counts.rows[0], { shares: 1, events: 1 });
    const event = (
      await db.query("select * from public.lukas_qto_drawing_share_events")
    ).rows[0];
    assert.equal(event.event_type, "created");
    assert.match(event.request_sha256, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(event).includes(rawToken), false);
    assert.equal(Object.hasOwn(event.details, "tokenHash"), false);

    await assert.rejects(
      db.exec(
        "update public.lukas_qto_drawing_share_events set details='{}'::jsonb",
      ),
      /append-only/i,
    );
    await assert.rejects(
      db.exec("delete from public.lukas_qto_drawing_share_events"),
      /append-only/i,
    );
    await assert.rejects(
      db.query(
        `update public.lukas_qto_drawing_shares
          set revoked_at=pg_catalog.now(),revoked_by=$1::uuid,
              revoke_reason='direct mutation'
          where id=$2::uuid`,
        [ids.admin, first.shareId],
      ),
      /RPC-only|audited/i,
    );
  } finally {
    await db.close();
  }
});

test("revocation is exact, audited, paired, and idempotent", async () => {
  const db = await setupDatabase();
  try {
    await useRole(db, "authenticated", ids.admin);
    const created = await createShare(db);
    await assert.rejects(
      revokeShare(db, created.shareId, {
        documentId: ids.otherDocument,
        requestId: "8d000000-0000-4000-8000-000000000070",
      }),
      /unavailable/i,
    );

    const revoked = await revokeShare(db, created.shareId);
    assert.equal(revoked.shareId, created.shareId);
    assert.equal(revoked.reason, "External review completed");
    assert.ok(Date.parse(revoked.revokedAt) >= Date.parse(created.createdAt));
    assert.deepEqual(await revokeShare(db, created.shareId), revoked);
    await assert.rejects(
      revokeShare(db, created.shareId, { reason: "Changed reason" }),
      /request conflict/i,
    );

    await db.exec("reset role");
    const stored = (
      await db.query(
        `select revoked_at,revoked_by,revoke_reason
          from public.lukas_qto_drawing_shares where id=$1::uuid`,
        [created.shareId],
      )
    ).rows[0];
    assert.equal(stored.revoked_by, ids.admin);
    assert.equal(stored.revoke_reason, "External review completed");
    assert.ok(stored.revoked_at);
    const events = await db.query(
      `select event_type from public.lukas_qto_drawing_share_events
        where share_id=$1::uuid order by created_at`,
      [created.shareId],
    );
    assert.deepEqual(
      events.rows.map(({ event_type }) => event_type),
      ["created", "revoked"],
    );

    await useRole(db, "service_role");
    assert.equal(await resolveShare(db), null);

    await useRole(db, "authenticated", ids.editor);
    await assert.rejects(
      revokeShare(db, created.shareId, {
        requestId: "8d000000-0000-4000-8000-000000000071",
      }),
      /authority denied/i,
    );
  } finally {
    await db.close();
  }
});

test("only service role resolves an active token to the narrow exact snapshot", async () => {
  const db = await setupDatabase();
  try {
    await useRole(db, "authenticated", ids.admin);
    const created = await createShare(db);
    const noncanonicalAlias = `${rawToken.slice(0, -1)}B`;
    for (const [candidate, requestId] of [
      ["Y".repeat(42), "8d000000-0000-4000-8000-000000000082"],
      ["Z".repeat(44), "8d000000-0000-4000-8000-000000000083"],
      ["!".repeat(43), "8d000000-0000-4000-8000-000000000084"],
      [noncanonicalAlias, "8d000000-0000-4000-8000-000000000085"],
    ]) {
      await createShare(db, {
        suppliedTokenHash: hashToken(candidate),
        requestId,
      });
    }
    await assert.rejects(resolveShare(db), /permission denied/i);
    await useRole(db, "anon");
    await assert.rejects(resolveShare(db), /permission denied/i);

    await useRole(db, "service_role");
    const resolved = await resolveShare(db);
    assert.deepEqual(Object.keys(resolved).sort(), [
      "document",
      "expiresAt",
      "project",
      "revision",
      "shareId",
      "snapshot",
    ]);
    assert.deepEqual(resolved.project, {
      id: ids.project,
      name: "Tower Alpha",
    });
    assert.deepEqual(resolved.document, {
      id: ids.document,
      title: "Core plan",
    });
    assert.deepEqual(resolved.revision, {
      id: ids.reviewRequested,
      sequence: 1,
      status: "review_requested",
      version: 7,
    });
    assert.equal(resolved.shareId, created.shareId);
    assert.equal(resolved.snapshot.sha256, snapshotSha256);
    assert.equal(resolved.snapshot.schemaVersion, 2);
    assert.equal(resolved.snapshot.operationSequence, 19);
    assert.deepEqual(resolved.snapshot.canonicalJson, canonicalJson);
    assert.equal(JSON.stringify(resolved).includes(tokenHash), false);
    assert.equal(JSON.stringify(resolved).includes(ids.admin), false);

    assert.equal(await resolveShare(db, "too-short"), null);
    assert.equal(await resolveShare(db, "_".repeat(43)), null);
    assert.equal(await resolveShare(db, "Y".repeat(42)), null);
    assert.equal(await resolveShare(db, "Z".repeat(44)), null);
    assert.equal(await resolveShare(db, "!".repeat(43)), null);
    assert.equal(await resolveShare(db, noncanonicalAlias), null);

    await db.exec("reset role");
    await db.query(
      `update public.lukas_drawing_revisions set version=12,status='draft'
        where id=$1::uuid`,
      [ids.reviewRequested],
    );
    await useRole(db, "service_role");
    assert.equal(await resolveShare(db), null);
  } finally {
    await db.close();
  }
});

test("only a verified admin lists active exact-snapshot metadata without bearer hashes", async () => {
  const db = await setupDatabase();
  try {
    await useRole(db, "authenticated", ids.admin);
    const active = await createShare(db);
    const revokedCandidate = await createShare(db, {
      suppliedTokenHash: hashToken("L".repeat(43)),
      requestId: "8d000000-0000-4000-8000-000000000080",
    });
    await revokeShare(db, revokedCandidate.shareId, {
      requestId: "8d000000-0000-4000-8000-000000000081",
    });

    const listed = await listShares(db);
    assert.equal(listed.length, 1);
    assert.deepEqual(Object.keys(listed[0]).sort(), [
      "createdAt",
      "expiresAt",
      "revisionVersion",
      "revokedAt",
      "shareId",
      "snapshotSha256",
    ]);
    assert.equal(listed[0].shareId, active.shareId);
    assert.equal(listed[0].revisionVersion, 7);
    assert.equal(listed[0].snapshotSha256, snapshotSha256);
    assert.equal(listed[0].revokedAt, null);
    assert.equal(JSON.stringify(listed).includes(tokenHash), false);

    await assert.rejects(
      listShares(db, { documentId: ids.otherDocument }),
      /unavailable/i,
    );
    await useRole(db, "authenticated", ids.editor);
    await assert.rejects(listShares(db), /authority denied/i);
    await useRole(db, "authenticated", ids.anonymousAdmin, true);
    await assert.rejects(listShares(db), /authority denied/i);
    await useRole(db, "anon");
    await assert.rejects(listShares(db), /permission denied/i);
  } finally {
    await db.close();
  }
});

test("active links are capped while expired and revoked links release capacity", async () => {
  const db = await setupDatabase();
  try {
    await db.exec("reset role");
    await db.query(
      `with mark as materialized(
        select pg_catalog.clock_timestamp() as now
      )
      insert into public.lukas_qto_drawing_shares(
        token_hash,project_id,document_id,revision_id,revision_version,
        snapshot_sha256,created_by,created_at,expires_at
      )
      select
        pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to('capacity-'||series.n::text,'UTF8'),'sha256'
        ),'hex'),
        $1::uuid,$2::uuid,$3::uuid,7,$4::text,$5::uuid,
        mark.now,mark.now+interval '7 days'
      from pg_catalog.generate_series(1,99) as series(n),mark`,
      [
        ids.project,
        ids.document,
        ids.reviewRequested,
        snapshotSha256,
        ids.admin,
      ],
    );
    await db.query(
      `with mark as materialized(
        select pg_catalog.clock_timestamp() as now
      )
      insert into public.lukas_qto_drawing_shares(
        token_hash,project_id,document_id,revision_id,revision_version,
        snapshot_sha256,created_by,created_at,expires_at
      ) values(
        $1::text,$2::uuid,$3::uuid,$4::uuid,7,$5::text,$6::uuid,
        (select now-interval '8 days' from mark),
        (select now-interval '1 day' from mark)
      )`,
      [
        hashToken("expired-capacity"),
        ids.project,
        ids.document,
        ids.reviewRequested,
        snapshotSha256,
        ids.admin,
      ],
    );

    await useRole(db, "authenticated", ids.admin);
    const hundredth = await createShare(db);
    assert.equal((await listShares(db)).length, 100);
    await assert.rejects(
      createShare(db, {
        suppliedTokenHash: hashToken("M".repeat(43)),
        requestId: "8d000000-0000-4000-8000-000000000100",
      }),
      /limit/i,
    );

    await revokeShare(db, hundredth.shareId);
    const replacement = await createShare(db, {
      suppliedTokenHash: hashToken("N".repeat(43)),
      requestId: "8d000000-0000-4000-8000-000000000101",
    });
    assert.ok(replacement.shareId);
    assert.equal((await listShares(db)).length, 100);
  } finally {
    await db.close();
  }
});

test("physical constraints reject widened scope, unsafe expiry, and partial revocation", async () => {
  const db = await setupDatabase();
  try {
    await db.exec("reset role");
    const directInsert = async ({
      token = "c".repeat(64),
      projectId = ids.project,
      documentId = ids.document,
      revisionId = ids.reviewRequested,
      revisionVersion = 7,
      snapshotSha = snapshotSha256,
      createdAt = "2026-09-04T00:00:00.000Z",
      expiresAt = "2026-09-11T00:00:00.000Z",
      revokedAt = null,
      revokedBy = null,
      reason = null,
    } = {}) =>
      db.query(
        `insert into public.lukas_qto_drawing_shares(
          token_hash,project_id,document_id,revision_id,revision_version,
          snapshot_sha256,created_by,created_at,expires_at,
          revoked_at,revoked_by,revoke_reason
        ) values(
          $1::text,$2::uuid,$3::uuid,$4::uuid,$5::bigint,
          $6::text,$7::uuid,$8::timestamptz,$9::timestamptz,
          $10::timestamptz,$11::uuid,$12::text
        )`,
        [
          token,
          projectId,
          documentId,
          revisionId,
          revisionVersion,
          snapshotSha,
          ids.admin,
          createdAt,
          expiresAt,
          revokedAt,
          revokedBy,
          reason,
        ],
      );

    await assert.rejects(
      directInsert({ token: "not-a-sha" }),
      /check constraint/i,
    );
    await assert.rejects(
      directInsert({
        token: "d".repeat(64),
        expiresAt: "2026-09-11T00:00:00.001Z",
      }),
      /check constraint/i,
    );
    await assert.rejects(
      directInsert({
        token: "e".repeat(64),
        expiresAt: "2026-09-04T00:00:00.000Z",
      }),
      /check constraint/i,
    );
    await assert.rejects(
      directInsert({
        token: "f".repeat(64),
        documentId: ids.otherDocument,
      }),
      /foreign key constraint/i,
    );
    await assert.rejects(
      directInsert({
        token: "1".repeat(64),
        snapshotSha: alternateSnapshotSha256,
      }),
      /foreign key constraint/i,
    );
    await assert.rejects(
      directInsert({
        token: "2".repeat(64),
        revokedAt: "2026-09-05T00:00:00.000Z",
      }),
      /check constraint/i,
    );
    await assert.rejects(
      directInsert({
        token: "3".repeat(64),
        revokedAt: "2026-09-05T00:00:00.000Z",
        revokedBy: ids.admin,
        reason: "   ",
      }),
      /check constraint/i,
    );

    const expiredRawToken = "expired".padEnd(43, "x");
    await directInsert({
      token: hashToken(expiredRawToken),
      createdAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2020-01-08T00:00:00.000Z",
    });
    await useRole(db, "service_role");
    assert.equal(await resolveShare(db, expiredRawToken), null);
  } finally {
    await db.close();
  }
});

test("trusted project retention can cascade through share rows and their audit events", async () => {
  const db = await setupDatabase();
  try {
    await useRole(db, "authenticated", ids.admin);
    await createShare(db);

    await db.exec("reset role");
    await assert.rejects(
      db.query("delete from public.lukas_qto_projects where id=$1::uuid", [
        ids.project,
      ]),
      /RPC-only|append-only|audited/i,
    );

    await db.exec("begin");
    await db.query(
      "select pg_catalog.set_config('app.lukas_retention_purge_project',$1,true)",
      [ids.project],
    );
    await db.query("delete from public.lukas_qto_projects where id=$1::uuid", [
      ids.project,
    ]);
    await db.exec("commit");
    const counts = await db.query(`
      select
        (select pg_catalog.count(*)::integer
          from public.lukas_qto_drawing_shares) as shares,
        (select pg_catalog.count(*)::integer
          from public.lukas_qto_drawing_share_events) as events
    `);
    assert.deepEqual(counts.rows[0], { shares: 0, events: 0 });
  } finally {
    await db.close();
  }
});

test("every user foreign-key path has an index for bounded deletion checks", async () => {
  const db = await setupDatabase();
  try {
    const indexes = await db.query(`
      select tablename,indexdef
      from pg_catalog.pg_indexes
      where schemaname='public'
        and tablename in(
          'lukas_qto_drawing_shares','lukas_qto_drawing_share_events'
        )
    `);
    const definitions = indexes.rows.map(({ indexdef }) => indexdef);
    for (const required of [
      /on public\.lukas_qto_drawing_shares using btree \(created_by\)/i,
      /on public\.lukas_qto_drawing_shares using btree \(revoked_by\)/i,
      /on public\.lukas_qto_drawing_share_events using btree \(actor_id/i,
    ]) {
      assert.ok(
        definitions.some((definition) => required.test(definition)),
        `missing FK index ${required}`,
      );
    }
  } finally {
    await db.close();
  }
});

test("archived or deletion-pending projects cannot create, list, or resolve shares", async () => {
  const db = await setupDatabase();
  try {
    await useRole(db, "authenticated", ids.admin);
    await createShare(db);

    await db.exec("reset role");
    await db.query(
      "update public.lukas_qto_projects set archived_at=pg_catalog.now() where id=$1::uuid",
      [ids.project],
    );
    await useRole(db, "service_role");
    assert.equal(await resolveShare(db), null);
    await useRole(db, "authenticated", ids.admin);
    await assert.rejects(listShares(db), /unavailable/i);
    await assert.rejects(
      createShare(db, {
        suppliedTokenHash: hashToken("Q".repeat(43)),
        requestId: "8d000000-0000-4000-8000-000000000090",
      }),
      /unavailable/i,
    );

    await db.exec("reset role");
    await db.query(
      `update public.lukas_qto_projects
        set archived_at=null,deletion_requested_at=pg_catalog.now()
        where id=$1::uuid`,
      [ids.project],
    );
    await useRole(db, "service_role");
    assert.equal(await resolveShare(db), null);
  } finally {
    await db.close();
  }
});

test("a disabled drawing-workspace entitlement invalidates existing bearer links", async () => {
  const db = await setupDatabase();
  try {
    await useRole(db, "authenticated", ids.admin);
    const created = await createShare(db);
    await db.exec("reset role");
    await db.query(
      `update private.test_project_features set drawing_workspace=false
        where project_id=$1::uuid`,
      [ids.project],
    );
    await useRole(db, "service_role");
    assert.equal(await resolveShare(db), null);
    await useRole(db, "authenticated", ids.admin);
    await assert.rejects(
      createShare(db, {
        suppliedTokenHash: hashToken("W".repeat(43)),
        requestId: "8d000000-0000-4000-8000-000000000091",
      }),
      /authority denied/i,
    );

    const revoked = await revokeShare(db, created.shareId);
    assert.equal(revoked.shareId, created.shareId);
    await db.exec("reset role");
    await db.query(
      `update private.test_project_features set drawing_workspace=true
        where project_id=$1::uuid`,
      [ids.project],
    );
    await useRole(db, "service_role");
    assert.equal(await resolveShare(db), null);
  } finally {
    await db.close();
  }
});

test("an active drawing bearer blocks cross-organization project transfer", async () => {
  const db = await setupDatabase();
  try {
    await useRole(db, "authenticated", ids.admin);
    const created = await createShare(db);
    await db.exec("reset role");
    await assert.rejects(
      db.query(
        `update public.lukas_qto_projects set organization_id=$1::uuid
          where id=$2::uuid`,
        [ids.otherOrganization, ids.project],
      ),
      /active drawing share/i,
    );

    await useRole(db, "authenticated", ids.admin);
    await revokeShare(db, created.shareId);
    await db.exec("reset role");
    await db.query(
      `update public.lukas_qto_projects set organization_id=$1::uuid
        where id=$2::uuid`,
      [ids.otherOrganization, ids.project],
    );
    const moved = await db.query(
      "select organization_id from public.lukas_qto_projects where id=$1::uuid",
      [ids.project],
    );
    assert.equal(moved.rows[0].organization_id, ids.otherOrganization);
  } finally {
    await db.close();
  }
});

test("revision rejection invalidates a bearer but still permits audited cleanup", async () => {
  const db = await setupDatabase();
  try {
    await useRole(db, "authenticated", ids.admin);
    const created = await createShare(db);
    await db.exec("reset role");
    await db.query(
      `update public.lukas_drawing_revisions
        set status='draft',version=version+1 where id=$1::uuid`,
      [ids.reviewRequested],
    );
    await useRole(db, "service_role");
    assert.equal(await resolveShare(db), null);

    await useRole(db, "authenticated", ids.admin);
    const revoked = await revokeShare(db, created.shareId);
    assert.equal(revoked.shareId, created.shareId);
    await db.exec("reset role");
    await db.query(
      `update public.lukas_qto_projects set organization_id=$1::uuid
        where id=$2::uuid`,
      [ids.otherOrganization, ids.project],
    );
  } finally {
    await db.close();
  }
});
