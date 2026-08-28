import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

async function migration() {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const matches = (await readdir(directory)).filter((name) =>
    name.endsWith("_drawing_workspace_organization_administration.sql"),
  );
  assert.equal(matches.length, 1, "exactly one Task 6 forward migration");
  return readFile(new URL(matches[0], directory), "utf8");
}

test("organization invitations have exact expiry, acceptance, revocation, and retry authority", async () => {
  const sql = await migration();
  assert.match(sql, /create table public\.lukas_qto_organization_invitations/i);
  assert.match(sql, /normalized_email/i);
  assert.match(sql, /expires_at/i);
  assert.match(sql, /accepted_at/i);
  assert.match(sql, /revoked_at/i);
  assert.match(sql, /request_sha256/i);
  assert.match(sql, /lukas_qto_invite_organization_member/i);
  assert.match(sql, /lukas_qto_accept_organization_invitation/i);
  assert.match(sql, /lukas_qto_revoke_organization_invitation/i);
  assert.match(sql, /lower\(pg_catalog\.btrim\([^)]*email/i);
  assert.match(sql, /expires_at\s*>\s*pg_catalog\.now\(\)/i);
});

test("plans, seats, trials, quotas, and feature entitlements are immutable versions", async () => {
  const sql = await migration();
  assert.match(
    sql,
    /create table public\.lukas_qto_organization_entitlement_versions/i,
  );
  for (const field of [
    "plan",
    "seat_limit",
    "project_limit",
    "library_version_limit",
    "trial_ends_at",
    "features",
    "version_no",
  ])
    assert.match(sql, new RegExp(`${field} `, "i"));
  assert.match(
    sql,
    /before update or delete on public\.lukas_qto_organization_entitlement_versions/i,
  );
  assert.match(sql, /lukas_qto_set_organization_entitlement/i);
  assert.match(sql, /lukas_qto_organization_feature_enabled/i);
  assert.match(
    sql,
    /features-array\['drawing_workspace','organization_library','realtime_collaboration','ifc_workspace','quantity_lineage'\]='\{\}'::jsonb/i,
  );
  assert.match(sql, /seat limit/i);
  assert.match(sql, /project quota/i);
  assert.match(sql, /library version quota/i);
  assert.doesNotMatch(sql, /stripe|checkout|payment_intent/i);
});

test("role and entitlement changes are append-only audited and direct privilege escalation is fenced", async () => {
  const sql = await migration();
  assert.match(
    sql,
    /create table public\.lukas_qto_organization_admin_events/i,
  );
  assert.match(sql, /organization_role_changed/i);
  assert.match(sql, /entitlement_changed/i);
  assert.match(
    sql,
    /before update or delete on public\.lukas_qto_organization_admin_events/i,
  );
  assert.match(
    sql,
    /revoke insert,update,delete on table public\.lukas_qto_organization_members from authenticated/i,
  );
  assert.match(sql, /lukas_qto_change_organization_member/i);
  assert.match(sql, /p_role not in\('admin','member'\)/i);
  assert.match(sql, /cannot change the organization owner/i);
  assert.doesNotMatch(sql, /to authenticated\s+using\s*\(\s*true\s*\)/i);
});

test("project membership and organization move are exact RPC authorities", async () => {
  const sql = await migration();
  assert.match(sql, /lukas_qto_list_project_members/i);
  assert.match(sql, /lukas_qto_project_membership_manager/i);
  assert.match(sql, /lukas_qto_set_project_member/i);
  assert.match(sql, /lukas_qto_remove_project_member/i);
  assert.match(sql, /lukas_qto_move_project/i);
  assert.match(sql, /lukas_qto_project_organization_guard/i);
  assert.match(sql, /destination organization/i);
  assert.match(sql, /retention/i);
  assert.match(sql, /library imports/i);
  assert.match(sql, /organization_id=p_destination_organization_id/i);
  for (const table of [
    "lukas_drawing_revisions",
    "lukas_drawing_revision_approvals",
    "lukas_qto_boq_versions",
    "lukas_qto_boq_approvals",
    "lukas_drawing_quantity_links",
    "lukas_drawing_boq_links",
    "lukas_drawing_material_links",
    "lukas_qto_material_plans",
    "lukas_qto_material_transactions",
  ])
    assert.match(
      sql,
      new RegExp(`exists\\(select 1 from public\\.${table}`, "i"),
      `${table} must conservatively fence organization moves`,
    );
  assert.match(sql, /approved drawing, boq, quantity, or material evidence/i);
});

test("organization administration list RPCs expose deterministic bounded keysets", async () => {
  const sql = await migration();
  for (const rpc of [
    "lukas_qto_list_organization_invitations",
    "lukas_qto_list_organization_projects",
    "lukas_qto_list_managed_organizations",
  ]) {
    assert.match(sql, new RegExp(`create function public\\.${rpc}`, "i"));
    assert.match(
      sql,
      new RegExp(`grant execute on function[\\s\\S]*public\\.${rpc}`, "i"),
    );
  }
  assert.match(sql, /order by i\.id[\s\S]*limit p_page_size/i);
  assert.match(sql, /order by p\.id[\s\S]*limit p_page_size/i);
  assert.match(sql, /order by o\.id[\s\S]*limit p_page_size/i);
});

test("library access and feature quotas are enforced at the database boundary", async () => {
  const sql = await migration();
  assert.match(sql, /add column library_access boolean not null default true/i);
  assert.match(sql, /lukas_qto_organization_library_access/i);
  assert.match(sql, /lukas_drawing_library_versions_entitlement_guard/i);
  assert.match(sql, /lukas_qto_projects_entitlement_guard/i);
  assert.match(sql, /organization_library/i);
  assert.match(sql, /drawing_workspace/i);
  assert.match(
    sql,
    /alter policy "organization members read drawing library entries"/i,
  );
  assert.match(
    sql,
    /rename to lukas_drawing_workspace_capability_pre_entitlement/i,
  );
  assert.match(
    sql,
    /lukas_qto_project_feature_active[\s\S]*drawing_workspace/i,
  );
  assert.match(
    sql,
    /rename to lukas_drawing_collaboration_authorize_pre_entitlement/i,
  );
  assert.match(
    sql,
    /lukas_drawing_collaboration_service_load_state_pre_entitlement/i,
  );
  assert.match(
    sql,
    /lukas_drawing_collaboration_service_bootstrap_pre_entitlement/i,
  );
  assert.match(
    sql,
    /rename to lukas_drawing_import_library_version_pre_entitlement/i,
  );
  assert.match(
    sql,
    /create function public\.lukas_drawing_import_library_version[\s\S]*lukas_qto_organization_library_access[\s\S]*lukas_drawing_import_library_version_pre_entitlement/i,
  );
});

test("quantity and BOQ reads and RPCs are fenced by quantity_lineage entitlement", async () => {
  const sql = await migration();
  for (const table of [
    "lukas_qto_price_books",
    "lukas_qto_price_resources",
    "lukas_drawing_quantity_links",
    "lukas_drawing_boq_links",
    "lukas_drawing_material_links",
    "lukas_qto_boq_versions",
    "lukas_qto_boq_sections",
    "lukas_qto_boq_lines",
    "lukas_qto_boq_wbs_nodes",
    "lukas_qto_boq_wbs_allocations",
    "lukas_qto_boq_quantity_mappings",
    "lukas_qto_boq_source_exclusions",
    "lukas_qto_boq_rate_components",
    "lukas_qto_boq_approvals",
  ])
    assert.match(
      sql,
      new RegExp(
        `create policy "P7 quantity lineage entitlement ${table}" on public\\.${table}[\\s\\S]*as restrictive[\\s\\S]*lukas_qto_project_feature_active\\([^)]*quantity_lineage`,
        "i",
      ),
      `${table} needs a restrictive feature policy`,
    );
  for (const rpc of [
    "lukas_drawing_put_boq_link",
    "lukas_drawing_delete_boq_link",
    "lukas_qto_boq_v1_1_input",
    "lukas_qto_decide_boq",
    "lukas_qto_import_boq_structure",
  ]) {
    assert.match(sql, new RegExp(`rename to ${rpc}_pre_entitlement`, "i"));
    assert.match(
      sql,
      new RegExp(
        `create function public\\.${rpc}[\\s\\S]*lukas_qto_project_feature_active\\([^)]*quantity_lineage[\\s\\S]*${rpc}_pre_entitlement`,
        "i",
      ),
    );
  }
  for (const rpc of [
    "lukas_drawing_insert_quantity_link",
    "lukas_qto_finalize_boq_v1_1",
    "lukas_drawing_insert_material_handoff",
  ]) {
    assert.match(sql, new RegExp(`rename to ${rpc}_pre_entitlement`, "i"));
    assert.match(
      sql,
      new RegExp(
        `create function private\\.${rpc}[\\s\\S]*lukas_qto_project_feature_active\\([^)]*quantity_lineage[\\s\\S]*${rpc}_pre_entitlement`,
        "i",
      ),
    );
  }
});

async function runtimeDatabase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema auth; create schema extensions; create schema private;
    create extension pgcrypto with schema extensions;
    create role anon; create role authenticated; create role service_role;
    create role lukas_drawing_collaboration;
    create table auth.users(
      id uuid primary key,email text,is_anonymous boolean not null default false
    );
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)
    $$;
    create table public.lukas_qto_organizations(
      id uuid primary key,name text not null,owner_id uuid not null references auth.users(id),
      is_personal boolean not null default false,created_at timestamptz not null default now()
    );
    create table public.lukas_qto_organization_members(
      organization_id uuid not null references public.lukas_qto_organizations(id),
      user_id uuid not null references auth.users(id),role text not null,
      created_at timestamptz not null default now(),primary key(organization_id,user_id)
    );
    create table public.lukas_qto_projects(
      id uuid primary key,organization_id uuid not null references public.lukas_qto_organizations(id),
      owner_id uuid not null references auth.users(id),name text not null,
      archived_at timestamptz,deletion_requested_at timestamptz,
      updated_at timestamptz not null default now()
    );
    create table public.lukas_qto_project_members(
      project_id uuid not null references public.lukas_qto_projects(id),
      user_id uuid not null references auth.users(id),role text not null,
      created_at timestamptz not null default now(),primary key(project_id,user_id)
    );
    create table public.lukas_drawing_library_versions(
      id uuid primary key default gen_random_uuid(),organization_id uuid not null,
      source_project_id uuid,status text not null
    );
    create table public.lukas_drawing_library_imports(
      id uuid primary key default gen_random_uuid(),project_id uuid not null,
      organization_id uuid not null
    );
    create table public.lukas_drawing_library_entries(
      id uuid primary key default gen_random_uuid(),organization_id uuid not null
    );
    create table public.lukas_qto_retention_events(
      id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null
    );
    create table public.lukas_qto_export_events(
      id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null
    );
    create table public.lukas_drawing_revisions(
      id uuid primary key,project_id uuid not null,status text not null
    );
    create table public.lukas_drawing_revision_approvals(
      id uuid primary key default gen_random_uuid(),project_id uuid not null,decision text not null
    );
    create table public.lukas_qto_boq_versions(
      id uuid primary key,project_id uuid not null,status text not null
    );
    create table public.lukas_qto_price_books(id uuid primary key,project_id uuid not null);
    create table public.lukas_qto_price_resources(id uuid primary key,project_id uuid not null);
    create table public.lukas_qto_boq_sections(id uuid primary key,project_id uuid not null);
    create table public.lukas_qto_boq_lines(id uuid primary key,project_id uuid not null);
    create table public.lukas_qto_boq_wbs_nodes(id uuid primary key,project_id uuid not null);
    create table public.lukas_qto_boq_wbs_allocations(id uuid primary key,project_id uuid not null);
    create table public.lukas_qto_boq_quantity_mappings(id uuid primary key,project_id uuid not null);
    create table public.lukas_qto_boq_source_exclusions(id uuid primary key,project_id uuid not null);
    create table public.lukas_qto_boq_rate_components(id uuid primary key,project_id uuid not null);
    create table public.lukas_qto_boq_approvals(
      id uuid primary key,version_id uuid not null,decision text not null
    );
    create table public.lukas_drawing_quantity_links(id uuid primary key,project_id uuid not null);
    create table public.lukas_drawing_boq_links(id uuid primary key,project_id uuid not null);
    create table public.lukas_drawing_material_links(id uuid primary key,project_id uuid not null);
    create table public.lukas_qto_material_plans(id uuid primary key,project_id uuid not null);
    create table public.lukas_qto_material_transactions(id uuid primary key,project_id uuid not null);
    create function private.lukas_qto_organization_role(p_organization_id uuid)
    returns text language sql stable security definer set search_path='' as $$
      select case when (select auth.jwt()->'app_metadata'->>'role')='hangil_staff' then 'staff'
        when o.owner_id=(select auth.uid()) then 'owner'
        else (select m.role from public.lukas_qto_organization_members m
          where m.organization_id=o.id and m.user_id=(select auth.uid())) end
      from public.lukas_qto_organizations o where o.id=p_organization_id
    $$;
    create function private.lukas_qto_project_role(p_project_id uuid)
    returns text language sql stable security definer set search_path='' as $$
      select case when (select auth.jwt()->'app_metadata'->>'role')='hangil_staff' then 'staff'
        when p.owner_id=(select auth.uid()) then 'owner'
        else (select m.role from public.lukas_qto_project_members m
          where m.project_id=p.id and m.user_id=(select auth.uid())) end
      from public.lukas_qto_projects p where p.id=p_project_id
    $$;
    create function private.lukas_drawing_workspace_capability(p_project_id uuid)
    returns text language sql stable security definer set search_path='' as $$
      select 'admin'::text
    $$;
    create function private.lukas_drawing_collaboration_authorize(
      p_user_id uuid,p_project_id uuid,p_revision_id uuid
    ) returns table(capability text,can_write boolean,revision_status text)
    language sql stable security definer set search_path='' as $$
      select 'editor'::text,true,'draft'::text
    $$;
    create function private.lukas_drawing_collaboration_service_load_state(
      p_project_id uuid,p_revision_id uuid
    ) returns table(
      revision_id uuid,project_id uuid,schema_version smallint,yjs_state bytea,
      yjs_sha256 text,base_operation_sequence bigint,store_generation bigint,
      byte_size integer,persisted_at timestamptz
    ) language sql stable security definer set search_path='' as $$
      select null::uuid,null::uuid,null::smallint,null::bytea,null::text,
        null::bigint,null::bigint,null::integer,null::timestamptz where false
    $$;
    create function private.lukas_drawing_collaboration_service_store_state(
      p_project_id uuid,p_revision_id uuid,p_schema_version smallint,
      p_yjs_state bytea,p_base_operation_sequence bigint,
      p_expected_generation bigint,p_expected_sha256 text
    ) returns table(
      revision_id uuid,project_id uuid,schema_version smallint,yjs_state bytea,
      yjs_sha256 text,base_operation_sequence bigint,store_generation bigint,
      byte_size integer,persisted_at timestamptz
    ) language sql security definer set search_path='' as $$
      select null::uuid,null::uuid,null::smallint,null::bytea,null::text,
        null::bigint,null::bigint,null::integer,null::timestamptz where false
    $$;
    create function private.lukas_drawing_collaboration_service_bootstrap(
      p_project_id uuid,p_revision_id uuid
    ) returns jsonb language sql stable security definer set search_path='' as $$
      select '{}'::jsonb
    $$;
    create function public.lukas_drawing_import_library_version(uuid,uuid,uuid,uuid,uuid)
    returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.lukas_drawing_put_boq_link(uuid,uuid,uuid,uuid,numeric,bigint)
    returns public.lukas_drawing_boq_links language sql as $$
      select null::public.lukas_drawing_boq_links
    $$;
    create function public.lukas_drawing_delete_boq_link(uuid,bigint)
    returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.lukas_qto_boq_v1_1_input(uuid)
    returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.lukas_qto_decide_boq(uuid,text,text)
    returns void language sql as $$ select null::void $$;
    create function public.lukas_qto_import_boq_structure(uuid,jsonb)
    returns void language sql as $$ select null::void $$;
    create function private.lukas_drawing_insert_quantity_link(uuid,uuid,uuid,uuid,text,text,uuid,bigint,text,numeric,text,text)
    returns public.lukas_drawing_quantity_links language sql as $$
      select null::public.lukas_drawing_quantity_links
    $$;
    create function private.lukas_qto_finalize_boq_v1_1(uuid,uuid,text,text,text,numeric,integer)
    returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function private.lukas_drawing_insert_material_handoff(uuid,uuid,text,uuid,text,jsonb,jsonb)
    returns jsonb language sql as $$ select '{}'::jsonb $$;
    alter table public.lukas_drawing_library_entries enable row level security;
    alter table public.lukas_drawing_library_versions enable row level security;
    alter table public.lukas_drawing_library_imports enable row level security;
    alter table public.lukas_qto_price_books enable row level security;
    alter table public.lukas_qto_price_resources enable row level security;
    alter table public.lukas_drawing_quantity_links enable row level security;
    alter table public.lukas_drawing_boq_links enable row level security;
    alter table public.lukas_drawing_material_links enable row level security;
    alter table public.lukas_qto_boq_versions enable row level security;
    alter table public.lukas_qto_boq_sections enable row level security;
    alter table public.lukas_qto_boq_lines enable row level security;
    alter table public.lukas_qto_boq_wbs_nodes enable row level security;
    alter table public.lukas_qto_boq_wbs_allocations enable row level security;
    alter table public.lukas_qto_boq_quantity_mappings enable row level security;
    alter table public.lukas_qto_boq_source_exclusions enable row level security;
    alter table public.lukas_qto_boq_rate_components enable row level security;
    alter table public.lukas_qto_boq_approvals enable row level security;
    create policy "organization members read drawing library entries"
      on public.lukas_drawing_library_entries for select to authenticated using(true);
    create policy "organization members read drawing library versions"
      on public.lukas_drawing_library_versions for select to authenticated using(true);
    create policy "organization members read drawing library imports"
      on public.lukas_drawing_library_imports for select to authenticated using(true);
    grant select,insert,update,delete on public.lukas_qto_organizations,
      public.lukas_qto_organization_members,public.lukas_qto_projects,
      public.lukas_qto_project_members to authenticated,service_role;
  `);
  const users = ["01", "02", "03", "04", "05"].map(
    (suffix) => `75000000-0000-4000-8000-0000000000${suffix}`,
  );
  await db.query(
    `insert into auth.users(id,email) values
      ($1,'owner@example.com'),($2,'admin@example.com'),($3,'member@example.com'),
      ($4,'invitee@example.com'),($5,'other@example.com')`,
    users,
  );
  await db.query(
    `insert into public.lukas_qto_organizations(id,name,owner_id) values
      ('75000000-0000-4000-8000-000000000101','One',$1),
      ('75000000-0000-4000-8000-000000000102','Other',$2)`,
    [users[0], users[4]],
  );
  await db.query(
    `insert into public.lukas_qto_organization_members(organization_id,user_id,role) values
      ('75000000-0000-4000-8000-000000000101',$1,'owner'),
      ('75000000-0000-4000-8000-000000000101',$2,'admin'),
      ('75000000-0000-4000-8000-000000000101',$3,'member'),
      ('75000000-0000-4000-8000-000000000102',$4,'owner')`,
    [users[0], users[1], users[2], users[4]],
  );
  await db.query(
    `insert into public.lukas_qto_projects(id,organization_id,owner_id,name) values
      ('75000000-0000-4000-8000-000000000201','75000000-0000-4000-8000-000000000101',$1,'Drawing')`,
    [users[0]],
  );
  await db.query(
    `insert into public.lukas_qto_project_members(project_id,user_id,role) values
      ('75000000-0000-4000-8000-000000000201',$1,'owner')`,
    [users[0]],
  );
  await db.exec(await migration());
  return { db, users };
}

function setSession(db, userId, staff = false) {
  return db.query(
    `select pg_catalog.set_config('request.jwt.claims',$1,false)`,
    [
      JSON.stringify({
        sub: userId,
        role: "authenticated",
        app_metadata: staff ? { role: "hangil_staff" } : {},
      }),
    ],
  );
}

test("PGlite executes exact invitation, seat, audit, and cross-organization authorities", async (context) => {
  const { db, users } = await runtimeDatabase();
  context.after(() => db.close());
  await setSession(db, users[0]);
  const expiredRequest = crypto.randomUUID();
  const {
    rows: [expired],
  } = await db.query(
    `select public.lukas_qto_invite_organization_member(
      '75000000-0000-4000-8000-000000000101','expired@example.com','member',true,1,$1) invitation`,
    [expiredRequest],
  );
  await db.query(
    `update public.lukas_qto_organization_invitations
     set expires_at=now()-interval '1 day'
     where id=$1`,
    [expired.invitation.invitationId],
  );
  const {
    rows: [replacement],
  } = await db.query(
    `select public.lukas_qto_invite_organization_member(
      '75000000-0000-4000-8000-000000000101','expired@example.com','member',true,1,$1) invitation`,
    [crypto.randomUUID()],
  );
  assert.notEqual(
    replacement.invitation.invitationId,
    expired.invitation.invitationId,
  );
  const {
    rows: [crossFeature],
  } = await db.query(
    `select public.lukas_qto_organization_feature_enabled(
      '75000000-0000-4000-8000-000000000102','drawing_workspace') enabled`,
  );
  assert.equal(crossFeature.enabled, false);
  await setSession(db, users[2]);
  await assert.rejects(
    db.query(
      `select * from public.lukas_qto_list_project_members(
        '75000000-0000-4000-8000-000000000201',null,100)`,
    ),
    /authority denied/i,
  );
  await setSession(db, users[0]);
  await assert.rejects(
    db.query(
      `select public.lukas_qto_invite_organization_member(
        '75000000-0000-4000-8000-000000000102','invitee@example.com','member',true,7,$1)`,
      [crypto.randomUUID()],
    ),
    /authority denied/i,
  );
  const inviteRequest = crypto.randomUUID();
  const {
    rows: [created],
  } = await db.query(
    `select public.lukas_qto_invite_organization_member(
      '75000000-0000-4000-8000-000000000101','invitee@example.com','member',true,7,$1) invitation`,
    [inviteRequest],
  );
  assert.equal("targetUserId" in created.invitation, false);
  const {
    rows: [unregistered],
  } = await db.query(
    `select public.lukas_qto_invite_organization_member(
      '75000000-0000-4000-8000-000000000101','unregistered@example.com','member',true,7,$1) invitation`,
    [crypto.randomUUID()],
  );
  assert.deepEqual(
    Object.keys(created.invitation).sort(),
    Object.keys(unregistered.invitation).sort(),
    "registered and unregistered emails must have indistinguishable response shape",
  );
  await setSession(db, users[3]);
  await assert.rejects(
    db.query(`select public.lukas_qto_accept_organization_invitation($1,$2)`, [
      created.invitation.invitationId,
      crypto.randomUUID(),
    ]),
    /seat limit/i,
  );
  await setSession(db, users[0], true);
  await db.query(
    `select public.lukas_qto_set_organization_entitlement(
      '75000000-0000-4000-8000-000000000101','team',4,10,100,null,
      '{"drawing_workspace":true,"organization_library":true,"realtime_collaboration":true,"ifc_workspace":true,"quantity_lineage":true}',
      'seat expansion',$1)`,
    [crypto.randomUUID()],
  );
  await setSession(db, users[3]);
  const acceptanceRequest = crypto.randomUUID();
  await db.query(
    `select public.lukas_qto_accept_organization_invitation($1,$2)`,
    [created.invitation.invitationId, acceptanceRequest],
  );
  const {
    rows: [acceptedRetry],
  } = await db.query(
    `select (public.lukas_qto_accept_organization_invitation($1,$2)).role role`,
    [created.invitation.invitationId, acceptanceRequest],
  );
  assert.equal(acceptedRetry.role, "member");
  await setSession(db, users[0]);
  const {
    rows: [inviteRetry],
  } = await db.query(
    `select public.lukas_qto_invite_organization_member(
      '75000000-0000-4000-8000-000000000101','invitee@example.com','member',true,7,$1) invitation`,
    [inviteRequest],
  );
  assert.equal(
    inviteRetry.invitation.invitationId,
    created.invitation.invitationId,
  );
  await assert.rejects(
    db.query(
      `update public.lukas_qto_organization_members set role='owner'
       where organization_id='75000000-0000-4000-8000-000000000101' and user_id=$1`,
      [users[2]],
    ),
    /RPC-only and audited/i,
  );
  const roleRequest = crypto.randomUUID();
  await db.query(
    `select public.lukas_qto_change_organization_member(
      '75000000-0000-4000-8000-000000000101',$1,'admin',false,$2)`,
    [users[2], roleRequest],
  );
  await setSession(db, users[2]);
  const { rows: adminVisibleMembers } = await db.query(
    `select * from public.lukas_qto_list_project_members(
      '75000000-0000-4000-8000-000000000201',null,100)`,
  );
  assert.equal(adminVisibleMembers.length, 1);
  await setSession(db, users[0]);
  await assert.rejects(
    db.query(
      `select public.lukas_qto_change_organization_member(
        '75000000-0000-4000-8000-000000000101',$1,'member',true,$2)`,
      [users[2], roleRequest],
    ),
    /Request ID does not match/i,
  );
  const {
    rows: [audit],
  } = await db.query(
    `select count(*)::int count from public.lukas_qto_organization_admin_events
     where organization_id='75000000-0000-4000-8000-000000000101'
       and event_type='organization_role_changed'`,
  );
  assert.equal(audit.count, 1);
  await assert.rejects(
    db.query(
      `update public.lukas_qto_organization_admin_events set details='{}' where organization_id='75000000-0000-4000-8000-000000000101'`,
    ),
    /append-only/i,
  );
  await setSession(db, users[4]);
  const {
    rows: [moveInvitation],
  } = await db.query(
    `select public.lukas_qto_invite_organization_member(
      '75000000-0000-4000-8000-000000000102','owner@example.com','admin',true,7,$1) invitation`,
    [crypto.randomUUID()],
  );
  await setSession(db, users[0]);
  await db.query(
    `select public.lukas_qto_accept_organization_invitation($1,$2)`,
    [moveInvitation.invitation.invitationId, crypto.randomUUID()],
  );
  await assert.rejects(
    db.query(
      `update public.lukas_qto_projects
       set organization_id='75000000-0000-4000-8000-000000000102'
       where id='75000000-0000-4000-8000-000000000201'`,
    ),
    /RPC-only and audited/i,
  );
  const moveRequest = crypto.randomUUID();
  await db.query(
    `select public.lukas_qto_move_project(
      '75000000-0000-4000-8000-000000000101',
      '75000000-0000-4000-8000-000000000201',
      '75000000-0000-4000-8000-000000000102','business unit move',$1)`,
    [moveRequest],
  );
  const {
    rows: [moveRetry],
  } = await db.query(
    `select (public.lukas_qto_move_project(
      '75000000-0000-4000-8000-000000000101',
      '75000000-0000-4000-8000-000000000201',
      '75000000-0000-4000-8000-000000000102','business unit move',$1)).organization_id organization_id`,
    [moveRequest],
  );
  assert.equal(
    moveRetry.organization_id,
    "75000000-0000-4000-8000-000000000102",
  );
  await db.query(
    `insert into public.lukas_qto_organizations(id,name,owner_id)
     values('75000000-0000-4000-8000-000000000103','Third',$1)`,
    [users[0]],
  );
  await db.query(
    `insert into public.lukas_qto_organization_members(organization_id,user_id,role)
     values('75000000-0000-4000-8000-000000000103',$1,'owner')
     on conflict do nothing`,
    [users[0]],
  );
  await db.query(
    `select public.lukas_qto_move_project(
      '75000000-0000-4000-8000-000000000102','75000000-0000-4000-8000-000000000201',
      '75000000-0000-4000-8000-000000000103','second move',$1)`,
    [crypto.randomUUID()],
  );
  await assert.rejects(
    db.query(
      `select public.lukas_qto_move_project(
        '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000201',
        '75000000-0000-4000-8000-000000000102','business unit move',$1)`,
      [moveRequest],
    ),
    /stored project move is no longer current/i,
  );
});

test("PGlite feature versions fence drawing and collaboration database authorities", async (context) => {
  const { db, users } = await runtimeDatabase();
  context.after(() => db.close());
  await setSession(db, users[0]);
  const projectId = "75000000-0000-4000-8000-000000000201";
  const revisionId = "75000000-0000-4000-8000-000000000301";
  const { rows: before } = await db.query(
    `select private.lukas_drawing_workspace_capability($1) capability`,
    [projectId],
  );
  assert.equal(before[0].capability, "admin");

  await setSession(db, users[0], true);
  await db.query(
    `select public.lukas_qto_set_organization_entitlement(
      '75000000-0000-4000-8000-000000000101','team',5,10,100,null,
      '{"drawing_workspace":false,"organization_library":true,"realtime_collaboration":false,"ifc_workspace":true,"quantity_lineage":true}',
      'feature fence',$1)`,
    [crypto.randomUUID()],
  );
  await setSession(db, users[0]);
  const { rows: after } = await db.query(
    `select private.lukas_drawing_workspace_capability($1) capability`,
    [projectId],
  );
  assert.equal(after[0].capability, null);
  await assert.rejects(
    db.query(
      `select * from private.lukas_drawing_collaboration_authorize($1,$2,$3)`,
      [users[0], projectId, revisionId],
    ),
    /entitlement is unavailable/i,
  );
  await assert.rejects(
    db.query(
      `select * from private.lukas_drawing_collaboration_service_load_state($1,$2)`,
      [projectId, revisionId],
    ),
    /entitlement is unavailable/i,
  );
});

test("PGlite conservatively rejects every approved and lineage project move", async (context) => {
  const { db, users } = await runtimeDatabase();
  context.after(() => db.close());
  await setSession(db, users[0]);
  await db.query(
    `insert into public.lukas_qto_organizations(id,name,owner_id)
     values('75000000-0000-4000-8000-000000000103','Destination',$1)`,
    [users[0]],
  );
  await db.query(
    `insert into public.lukas_qto_organization_members(organization_id,user_id,role)
     values('75000000-0000-4000-8000-000000000103',$1,'owner')
     on conflict do nothing`,
    [users[0]],
  );
  const projectId = "75000000-0000-4000-8000-000000000201";
  const evidenceCases = [
    {
      insert: `insert into public.lukas_drawing_revisions(id,project_id,status)
        values('75000000-0000-4000-8000-000000000301','${projectId}','approved')`,
      remove: `delete from public.lukas_drawing_revisions where id='75000000-0000-4000-8000-000000000301'`,
    },
    {
      insert: `insert into public.lukas_drawing_revision_approvals(id,project_id,decision)
        values('75000000-0000-4000-8000-000000000302','${projectId}','approved')`,
      remove: `delete from public.lukas_drawing_revision_approvals where id='75000000-0000-4000-8000-000000000302'`,
    },
    {
      insert: `insert into public.lukas_qto_boq_versions(id,project_id,status)
        values('75000000-0000-4000-8000-000000000303','${projectId}','approved')`,
      remove: `delete from public.lukas_qto_boq_versions where id='75000000-0000-4000-8000-000000000303'`,
    },
    {
      insert: `insert into public.lukas_qto_boq_versions(id,project_id,status)
          values('75000000-0000-4000-8000-000000000303','${projectId}','draft');
        insert into public.lukas_qto_boq_approvals(id,version_id,decision)
          values('75000000-0000-4000-8000-000000000304','75000000-0000-4000-8000-000000000303','approved')`,
      remove: `delete from public.lukas_qto_boq_approvals where id='75000000-0000-4000-8000-000000000304';
        delete from public.lukas_qto_boq_versions where id='75000000-0000-4000-8000-000000000303'`,
    },
    ...[
      "lukas_drawing_quantity_links",
      "lukas_drawing_boq_links",
      "lukas_drawing_material_links",
      "lukas_qto_material_plans",
      "lukas_qto_material_transactions",
    ].map((table, index) => ({
      insert: `insert into public.${table}(id,project_id)
        values('75000000-0000-4000-8000-${String(305 + index).padStart(12, "0")}','${projectId}')`,
      remove: `delete from public.${table}`,
    })),
  ];
  for (const evidence of evidenceCases) {
    await db.exec(evidence.insert);
    await assert.rejects(
      db.query(
        `select public.lukas_qto_move_project(
          '75000000-0000-4000-8000-000000000101',$1,
          '75000000-0000-4000-8000-000000000103','must stay',$2)`,
        [projectId, crypto.randomUUID()],
      ),
      /approved drawing, BOQ, quantity, or material evidence/i,
    );
    await db.exec(evidence.remove);
  }
});

test("real PostgreSQL organization authority is optional locally and required mode never becomes synthetic PASS", async (context) => {
  const databaseUrl = process.env.DRAWING_P7_REAL_DATABASE_URL;
  const required = process.env.DRAWING_P7_REQUIRE_REAL_POSTGRES === "1";
  if (!databaseUrl) {
    if (required) assert.fail("DRAWING_P7_REAL_DATABASE_URL is required");
    context.skip("DRAWING_P7_REAL_DATABASE_URL is unavailable");
    return;
  }
  const { default: postgres } = await import("postgres");
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const tables = await sql`
      select c.relname,c.relrowsecurity,
        pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT') authenticated_select,
        pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') authenticated_mutate,
        pg_catalog.has_table_privilege('service_role',c.oid,'UPDATE,DELETE') service_mutate
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in(
        'lukas_qto_organization_invitations','lukas_qto_organization_entitlement_versions',
        'lukas_qto_organization_admin_events') order by c.relname`;
    assert.equal(tables.length, 3);
    for (const table of tables) {
      assert.equal(table.relrowsecurity, true, table.relname);
      assert.equal(table.authenticated_select, true, table.relname);
      assert.equal(table.authenticated_mutate, false, table.relname);
      assert.equal(table.service_mutate, false, table.relname);
    }
    const restrictivePolicies = await sql`
      select pg_catalog.count(*)::integer count from pg_catalog.pg_policy p
      where p.polname like 'P7 quantity lineage entitlement %' and not p.polpermissive`;
    assert.equal(restrictivePolicies[0].count, 14);
    const appendTriggers = await sql`
      select p.prosecdef security_definer from pg_catalog.pg_trigger t
      join pg_catalog.pg_proc p on p.oid=t.tgfoid
      where t.tgname in('lukas_qto_organization_entitlement_versions_append_only',
        'lukas_qto_organization_admin_events_append_only')`;
    assert.equal(appendTriggers.length, 2);
    assert.ok(
      appendTriggers.every(({ security_definer }) => !security_definer),
    );

    const [scope] = await sql`
      select o.id organization_id,o.owner_id,
        (select m.user_id from public.lukas_qto_organization_members m
          where m.organization_id=o.id and m.role='admin' order by m.user_id limit 1) admin_id,
        (select m.user_id from public.lukas_qto_organization_members m
          where m.organization_id=o.id and m.role='member' order by m.user_id limit 1) member_id,
        (select p.id from public.lukas_qto_projects p
          where p.organization_id=o.id and p.archived_at is null order by p.id limit 1) project_id,
        (select other.id from public.lukas_qto_organizations other
          where other.id<>o.id order by other.id limit 1) other_organization_id
      from public.lukas_qto_organizations o
      where exists(select 1 from public.lukas_qto_organization_members m
        where m.organization_id=o.id and m.role='admin')
        and exists(select 1 from public.lukas_qto_organization_members m
          where m.organization_id=o.id and m.role='member')
        and exists(select 1 from public.lukas_qto_projects p
          where p.organization_id=o.id and p.archived_at is null)
      order by o.id limit 1`;
    assert.ok(
      scope,
      "real PostgreSQL gate needs an organization with owner/admin/member/project fixtures",
    );
    assert.ok(
      scope.other_organization_id,
      "real PostgreSQL gate needs a second organization",
    );
    const [entitlement] = await sql`
      select e.* from public.lukas_qto_organization_entitlement_versions e
      where e.organization_id=${scope.organization_id} order by e.version_no desc limit 1`;
    assert.ok(entitlement, "real PostgreSQL gate needs current entitlement");
    const [library] = await sql`
      select v.id version_id,e.kind from public.lukas_drawing_library_versions v
      join public.lukas_drawing_library_entries e on e.id=v.registry_id
      where v.organization_id=${scope.organization_id} and v.status='published'
      order by v.id limit 1`;
    assert.ok(
      library,
      "real PostgreSQL gate needs one known published library version",
    );
    const [draftRevision] = await sql`
      select r.id from public.lukas_drawing_revisions r
      where r.project_id=${scope.project_id} and r.status='draft' order by r.id limit 1`;
    if (library.kind !== "workspace_template")
      assert.ok(
        draftRevision,
        "entity library import needs a draft target revision",
      );
    const [boq] = await sql`
      select id,price_book_id from public.lukas_qto_boq_versions
      where project_id=${scope.project_id} order by id limit 1`;
    assert.ok(boq, "real PostgreSQL gate needs one BOQ version");
    const [drawingRevision] = await sql`
      select id from public.lukas_drawing_revisions
      where project_id=${scope.project_id} order by id limit 1`;
    assert.ok(
      drawingRevision,
      "real PostgreSQL gate needs one drawing revision",
    );
    const [event] = await sql`
      select id from public.lukas_qto_organization_admin_events
      where organization_id=${scope.organization_id} order by id limit 1`;
    assert.ok(
      event,
      "real PostgreSQL gate needs one append-only administration event",
    );
    const [migrationAuthority] = await sql`
      select pg_catalog.has_table_privilege(pg_catalog.current_user,
        'public.lukas_qto_organization_admin_events','UPDATE') can_update`;
    assert.equal(
      migrationAuthority.can_update,
      true,
      "real PostgreSQL URL must use migration authority to execute append guards",
    );
    await assert.rejects(
      sql`update public.lukas_qto_organization_admin_events set details=details where id=${event.id}`,
      /append-only/i,
    );

    const outsider = crypto.randomUUID();
    const claims = (sub, staff = false, role = "authenticated") =>
      JSON.stringify({
        role,
        sub,
        is_anonymous: false,
        app_metadata: staff ? { role: "hangil_staff" } : {},
      });
    const setActor = async (transaction, role, sub, staff = false) => {
      await transaction.unsafe("reset role");
      await transaction.unsafe(`set local role ${role}`);
      await transaction`select pg_catalog.set_config('request.jwt.claims',${claims(sub, staff, role)},true)`;
    };
    const asRole = (role, sub, operation) =>
      sql.begin(async (transaction) => {
        await setActor(transaction, role, sub);
        return operation(transaction);
      });
    const expectDeniedMutation = async (role, sub, operation, pattern) => {
      const unexpectedlyAllowed = new Error("mutation unexpectedly allowed");
      let failure;
      try {
        await sql.begin(async (transaction) => {
          await setActor(transaction, role, sub);
          await operation(transaction);
          throw unexpectedlyAllowed;
        });
      } catch (error) {
        failure = error;
      }
      assert.notEqual(failure, unexpectedlyAllowed);
      assert.match(String(failure?.message ?? failure), pattern);
    };

    const ownerInvitations = await asRole(
      "authenticated",
      scope.owner_id,
      (transaction) =>
        transaction`select id from public.lukas_qto_organization_invitations where organization_id=${scope.organization_id}`,
    );
    const adminEntitlements = await asRole(
      "authenticated",
      scope.admin_id,
      (transaction) =>
        transaction`select id from public.lukas_qto_organization_entitlement_versions where organization_id=${scope.organization_id}`,
    );
    assert.ok(Array.isArray(ownerInvitations));
    assert.ok(adminEntitlements.length > 0);
    const memberAdminRows = await asRole(
      "authenticated",
      scope.member_id,
      (transaction) =>
        transaction`select id from public.lukas_qto_organization_admin_events where organization_id=${scope.organization_id}`,
    );
    assert.equal(memberAdminRows.length, 0);
    const outsiderRows = await asRole(
      "authenticated",
      outsider,
      (transaction) =>
        transaction`select id from public.lukas_qto_organization_entitlement_versions where organization_id=${scope.organization_id}`,
    );
    assert.equal(outsiderRows.length, 0);
    const outsiderLibrary = await asRole(
      "authenticated",
      outsider,
      (transaction) =>
        transaction`select id from public.lukas_drawing_library_versions where organization_id=${scope.organization_id}`,
    );
    assert.equal(outsiderLibrary.length, 0);
    await expectDeniedMutation(
      "authenticated",
      outsider,
      (
        transaction,
      ) => transaction`select public.lukas_qto_invite_organization_member(
        ${scope.organization_id},'outsider-proof@example.com','member',true,1,${crypto.randomUUID()})`,
      /authority denied/i,
    );
    await expectDeniedMutation(
      "authenticated",
      scope.member_id,
      (
        transaction,
      ) => transaction`select public.lukas_qto_change_organization_member(
        ${scope.organization_id},${scope.member_id},'admin',true,${crypto.randomUUID()})`,
      /authority denied/i,
    );
    await expectDeniedMutation(
      "authenticated",
      outsider,
      (transaction) => transaction`select public.lukas_qto_move_project(
        ${scope.organization_id},${scope.project_id},${scope.other_organization_id},'cross organization',${crypto.randomUUID()})`,
      /authority denied/i,
    );
    await expectDeniedMutation(
      "authenticated",
      scope.owner_id,
      (
        transaction,
      ) => transaction`update public.lukas_qto_organization_members set role=role
        where organization_id=${scope.organization_id} and user_id=${scope.member_id}`,
      /permission denied|RPC-only and audited/i,
    );
    await expectDeniedMutation(
      "service_role",
      scope.owner_id,
      (transaction) =>
        transaction`update public.lukas_qto_organization_admin_events set details=details where id=${event.id}`,
      /permission denied|append-only/i,
    );

    const rollback = new Error("rollback entitlement proof");
    const entitlementWith = (feature, enabled) => ({
      ...entitlement.features,
      [feature]: enabled,
    });
    const beginEntitlementProof = async (features, operation) => {
      let failure;
      try {
        await sql.begin(async (transaction) => {
          await setActor(transaction, "authenticated", scope.owner_id, true);
          await transaction`select public.lukas_qto_set_organization_entitlement(
            ${scope.organization_id},${entitlement.plan},${entitlement.seat_limit},
            ${entitlement.project_limit},${entitlement.library_version_limit},${entitlement.trial_ends_at},
            ${JSON.stringify(features)}::jsonb,'real PostgreSQL entitlement proof',${crypto.randomUUID()})`;
          await operation(transaction);
          throw rollback;
        });
      } catch (error) {
        failure = error;
      }
      return failure;
    };
    const libraryFeatureFailure = await beginEntitlementProof(
      entitlementWith("organization_library", false),
      async (transaction) => {
        await setActor(transaction, "authenticated", scope.owner_id);
        await transaction`select public.lukas_drawing_import_library_version(
          ${scope.organization_id},${library.version_id},${scope.project_id},
          ${library.kind === "workspace_template" ? null : draftRevision.id},${crypto.randomUUID()})`;
      },
    );
    assert.match(
      String(libraryFeatureFailure?.message ?? libraryFeatureFailure),
      /library entitlement is unavailable/i,
    );

    const libraryAccessFailure = await beginEntitlementProof(
      entitlementWith("organization_library", true),
      async (transaction) => {
        await setActor(transaction, "authenticated", scope.owner_id);
        await transaction`select public.lukas_qto_change_organization_member(
          ${scope.organization_id},${scope.member_id},'member',false,${crypto.randomUUID()})`;
        await setActor(transaction, "authenticated", scope.member_id);
        await transaction`select public.lukas_drawing_import_library_version(
          ${scope.organization_id},${library.version_id},${scope.project_id},
          ${library.kind === "workspace_template" ? null : draftRevision.id},${crypto.randomUUID()})`;
      },
    );
    assert.match(
      String(libraryAccessFailure?.message ?? libraryAccessFailure),
      /library entitlement is unavailable/i,
    );

    let disabledBoqRows;
    let disabledPriceBookRows;
    const quantityReadFailure = await beginEntitlementProof(
      entitlementWith("quantity_lineage", false),
      async (transaction) => {
        await setActor(transaction, "authenticated", scope.owner_id);
        disabledBoqRows =
          await transaction`select id from public.lukas_qto_boq_versions where id=${boq.id}`;
        disabledPriceBookRows =
          await transaction`select id from public.lukas_qto_price_books where id=${boq.price_book_id}`;
      },
    );
    assert.equal(quantityReadFailure, rollback);
    assert.equal(disabledBoqRows.length, 0);
    assert.equal(disabledPriceBookRows.length, 0);
    const quantityRpcFailure = await beginEntitlementProof(
      entitlementWith("quantity_lineage", false),
      async (transaction) => {
        await setActor(transaction, "authenticated", scope.owner_id);
        await transaction`select public.lukas_qto_boq_v1_1_input(${boq.id})`;
      },
    );
    assert.match(
      String(quantityRpcFailure?.message ?? quantityRpcFailure),
      /quantity lineage entitlement is unavailable/i,
    );
    const serviceQuantityFailure = await beginEntitlementProof(
      entitlementWith("quantity_lineage", false),
      async (transaction) => {
        await setActor(transaction, "service_role", scope.owner_id);
        await transaction`select private.lukas_drawing_insert_quantity_link(
          ${scope.owner_id},${crypto.randomUUID()},${drawingRevision.id},${crypto.randomUUID()},'count',
          ${"0".repeat(64)},${crypto.randomUUID()},1,${"0".repeat(64)},1,'EA','P4_MEASUREMENT_V1')`;
      },
    );
    assert.match(
      String(serviceQuantityFailure?.message ?? serviceQuantityFailure),
      /quantity lineage entitlement is unavailable/i,
    );
  } finally {
    await sql.end();
  }
});
