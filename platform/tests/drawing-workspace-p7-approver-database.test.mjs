import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migrationUrl = new URL(
  "../supabase/migrations/20260828120000_drawing_workspace_approver_separation.sql",
  import.meta.url,
);

test("P7 separates reviewer recommendation from approver final authority", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /when 'approver' then 'approver'/i);
  assert.match(sql, /project_members_role_check[\s\S]*'approver'/i);
  assert.match(
    sql,
    /project_feature_active\(p_project_id,'drawing_workspace'\)/i,
  );
  assert.match(sql, /p_role not in\('estimator','reviewer','approver'/i);
  assert.match(sql, /new\.decision='reviewed'[\s\S]*v_role<>'reviewer'/i);
  assert.match(sql, /new\.decision='approved'[\s\S]*v_role<>'approver'/i);
  assert.match(sql, /decision='reviewed'[\s\S]*decided_by<>v_actor/i);
  assert.match(sql, /status='reviewed'[\s\S]*status='approved'/i);
  assert.doesNotMatch(
    sql,
    /new\.decision='approved'[\s\S]{0,200}v_role[^;]*'reviewer'/i,
  );
});

test("PGlite enforces reviewer then independent approver and denies role crossover", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema auth; create schema private; create schema extensions;
    create extension pgcrypto with schema extensions;
    create role anon; create role authenticated; create role service_role;
    create table auth.users(id uuid primary key,email text,is_anonymous boolean default false);
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    create table public.lukas_qto_projects(id uuid primary key,organization_id uuid,owner_id uuid);
    create table public.lukas_qto_project_members(project_id uuid,user_id uuid,role text constraint lukas_qto_project_members_role_check check(role in('owner','estimator','reviewer','site','procurement','viewer')),created_at timestamptz default now(),primary key(project_id,user_id));
    create function private.lukas_qto_project_role(p uuid) returns text language sql stable as $$
      select case when q.owner_id=auth.uid() then 'owner' else (select m.role from public.lukas_qto_project_members m where m.project_id=q.id and m.user_id=auth.uid()) end from public.lukas_qto_projects q where q.id=p $$;
    create function private.lukas_qto_project_feature_active(uuid,text) returns boolean language sql stable as $$ select true $$;
    create function private.lukas_drawing_collaboration_capability_for_user(uuid,uuid) returns text language sql stable as $$ select 'viewer' $$;
    create function private.lukas_qto_project_membership_manager(uuid) returns boolean language sql as $$ select false $$;
    create function private.lukas_qto_admin_request_sha(jsonb) returns text language sql as $$ select repeat('a',64) $$;
    create function private.lukas_qto_admin_retry_matches(uuid,uuid,text) returns boolean language sql as $$ select false $$;
    create table public.lukas_qto_organization_members(organization_id uuid,user_id uuid,primary key(organization_id,user_id));
    create table public.lukas_qto_organization_admin_events(organization_id uuid,event_type text,subject_user_id uuid,project_id uuid,request_id uuid,request_sha256 text,details jsonb,actor_id uuid);
    create table public.lukas_drawing_revisions(
      id uuid primary key,project_id uuid not null,version bigint not null,created_by uuid not null,
      status text not null,review_requested_at timestamptz,approved_at timestamptz,updated_at timestamptz default now(),
      constraint lukas_drawing_revisions_status_check check(status in('draft','review_requested','approved','superseded')),
      constraint lukas_drawing_revisions_check check((status='draft' and review_requested_at is null and approved_at is null) or (status='review_requested' and review_requested_at is not null and approved_at is null) or (status in('approved','superseded') and review_requested_at is not null and approved_at is not null)),
      unique(id,project_id)
    );
    create table public.lukas_drawing_snapshots(revision_id uuid,project_id uuid,revision_version bigint,sha256 text,unique(revision_id,project_id,revision_version,sha256));
    create table public.lukas_drawing_revision_approvals(
      id uuid primary key default gen_random_uuid(),revision_id uuid,project_id uuid,subject_version bigint,snapshot_sha256 text,
      decision text constraint lukas_drawing_revision_approvals_decision_check check(decision in('approved','rejected')),
      note text,decided_by uuid,created_at timestamptz default now(),
      constraint lukas_drawing_revision_approvals_revision_id_subject_version_key unique(revision_id,subject_version)
    );
    create function private.lukas_drawing_workspace_capability(uuid) returns text language sql as $$ select 'viewer' $$;
    create function private.lukas_drawing_revision_approval_guard() returns trigger language plpgsql as $$ begin return new; end $$;
    create function private.lukas_drawing_apply_revision_approval() returns trigger language plpgsql as $$ begin return new; end $$;
    create function private.lukas_drawing_record_revision_decision(uuid,bigint,text,text,text) returns jsonb language sql as $$ select '{}'::jsonb $$;
    create trigger lukas_drawing_revision_approvals_validate before insert on public.lukas_drawing_revision_approvals for each row execute function private.lukas_drawing_revision_approval_guard();
    create trigger lukas_drawing_revision_approvals_apply after insert on public.lukas_drawing_revision_approvals for each row execute function private.lukas_drawing_apply_revision_approval();
    alter table public.lukas_drawing_revision_approvals enable row level security;
    create policy "revision approvals enforce maker checker" on public.lukas_drawing_revision_approvals for insert to authenticated with check(true);
    create function public.lukas_qto_set_project_member(uuid,uuid,text,text,uuid) returns public.lukas_qto_project_members language sql as $$ select null::public.lukas_qto_project_members $$;
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
  const ids = {
    project: "10000000-0000-4000-8000-000000000001",
    author: "10000000-0000-4000-8000-000000000002",
    reviewer: "10000000-0000-4000-8000-000000000003",
    approver: "10000000-0000-4000-8000-000000000004",
    revision: "10000000-0000-4000-8000-000000000005",
  };
  await db.query(
    `insert into auth.users(id,email) values($1,'a@one.hk'),($2,'r@one.hk'),($3,'p@one.hk')`,
    [ids.author, ids.reviewer, ids.approver],
  );
  await db.query(
    `insert into public.lukas_qto_projects(id,owner_id) values($1,$2)`,
    [ids.project, ids.author],
  );
  await db.query(
    `insert into public.lukas_qto_project_members(project_id,user_id,role) values($1,$2,'reviewer'),($1,$3,'approver')`,
    [ids.project, ids.reviewer, ids.approver],
  );
  await db.query(
    `insert into public.lukas_drawing_revisions(id,project_id,version,created_by,status,review_requested_at) values($1,$2,1,$3,'review_requested',now())`,
    [ids.revision, ids.project, ids.author],
  );
  await db.query(
    `insert into public.lukas_drawing_snapshots values($1,$2,1,$3)`,
    [ids.revision, ids.project, "a".repeat(64)],
  );
  const session = (id) =>
    db.query(`select set_config('request.jwt.claims',$1,false)`, [
      JSON.stringify({ sub: id }),
    ]);
  await session(ids.reviewer);
  await db.query(
    `insert into public.lukas_drawing_revision_approvals(revision_id,project_id,subject_version,snapshot_sha256,decision,note,decided_by) values($1,$2,1,$3,'reviewed','ok',$4)`,
    [ids.revision, ids.project, "a".repeat(64), ids.reviewer],
  );
  assert.equal(
    (
      await db.query(
        `select status from public.lukas_drawing_revisions where id=$1`,
        [ids.revision],
      )
    ).rows[0].status,
    "reviewed",
  );
  await assert.rejects(
    db.query(
      `insert into public.lukas_drawing_revision_approvals(revision_id,project_id,subject_version,snapshot_sha256,decision,note,decided_by) values($1,$2,1,$3,'approved','bad',$4)`,
      [ids.revision, ids.project, "a".repeat(64), ids.reviewer],
    ),
    /approver/i,
  );
  await session(ids.approver);
  await db.query(
    `insert into public.lukas_drawing_revision_approvals(revision_id,project_id,subject_version,snapshot_sha256,decision,note,decided_by) values($1,$2,1,$3,'approved','final',$4)`,
    [ids.revision, ids.project, "a".repeat(64), ids.approver],
  );
  assert.equal(
    (
      await db.query(
        `select status from public.lukas_drawing_revisions where id=$1`,
        [ids.revision],
      )
    ).rows[0].status,
    "approved",
  );
  await db.close();
});
