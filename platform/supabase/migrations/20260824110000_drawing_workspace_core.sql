-- P0/P1 drawing workspace: project-scoped domain state, immutable review
-- evidence, and atomic command processing. Source-file bytes and metadata stay
-- append-only; this migration only references their recorded IDs and SHA-256.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.lukas_drawing_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  source_file_id uuid,
  source_sha256 text check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'),
  title text not null check (char_length(trim(title)) between 1 and 240),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  constraint lukas_drawing_documents_source_identity_fkey
    foreign key (source_file_id, project_id, source_sha256)
    references public.lukas_qto_files (id, project_id, sha256) on delete restrict,
  check ((source_file_id is null) = (source_sha256 is null))
);

create table public.lukas_drawing_revisions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  parent_revision_id uuid,
  sequence integer not null check (sequence > 0),
  status text not null default 'draft'
    check (status in ('draft', 'review_requested', 'approved', 'superseded')),
  version bigint not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  review_requested_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  unique (id, document_id, project_id),
  unique (document_id, sequence),
  constraint lukas_drawing_revisions_document_fkey
    foreign key (document_id, project_id)
    references public.lukas_drawing_documents(id, project_id) on delete cascade,
  constraint lukas_drawing_revisions_parent_fkey
    foreign key (parent_revision_id, document_id, project_id)
    references public.lukas_drawing_revisions(id, document_id, project_id) on delete restrict,
  check (parent_revision_id is null or parent_revision_id <> id),
  check (
    (status = 'draft' and review_requested_at is null and approved_at is null)
    or (status = 'review_requested' and review_requested_at is not null and approved_at is null)
    or (status in ('approved', 'superseded')
      and review_requested_at is not null and approved_at is not null)
  )
);

create table public.lukas_drawing_pages (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  page_number integer not null check (page_number > 0),
  width_mm numeric(18,6) not null default 420 check (width_mm > 0),
  height_mm numeric(18,6) not null default 297 check (height_mm > 0),
  background_source_file_id uuid,
  background_source_sha256 text
    check (background_source_sha256 is null or background_source_sha256 ~ '^[0-9a-f]{64}$'),
  background_pdf_page integer check (background_pdf_page is null or background_pdf_page > 0),
  calibration jsonb check (calibration is null or jsonb_typeof(calibration) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, revision_id, project_id),
  unique (revision_id, page_number),
  constraint lukas_drawing_pages_revision_fkey
    foreign key (revision_id, project_id)
    references public.lukas_drawing_revisions(id, project_id) on delete cascade,
  constraint lukas_drawing_pages_background_source_fkey
    foreign key (background_source_file_id, project_id, background_source_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict,
  check (
    (background_source_file_id is null and background_source_sha256 is null
      and background_pdf_page is null)
    or (background_source_file_id is not null and background_source_sha256 is not null
      and background_pdf_page is not null)
  )
);

create table public.lukas_drawing_layers (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null,
  revision_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 255),
  sort_order integer not null default 0,
  visible boolean not null default true,
  locked boolean not null default false,
  system_kind text not null default 'custom'
    check (system_kind in ('source', 'work', 'custom')),
  version bigint not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, revision_id, project_id),
  unique (page_id, name),
  constraint lukas_drawing_layers_page_fkey
    foreign key (page_id, revision_id, project_id)
    references public.lukas_drawing_pages(id, revision_id, project_id) on delete cascade,
  check (system_kind <> 'source' or locked)
);

create table public.lukas_drawing_objects (
  id uuid primary key,
  lineage_id uuid not null,
  page_id uuid not null,
  layer_id uuid not null,
  revision_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  object_type text not null
    check (object_type in ('line', 'polyline', 'rectangle', 'circle', 'text', 'dimension')),
  geometry jsonb not null check (jsonb_typeof(geometry) = 'object'),
  style jsonb not null check (jsonb_typeof(style) = 'object'),
  status text not null default 'active' check (status in ('active', 'deleted')),
  version bigint not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, revision_id, project_id),
  unique (revision_id, lineage_id),
  constraint lukas_drawing_objects_page_fkey
    foreign key(page_id, revision_id, project_id)
    references public.lukas_drawing_pages(id, revision_id, project_id) on delete cascade,
  constraint lukas_drawing_objects_layer_fkey
    foreign key(layer_id, revision_id, project_id)
    references public.lukas_drawing_layers(id, revision_id, project_id) on delete restrict
);

create table public.lukas_drawing_operations (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  sequence bigint not null check (sequence > 0),
  client_operation_id uuid not null,
  operation_type text not null check (operation_type in (
    'add_objects', 'update_objects', 'delete_objects', 'add_layer', 'update_layer'
  )),
  base_versions jsonb not null check (jsonb_typeof(base_versions) = 'object'),
  forward jsonb not null check (jsonb_typeof(forward) = 'object'),
  inverse jsonb not null check (jsonb_typeof(inverse) = 'object'),
  result_versions jsonb not null check (jsonb_typeof(result_versions) = 'object'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (revision_id, sequence),
  unique(revision_id, client_operation_id),
  constraint lukas_drawing_operations_revision_fkey
    foreign key (revision_id, project_id)
    references public.lukas_drawing_revisions(id, project_id) on delete cascade
);

create table public.lukas_drawing_snapshots (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  revision_version bigint not null check (revision_version > 0),
  operation_sequence bigint not null check (operation_sequence >= 0),
  canonical_json jsonb not null check (jsonb_typeof(canonical_json) = 'object'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (revision_id, revision_version),
  unique (revision_id, project_id, revision_version, sha256),
  constraint lukas_drawing_snapshots_revision_fkey
    foreign key (revision_id, project_id)
    references public.lukas_drawing_revisions(id, project_id) on delete cascade
);

create table public.lukas_drawing_revision_approvals (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  subject_version bigint not null check (subject_version > 0),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  decision text not null check (decision in ('approved', 'rejected')),
  note text not null default '' check (char_length(note) <= 5000),
  decided_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (revision_id, subject_version),
  constraint lukas_drawing_revision_approvals_snapshot_fkey
    foreign key (revision_id, project_id, subject_version, snapshot_sha256)
    references public.lukas_drawing_snapshots(
      revision_id, project_id, revision_version, sha256
    ) on delete restrict
);

create table public.lukas_drawing_object_sources (
  id uuid primary key default gen_random_uuid(),
  object_id uuid not null,
  revision_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  source_file_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_kind text not null check (source_kind in ('pdf_region', 'ifc_element')),
  pdf_page_number integer,
  x numeric(12,10),
  y numeric(12,10),
  width numeric(12,10),
  height numeric(12,10),
  element_id text,
  ifc_global_id text,
  camera_json jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (object_id, source_file_id, source_kind),
  constraint lukas_drawing_object_sources_object_fkey
    foreign key (object_id, revision_id, project_id)
    references public.lukas_drawing_objects(id, revision_id, project_id) on delete cascade,
  constraint lukas_drawing_object_sources_file_fkey
    foreign key (source_file_id, project_id, source_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict,
  check (
    (source_kind = 'pdf_region'
      and pdf_page_number is not null
      and x is not null and y is not null
      and width is not null and height is not null
      and pdf_page_number > 0
      and x >= 0 and y >= 0 and width > 0 and height > 0
      and x + width <= 1 and y + height <= 1
      and element_id is null and ifc_global_id is null and camera_json is null)
    or
    (source_kind = 'ifc_element'
      and pdf_page_number is null and x is null and y is null and width is null and height is null
      and (element_id is not null or ifc_global_id is not null)
      and (element_id is null or char_length(trim(element_id)) between 1 and 128)
      and (ifc_global_id is null or ifc_global_id ~ '^[0-9A-Za-z_$]{22}$')
      and (camera_json is null or jsonb_typeof(camera_json) = 'object'))
  )
);

create table public.lukas_drawing_object_issue_links (
  id uuid primary key default gen_random_uuid(),
  object_id uuid not null,
  revision_id uuid not null,
  issue_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (object_id, issue_id),
  constraint lukas_drawing_object_issue_links_object_fkey
    foreign key (object_id, revision_id, project_id)
    references public.lukas_drawing_objects(id, revision_id, project_id) on delete cascade,
  constraint lukas_drawing_object_issue_links_issue_fkey
    foreign key (issue_id, project_id)
    references public.lukas_drawing_issues(id, project_id) on delete cascade
);

create index lukas_drawing_documents_project_idx
  on public.lukas_drawing_documents(project_id, updated_at desc);
create index lukas_drawing_documents_source_idx
  on public.lukas_drawing_documents(source_file_id, project_id, source_sha256)
  where source_file_id is not null;
create index lukas_drawing_documents_created_by_idx
  on public.lukas_drawing_documents(created_by);
create index lukas_drawing_revisions_document_idx
  on public.lukas_drawing_revisions(document_id, project_id, sequence desc);
create index lukas_drawing_revisions_project_idx
  on public.lukas_drawing_revisions(project_id, status, sequence desc);
create index lukas_drawing_revisions_parent_idx
  on public.lukas_drawing_revisions(parent_revision_id, document_id, project_id)
  where parent_revision_id is not null;
create index lukas_drawing_revisions_created_by_idx
  on public.lukas_drawing_revisions(created_by);
create index lukas_drawing_pages_revision_idx
  on public.lukas_drawing_pages(revision_id, project_id, page_number);
create index lukas_drawing_pages_project_idx
  on public.lukas_drawing_pages(project_id, revision_id, page_number);
create index lukas_drawing_pages_background_source_idx
  on public.lukas_drawing_pages(
    background_source_file_id, project_id, background_source_sha256
  ) where background_source_file_id is not null;
create index lukas_drawing_layers_page_idx
  on public.lukas_drawing_layers(page_id, revision_id, project_id, sort_order);
create index lukas_drawing_layers_project_idx
  on public.lukas_drawing_layers(project_id, revision_id, page_id);
create index lukas_drawing_layers_created_by_idx
  on public.lukas_drawing_layers(created_by);
create index lukas_drawing_objects_page_idx
  on public.lukas_drawing_objects(page_id, revision_id, project_id);
create index lukas_drawing_objects_project_idx
  on public.lukas_drawing_objects(project_id, revision_id, status);
create index lukas_drawing_objects_layer_idx
  on public.lukas_drawing_objects(layer_id, revision_id, project_id);
create index lukas_drawing_objects_created_by_idx
  on public.lukas_drawing_objects(created_by);
create index lukas_drawing_objects_updated_by_idx
  on public.lukas_drawing_objects(updated_by);
create index lukas_drawing_operations_revision_idx
  on public.lukas_drawing_operations(revision_id, project_id, sequence);
create index lukas_drawing_operations_project_idx
  on public.lukas_drawing_operations(project_id, revision_id, sequence);
create index lukas_drawing_operations_actor_idx
  on public.lukas_drawing_operations(actor_id, created_at desc);
create index lukas_drawing_snapshots_revision_idx
  on public.lukas_drawing_snapshots(revision_id, project_id, revision_version);
create index lukas_drawing_snapshots_project_idx
  on public.lukas_drawing_snapshots(project_id, revision_id, revision_version);
create index lukas_drawing_snapshots_created_by_idx
  on public.lukas_drawing_snapshots(created_by);
create index lukas_drawing_approvals_snapshot_idx
  on public.lukas_drawing_revision_approvals(
    revision_id, project_id, subject_version, snapshot_sha256
  );
create index lukas_drawing_revision_approvals_project_idx
  on public.lukas_drawing_revision_approvals(project_id, revision_id, subject_version);
create index lukas_drawing_approvals_decided_by_idx
  on public.lukas_drawing_revision_approvals(decided_by, created_at desc);
create index lukas_drawing_object_sources_object_idx
  on public.lukas_drawing_object_sources(object_id, revision_id, project_id);
create index lukas_drawing_object_sources_project_idx
  on public.lukas_drawing_object_sources(project_id, revision_id, object_id);
create index lukas_drawing_object_sources_file_idx
  on public.lukas_drawing_object_sources(source_file_id, project_id, source_sha256);
create index lukas_drawing_object_sources_created_by_idx
  on public.lukas_drawing_object_sources(created_by);
create index lukas_drawing_object_issue_links_object_idx
  on public.lukas_drawing_object_issue_links(object_id, revision_id, project_id);
create index lukas_drawing_object_issue_links_project_idx
  on public.lukas_drawing_object_issue_links(project_id, revision_id, object_id);
create index lukas_drawing_object_issue_links_issue_idx
  on public.lukas_drawing_object_issue_links(issue_id, project_id);
create index lukas_drawing_object_issue_links_created_by_idx
  on public.lukas_drawing_object_issue_links(created_by);

create or replace function private.lukas_drawing_revision_guard()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
begin
  if old.status = 'approved' then
    raise exception 'Approved drawing revision is immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.document_id is distinct from old.document_id
     or new.project_id is distinct from old.project_id
     or new.parent_revision_id is distinct from old.parent_revision_id
     or new.sequence is distinct from old.sequence
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Drawing revision identity is immutable';
  end if;
  if new.status = old.status and new.version is distinct from old.version then
    raise exception 'Direct drawing revision version update is forbidden';
  end if;
  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'review_requested' then
      if new.version <> old.version or new.review_requested_at is null
         or not exists (
           select 1 from public.lukas_drawing_snapshots s
           where s.revision_id = old.id
             and s.project_id = old.project_id
             and s.revision_version = old.version
         ) then
        raise exception 'Drawing review request requires a canonical snapshot';
      end if;
    elsif old.status = 'review_requested' and new.status = 'approved' then
      if new.version <> old.version or new.approved_at is null
         or not exists (
           select 1 from public.lukas_drawing_revision_approvals a
           where a.revision_id = old.id
             and a.project_id = old.project_id
             and a.subject_version = old.version
             and a.decision = 'approved'
         ) then
        raise exception 'Drawing approval requires an append-only decision';
      end if;
    elsif old.status = 'review_requested' and new.status = 'draft' then
      if new.version <> old.version + 1
         or new.review_requested_at is not null or new.approved_at is not null
         or not exists (
           select 1 from public.lukas_drawing_revision_approvals a
           where a.revision_id = old.id
             and a.project_id = old.project_id
             and a.subject_version = old.version
             and a.decision = 'rejected'
         ) then
        raise exception 'Drawing rejection requires an append-only decision';
      end if;
    else
      raise exception 'Direct drawing revision status update is forbidden';
    end if;
  end if;
  return new;
end;
$$;

create trigger lukas_drawing_revisions_guard
before update or delete on public.lukas_drawing_revisions
for each row execute function private.lukas_drawing_revision_guard();

create or replace function private.lukas_drawing_draft_child_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old jsonb := pg_catalog.to_jsonb(old);
  v_new jsonb := pg_catalog.to_jsonb(new);
  v_revision_id uuid := (v_old ->> 'revision_id')::uuid;
  v_project_id uuid := (v_old ->> 'project_id')::uuid;
  v_status text;
  v_actor uuid := (select auth.uid());
  v_capability text;
begin
  v_capability := private.lukas_drawing_workspace_capability(v_project_id);
  if v_actor is null or v_capability is null
     or v_capability not in ('admin', 'editor') then
    raise exception 'Drawing workspace editor capability required';
  end if;
  select r.status into v_status
  from public.lukas_drawing_revisions r
  where r.id = v_revision_id and r.project_id = v_project_id
  for update;
  if v_status is null then
    raise exception 'Drawing revision does not exist';
  end if;
  if v_status <> 'draft' then
    raise exception 'Approved drawing revision is immutable';
  end if;
  if tg_op = 'UPDATE'
     and ((v_new ->> 'revision_id') is distinct from (v_old ->> 'revision_id')
       or (v_new ->> 'project_id') is distinct from (v_old ->> 'project_id')) then
    raise exception 'Drawing child revision identity is immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger lukas_drawing_pages_revision_guard
before update or delete on public.lukas_drawing_pages
for each row execute function private.lukas_drawing_draft_child_guard();
create trigger lukas_drawing_layers_revision_guard
before update or delete on public.lukas_drawing_layers
for each row execute function private.lukas_drawing_draft_child_guard();
create trigger lukas_drawing_objects_revision_guard
before update or delete on public.lukas_drawing_objects
for each row execute function private.lukas_drawing_draft_child_guard();

create or replace function private.lukas_drawing_draft_child_insert_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_new jsonb := pg_catalog.to_jsonb(new);
  v_revision_id uuid := (v_new ->> 'revision_id')::uuid;
  v_project_id uuid := (v_new ->> 'project_id')::uuid;
  v_status text;
  v_actor uuid := (select auth.uid());
  v_capability text;
begin
  v_capability := private.lukas_drawing_workspace_capability(v_project_id);
  if v_actor is null or v_capability is null
     or v_capability not in ('admin', 'editor') then
    raise exception 'Drawing workspace editor capability required';
  end if;
  select r.status into v_status
  from public.lukas_drawing_revisions r
  where r.id = v_revision_id and r.project_id = v_project_id
  for update;
  if v_status is null then
    raise exception 'Drawing revision does not exist';
  end if;
  if v_status <> 'draft' then
    raise exception 'Drawing revision is immutable outside draft';
  end if;
  return new;
end;
$$;

create trigger lukas_drawing_pages_insert_revision_guard
before insert on public.lukas_drawing_pages
for each row execute function private.lukas_drawing_draft_child_insert_guard();
create trigger lukas_drawing_layers_insert_revision_guard
before insert on public.lukas_drawing_layers
for each row execute function private.lukas_drawing_draft_child_insert_guard();
create trigger lukas_drawing_objects_insert_revision_guard
before insert on public.lukas_drawing_objects
for each row execute function private.lukas_drawing_draft_child_insert_guard();
create trigger lukas_drawing_operations_insert_revision_guard
before insert on public.lukas_drawing_operations
for each row execute function private.lukas_drawing_draft_child_insert_guard();
create trigger lukas_drawing_snapshots_insert_revision_guard
before insert on public.lukas_drawing_snapshots
for each row execute function private.lukas_drawing_draft_child_insert_guard();
create trigger lukas_drawing_object_sources_insert_revision_guard
before insert on public.lukas_drawing_object_sources
for each row execute function private.lukas_drawing_draft_child_insert_guard();
create trigger lukas_drawing_object_issue_links_insert_revision_guard
before insert on public.lukas_drawing_object_issue_links
for each row execute function private.lukas_drawing_draft_child_insert_guard();

create or replace function private.lukas_drawing_append_only_guard()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create trigger lukas_drawing_operations_append_only
before update or delete on public.lukas_drawing_operations
for each row execute function private.lukas_drawing_append_only_guard();
create trigger lukas_drawing_snapshots_append_only
before update or delete on public.lukas_drawing_snapshots
for each row execute function private.lukas_drawing_append_only_guard();
create trigger lukas_drawing_revision_approvals_append_only
before update or delete on public.lukas_drawing_revision_approvals
for each row execute function private.lukas_drawing_append_only_guard();

create unique index lukas_drawing_layers_one_source_idx
  on public.lukas_drawing_layers(revision_id, system_kind)
  where system_kind = 'source';
create unique index lukas_drawing_layers_one_work_idx
  on public.lukas_drawing_layers(revision_id, system_kind)
  where system_kind = 'work';

create or replace function private.lukas_drawing_point_valid(p_point jsonb)
returns boolean
language sql immutable security invoker
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_typeof(p_point) = 'object'
      and p_point ?& array['x', 'y']
      and p_point - array['x', 'y'] = '{}'::jsonb
      and pg_catalog.jsonb_typeof(p_point -> 'x') = 'number'
      and pg_catalog.jsonb_typeof(p_point -> 'y') = 'number',
    false
  )
$$;

create or replace function private.lukas_drawing_style_valid(p_style jsonb)
returns boolean
language sql immutable security invoker
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_typeof(p_style) = 'object'
      and p_style ?& array['stroke', 'strokeWidth', 'fill']
      and p_style - array['stroke', 'strokeWidth', 'fill', 'fontSize'] = '{}'::jsonb
      and pg_catalog.jsonb_typeof(p_style -> 'stroke') = 'string'
      and (p_style ->> 'stroke') ~ '^#[0-9A-Fa-f]{6}$'
      and pg_catalog.jsonb_typeof(p_style -> 'strokeWidth') = 'number'
      and (p_style ->> 'strokeWidth')::numeric > 0
      and (p_style ->> 'strokeWidth')::numeric <= 1000
      and (
        pg_catalog.jsonb_typeof(p_style -> 'fill') = 'null'
        or (pg_catalog.jsonb_typeof(p_style -> 'fill') = 'string'
          and (p_style ->> 'fill') ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$')
      )
      and (
        not (p_style ? 'fontSize')
        or (pg_catalog.jsonb_typeof(p_style -> 'fontSize') = 'number'
          and (p_style ->> 'fontSize')::numeric > 0
          and (p_style ->> 'fontSize')::numeric <= 10000)
      ),
    false
  )
$$;

create or replace function private.lukas_drawing_geometry_valid(
  p_object_type text,
  p_geometry jsonb
) returns boolean
language plpgsql immutable security invoker
set search_path = ''
as $$
declare
  v_point jsonb;
begin
  if pg_catalog.jsonb_typeof(p_geometry) <> 'object'
     or p_geometry ->> 'type' is distinct from p_object_type
     or p_geometry ?| array['attrs', 'className', 'children', 'nodeType'] then
    return false;
  end if;

  if p_object_type = 'line' then
    return coalesce(
      p_geometry ?& array['type', 'start', 'end']
        and p_geometry - array['type', 'start', 'end'] = '{}'::jsonb
        and private.lukas_drawing_point_valid(p_geometry -> 'start') is true
        and private.lukas_drawing_point_valid(p_geometry -> 'end') is true
        and p_geometry -> 'start' <> p_geometry -> 'end',
      false
    );
  elsif p_object_type = 'polyline' then
    if not (p_geometry ?& array['type', 'points', 'closed'])
       or p_geometry - array['type', 'points', 'closed'] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(p_geometry -> 'points') <> 'array'
       or pg_catalog.jsonb_array_length(p_geometry -> 'points') < 2
       or pg_catalog.jsonb_typeof(p_geometry -> 'closed') <> 'boolean' then
      return false;
    end if;
    for v_point in select value from pg_catalog.jsonb_array_elements(p_geometry -> 'points') loop
      if private.lukas_drawing_point_valid(v_point) is not true then return false; end if;
    end loop;
    return (
      select pg_catalog.count(distinct value::text) > 1
      from pg_catalog.jsonb_array_elements(p_geometry -> 'points')
    );
  elsif p_object_type = 'rectangle' then
    return coalesce(
      p_geometry ?& array['type', 'origin', 'width', 'height', 'rotation']
        and p_geometry - array['type', 'origin', 'width', 'height', 'rotation'] = '{}'::jsonb
        and private.lukas_drawing_point_valid(p_geometry -> 'origin') is true
        and pg_catalog.jsonb_typeof(p_geometry -> 'width') = 'number'
        and (p_geometry ->> 'width')::numeric > 0
        and pg_catalog.jsonb_typeof(p_geometry -> 'height') = 'number'
        and (p_geometry ->> 'height')::numeric > 0
        and pg_catalog.jsonb_typeof(p_geometry -> 'rotation') = 'number',
      false
    );
  elsif p_object_type = 'circle' then
    return coalesce(
      p_geometry ?& array['type', 'center', 'radius']
        and p_geometry - array['type', 'center', 'radius'] = '{}'::jsonb
        and private.lukas_drawing_point_valid(p_geometry -> 'center') is true
        and pg_catalog.jsonb_typeof(p_geometry -> 'radius') = 'number'
        and (p_geometry ->> 'radius')::numeric > 0,
      false
    );
  elsif p_object_type = 'text' then
    return coalesce(
      p_geometry ?& array['type', 'origin', 'width', 'text']
        and p_geometry - array['type', 'origin', 'width', 'text'] = '{}'::jsonb
        and private.lukas_drawing_point_valid(p_geometry -> 'origin') is true
        and pg_catalog.jsonb_typeof(p_geometry -> 'width') = 'number'
        and (p_geometry ->> 'width')::numeric > 0
        and pg_catalog.jsonb_typeof(p_geometry -> 'text') = 'string'
        and pg_catalog.char_length(p_geometry ->> 'text') <= 10000,
      false
    );
  elsif p_object_type = 'dimension' then
    return coalesce(
      p_geometry ?& array['type', 'start', 'end', 'offset', 'calibrationId']
        and p_geometry - array['type', 'start', 'end', 'offset', 'calibrationId'] = '{}'::jsonb
        and private.lukas_drawing_point_valid(p_geometry -> 'start') is true
        and private.lukas_drawing_point_valid(p_geometry -> 'end') is true
        and p_geometry -> 'start' <> p_geometry -> 'end'
        and pg_catalog.jsonb_typeof(p_geometry -> 'offset') = 'number'
        and (
          pg_catalog.jsonb_typeof(p_geometry -> 'calibrationId') = 'null'
          or (pg_catalog.jsonb_typeof(p_geometry -> 'calibrationId') = 'string'
            and (p_geometry ->> 'calibrationId') ~
              '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$')
        ),
      false
    );
  end if;
  return false;
end;
$$;

create or replace function private.lukas_drawing_document_guard()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if v_actor is null or new.created_by <> v_actor then
      raise exception 'Drawing document creator must be the authenticated user';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Drawing document identity is immutable';
    end if;
  end if;
  if tg_op <> 'INSERT' then
    if exists (
      select 1 from public.lukas_drawing_revisions r
      where r.document_id = old.id and r.status <> 'draft'
    ) then
      raise exception 'Drawing document with a non-draft revision is immutable';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.source_file_id is not null and not exists (
    select 1 from public.lukas_qto_files f
    where f.id = new.source_file_id
      and f.project_id = new.project_id
      and f.sha256 = new.source_sha256
      and f.kind in ('pdf', 'ifc')
      and f.immutable
  ) then
    raise exception 'Drawing source must be an immutable PDF or IFC from the project';
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger lukas_drawing_documents_guard
before insert or update or delete on public.lukas_drawing_documents
for each row execute function private.lukas_drawing_document_guard();

create or replace function private.lukas_drawing_page_source_guard()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
begin
  if new.background_source_file_id is not null and not exists (
    select 1 from public.lukas_qto_files f
    where f.id = new.background_source_file_id
      and f.project_id = new.project_id
      and f.sha256 = new.background_source_sha256
      and f.kind = 'pdf'
      and f.immutable
  ) then
    raise exception 'Drawing page background must be an immutable project PDF';
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger lukas_drawing_pages_source_guard
before insert or update on public.lukas_drawing_pages
for each row execute function private.lukas_drawing_page_source_guard();

create or replace function private.lukas_drawing_layer_guard()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'Authenticated drawing actor required'; end if;
  if tg_op = 'INSERT' then
    if new.created_by <> v_actor or new.version <> 1 then
      raise exception 'Drawing layer creator and initial version are invalid';
    end if;
  else
    if new.id is distinct from old.id
       or new.page_id is distinct from old.page_id
       or new.revision_id is distinct from old.revision_id
       or new.project_id is distinct from old.project_id
       or new.system_kind is distinct from old.system_kind
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Drawing layer identity is immutable';
    end if;
    if new.version <> old.version + 1 then
      raise exception 'Drawing layer version must increase by one';
    end if;
  end if;
  if new.system_kind = 'source' and not new.locked then
    raise exception 'Source drawing layer must remain locked';
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger lukas_drawing_layers_domain_guard
before insert or update on public.lukas_drawing_layers
for each row execute function private.lukas_drawing_layer_guard();

create or replace function private.lukas_drawing_object_guard()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'Authenticated drawing actor required'; end if;
  if private.lukas_drawing_geometry_valid(new.object_type, new.geometry) is not true
     or private.lukas_drawing_style_valid(new.style) is not true then
    raise exception 'Drawing object domain JSON is invalid';
  end if;
  if new.geometry ->> 'type' is distinct from new.object_type then
    raise exception 'Drawing geometry type must match object_type';
  end if;
  if not exists (
    select 1 from public.lukas_drawing_layers l
    where l.id = new.layer_id
      and l.page_id = new.page_id
      and l.revision_id = new.revision_id
      and l.project_id = new.project_id
      and not l.locked
  ) then
    raise exception 'Drawing object requires an unlocked layer on the same page';
  end if;
  if tg_op = 'INSERT' then
    if new.created_by <> v_actor or new.updated_by <> v_actor
       or new.version <> 1 or new.status <> 'active' then
      raise exception 'Drawing object creator or initial state is invalid';
    end if;
  else
    if new.id is distinct from old.id
       or new.lineage_id is distinct from old.lineage_id
       or new.revision_id is distinct from old.revision_id
       or new.project_id is distinct from old.project_id
       or new.object_type is distinct from old.object_type
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Drawing object identity is immutable';
    end if;
    if new.updated_by <> v_actor or new.version <> old.version + 1 then
      raise exception 'Drawing object actor or version is invalid';
    end if;
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger lukas_drawing_objects_domain_guard
before insert or update on public.lukas_drawing_objects
for each row execute function private.lukas_drawing_object_guard();

create or replace function private.lukas_drawing_object_source_guard()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.object_id is distinct from old.object_id
    or new.revision_id is distinct from old.revision_id
    or new.project_id is distinct from old.project_id
    or new.source_file_id is distinct from old.source_file_id
    or new.source_sha256 is distinct from old.source_sha256
    or new.source_kind is distinct from old.source_kind
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Drawing object source identity is immutable';
  end if;
  if not exists (
    select 1 from public.lukas_qto_files f
    where f.id = new.source_file_id
      and f.project_id = new.project_id
      and f.sha256 = new.source_sha256
      and f.immutable
      and ((new.source_kind = 'pdf_region' and f.kind = 'pdf')
        or (new.source_kind = 'ifc_element' and f.kind = 'ifc'))
  ) then
    raise exception 'Drawing object source kind does not match its immutable file';
  end if;
  return new;
end;
$$;

create trigger lukas_drawing_object_sources_domain_guard
before insert or update on public.lukas_drawing_object_sources
for each row execute function private.lukas_drawing_object_source_guard();
create trigger lukas_drawing_object_sources_revision_guard
before update or delete on public.lukas_drawing_object_sources
for each row execute function private.lukas_drawing_draft_child_guard();
create trigger lukas_drawing_object_issue_links_revision_guard
before update or delete on public.lukas_drawing_object_issue_links
for each row execute function private.lukas_drawing_draft_child_guard();

create or replace function private.lukas_drawing_revision_approval_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_role text;
begin
  if v_actor is null then raise exception 'Authenticated drawing reviewer required'; end if;
  if new.decided_by <> v_actor then
    raise exception 'Drawing decision reviewer must be the authenticated user';
  end if;
  select * into v_revision
  from public.lukas_drawing_revisions r
  where r.id = new.revision_id and r.project_id = new.project_id
  for update;
  if not found then raise exception 'Drawing revision does not exist'; end if;
  v_role := private.lukas_qto_project_role(v_revision.project_id);
  if v_role is null or v_role not in ('owner', 'staff', 'reviewer') then
    raise exception 'Project role cannot approve drawing revisions';
  end if;
  if v_revision.created_by = v_actor then
    raise exception 'Reviewer cannot approve their own drawing revision';
  end if;
  if v_revision.status <> 'review_requested'
     or v_revision.version <> new.subject_version then
    raise exception 'Drawing revision version is not awaiting review';
  end if;
  if not exists (
    select 1 from public.lukas_drawing_snapshots s
    where s.revision_id = new.revision_id
      and s.project_id = new.project_id
      and s.revision_version = new.subject_version
      and s.sha256 = new.snapshot_sha256
  ) then
    raise exception 'Drawing decision snapshot SHA does not match';
  end if;
  new.created_at := pg_catalog.now();
  return new;
end;
$$;

create trigger lukas_drawing_revision_approvals_validate
before insert on public.lukas_drawing_revision_approvals
for each row execute function private.lukas_drawing_revision_approval_guard();

create or replace function private.lukas_drawing_apply_revision_approval()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or new.decided_by <> v_actor then
    raise exception 'Drawing decision reviewer must be the authenticated user';
  end if;
  if new.decision = 'approved' then
    update public.lukas_drawing_revisions
    set status = 'approved', approved_at = pg_catalog.now(), updated_at = pg_catalog.now()
    where id = new.revision_id
      and project_id = new.project_id
      and status = 'review_requested'
      and version = new.subject_version;
  else
    update public.lukas_drawing_revisions
    set status = 'draft', version = version + 1,
        review_requested_at = null, approved_at = null, updated_at = pg_catalog.now()
    where id = new.revision_id
      and project_id = new.project_id
      and status = 'review_requested'
      and version = new.subject_version;
  end if;
  if not found then raise exception 'Drawing revision decision lost its subject version'; end if;
  return new;
end;
$$;

create trigger lukas_drawing_revision_approvals_apply
after insert on public.lukas_drawing_revision_approvals
for each row execute function private.lukas_drawing_apply_revision_approval();

create or replace function private.lukas_drawing_workspace_capability(p_project_id uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then null
    else case private.lukas_qto_project_role(p_project_id)
      when 'owner' then 'admin'
      when 'staff' then 'admin'
      when 'estimator' then 'editor'
      when 'reviewer' then 'reviewer'
      when 'site' then 'commenter'
      when 'procurement' then 'commenter'
      when 'viewer' then 'viewer'
    end
  end
$$;

create or replace function private.lukas_drawing_create_document(
  p_project_id uuid,
  p_source_file_id uuid,
  p_title text,
  p_blank boolean
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_file public.lukas_qto_files%rowtype;
  v_document_id uuid;
  v_revision_id uuid;
  v_page_id uuid;
  v_source_layer_id uuid;
  v_work_layer_id uuid;
  v_capability text;
begin
  if v_actor is null then raise exception 'Authenticated drawing actor required'; end if;
  v_capability := private.lukas_drawing_workspace_capability(p_project_id);
  if v_capability is null or v_capability not in ('admin', 'editor') then
    raise exception 'Drawing workspace editor capability required';
  end if;
  if p_title is null or pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 1 and 240 then
    raise exception 'Drawing document title is required';
  end if;
  if p_blank is null then raise exception 'Drawing blank-page choice is required'; end if;

  if p_source_file_id is not null then
    select * into v_file
    from public.lukas_qto_files f
    where f.id = p_source_file_id and f.project_id = p_project_id
    for key share;
    if not found or v_file.kind not in ('pdf', 'ifc') or not v_file.immutable then
      raise exception 'Drawing source must be an immutable project PDF or IFC';
    end if;
  elsif not p_blank then
    raise exception 'A non-blank drawing requires a PDF or IFC source';
  end if;

  insert into public.lukas_drawing_documents(
    project_id, source_file_id, source_sha256, title, created_by
  ) values (
    p_project_id, p_source_file_id, v_file.sha256,
    pg_catalog.btrim(p_title), v_actor
  ) returning id into v_document_id;

  insert into public.lukas_drawing_revisions(
    document_id, project_id, sequence, status, version, created_by
  ) values (v_document_id, p_project_id, 1, 'draft', 1, v_actor)
  returning id into v_revision_id;

  insert into public.lukas_drawing_pages(
    revision_id, project_id, name, page_number,
    background_source_file_id, background_source_sha256, background_pdf_page
  ) values (
    v_revision_id, p_project_id, '1', 1,
    case when not p_blank and v_file.kind = 'pdf' then v_file.id end,
    case when not p_blank and v_file.kind = 'pdf' then v_file.sha256 end,
    case when not p_blank and v_file.kind = 'pdf' then 1 end
  ) returning id into v_page_id;

  insert into public.lukas_drawing_layers(
    page_id, revision_id, project_id, name, sort_order,
    visible, locked, system_kind, version, created_by
  ) values (
    v_page_id, v_revision_id, p_project_id, '원본', 0,
    true, true, 'source', 1, v_actor
  ) returning id into v_source_layer_id;

  insert into public.lukas_drawing_layers(
    page_id, revision_id, project_id, name, sort_order,
    visible, locked, system_kind, version, created_by
  ) values (
    v_page_id, v_revision_id, p_project_id, '작업', 1,
    true, false, 'work', 1, v_actor
  ) returning id into v_work_layer_id;

  return pg_catalog.jsonb_build_object(
    'documentId', v_document_id,
    'revisionId', v_revision_id,
    'pageId', v_page_id,
    'sourceLayerId', v_source_layer_id,
    'workLayerId', v_work_layer_id
  );
end;
$$;

create or replace function private.lukas_drawing_operation_payload_valid(p_payload jsonb)
returns boolean
language plpgsql immutable security invoker
set search_path = ''
as $$
declare
  v_type text;
  v_item jsonb;
  v_patch jsonb;
begin
  if pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or not (p_payload ? 'type')
     or pg_catalog.jsonb_typeof(p_payload -> 'type') <> 'string' then
    return false;
  end if;
  v_type := p_payload ->> 'type';

  if v_type = 'add_objects' then
    if not (p_payload ?& array['type', 'objects'])
       or p_payload - array['type', 'objects'] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(p_payload -> 'objects') <> 'array'
       or pg_catalog.jsonb_array_length(p_payload -> 'objects') = 0 then
      return false;
    end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_payload -> 'objects') loop
      if pg_catalog.jsonb_typeof(v_item) <> 'object'
         or not (v_item ?& array['id', 'layerId', 'geometry', 'style', 'version'])
         or v_item - array['id', 'layerId', 'geometry', 'style', 'version'] <> '{}'::jsonb
         or pg_catalog.jsonb_typeof(v_item -> 'id') <> 'string'
         or (v_item ->> 'id') !~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
         or pg_catalog.jsonb_typeof(v_item -> 'layerId') <> 'string'
         or (v_item ->> 'layerId') !~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
         or private.lukas_drawing_geometry_valid(
           v_item -> 'geometry' ->> 'type', v_item -> 'geometry'
         ) is not true
         or private.lukas_drawing_style_valid(v_item -> 'style') is not true
         or pg_catalog.jsonb_typeof(v_item -> 'version') <> 'number'
         or (v_item ->> 'version')::numeric <= 0
         or (v_item ->> 'version')::numeric <>
           pg_catalog.trunc((v_item ->> 'version')::numeric) then
        return false;
      end if;
    end loop;
    if exists (
      select 1 from pg_catalog.jsonb_array_elements(p_payload -> 'objects') item
      group by item ->> 'id' having pg_catalog.count(*) > 1
    ) then return false; end if;
    return true;

  elsif v_type = 'update_objects' then
    if not (p_payload ?& array['type', 'updates'])
       or p_payload - array['type', 'updates'] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(p_payload -> 'updates') <> 'array'
       or pg_catalog.jsonb_array_length(p_payload -> 'updates') = 0 then
      return false;
    end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_payload -> 'updates') loop
      v_patch := v_item -> 'patch';
      if pg_catalog.jsonb_typeof(v_item) <> 'object'
         or not (v_item ?& array['objectId', 'patch'])
         or v_item - array['objectId', 'patch'] <> '{}'::jsonb
         or pg_catalog.jsonb_typeof(v_item -> 'objectId') <> 'string'
         or (v_item ->> 'objectId') !~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
         or pg_catalog.jsonb_typeof(v_patch) <> 'object'
         or v_patch = '{}'::jsonb
         or v_patch - array['layerId', 'geometry', 'style'] <> '{}'::jsonb
         or (v_patch ? 'layerId' and (
           pg_catalog.jsonb_typeof(v_patch -> 'layerId') <> 'string'
           or (v_patch ->> 'layerId') !~
             '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
         ))
         or (v_patch ? 'geometry' and private.lukas_drawing_geometry_valid(
           v_patch -> 'geometry' ->> 'type', v_patch -> 'geometry'
         ) is not true)
         or (v_patch ? 'style'
           and private.lukas_drawing_style_valid(v_patch -> 'style') is not true) then
        return false;
      end if;
    end loop;
    if exists (
      select 1 from pg_catalog.jsonb_array_elements(p_payload -> 'updates') item
      group by item ->> 'objectId' having pg_catalog.count(*) > 1
    ) then return false; end if;
    return true;

  elsif v_type = 'delete_objects' then
    if not (p_payload ?& array['type', 'objectIds'])
       or p_payload - array['type', 'objectIds'] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(p_payload -> 'objectIds') <> 'array'
       or pg_catalog.jsonb_array_length(p_payload -> 'objectIds') = 0
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(p_payload -> 'objectIds') item
         where pg_catalog.jsonb_typeof(item) <> 'string'
           or item #>> '{}' !~
             '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       )
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements_text(p_payload -> 'objectIds') object_id
         group by object_id having pg_catalog.count(*) > 1
       ) then
      return false;
    end if;
    return true;

  elsif v_type = 'add_layer' then
    v_item := p_payload -> 'layer';
    return coalesce(
      p_payload ?& array['type', 'layer']
        and p_payload - array['type', 'layer'] = '{}'::jsonb
        and pg_catalog.jsonb_typeof(v_item) = 'object'
        and v_item ?& array['id', 'name', 'visible', 'locked', 'version']
        and v_item - array['id', 'name', 'visible', 'locked', 'version'] = '{}'::jsonb
        and pg_catalog.jsonb_typeof(v_item -> 'id') = 'string'
        and (v_item ->> 'id') ~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        and pg_catalog.jsonb_typeof(v_item -> 'name') = 'string'
        and pg_catalog.char_length(pg_catalog.btrim(v_item ->> 'name')) between 1 and 255
        and pg_catalog.jsonb_typeof(v_item -> 'visible') = 'boolean'
        and pg_catalog.jsonb_typeof(v_item -> 'locked') = 'boolean'
        and pg_catalog.jsonb_typeof(v_item -> 'version') = 'number'
        and (v_item ->> 'version')::numeric = 1,
      false
    );

  elsif v_type = 'update_layer' then
    v_patch := p_payload -> 'patch';
    return coalesce(
      p_payload ?& array['type', 'layerId', 'patch']
        and p_payload - array['type', 'layerId', 'patch'] = '{}'::jsonb
        and pg_catalog.jsonb_typeof(p_payload -> 'layerId') = 'string'
        and (p_payload ->> 'layerId') ~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        and pg_catalog.jsonb_typeof(v_patch) = 'object'
        and v_patch <> '{}'::jsonb
        and v_patch - array['name', 'visible', 'locked'] = '{}'::jsonb
        and (not (v_patch ? 'name') or (
          pg_catalog.jsonb_typeof(v_patch -> 'name') = 'string'
          and pg_catalog.char_length(pg_catalog.btrim(v_patch ->> 'name')) between 1 and 255
        ))
        and (not (v_patch ? 'visible')
          or pg_catalog.jsonb_typeof(v_patch -> 'visible') = 'boolean')
        and (not (v_patch ? 'locked')
          or pg_catalog.jsonb_typeof(v_patch -> 'locked') = 'boolean'),
      false
    );
  end if;
  return false;
end;
$$;

create or replace function private.lukas_drawing_operation_inverse_valid(
  p_operation_type text,
  p_forward jsonb,
  p_inverse jsonb
) returns boolean
language plpgsql immutable security invoker
set search_path = ''
as $$
begin
  if p_operation_type = 'add_layer' then
    return p_inverse = '{}'::jsonb;
  end if;
  if private.lukas_drawing_operation_payload_valid(p_inverse) is not true then
    return false;
  end if;
  if p_operation_type = 'add_objects' then
    return p_inverse ->> 'type' = 'delete_objects' and (
      select pg_catalog.jsonb_agg(id order by id)
      from (
        select item ->> 'id' id
        from pg_catalog.jsonb_array_elements(p_forward -> 'objects') item
      ) ids
    ) = (
      select pg_catalog.jsonb_agg(id order by id)
      from pg_catalog.jsonb_array_elements_text(p_inverse -> 'objectIds') id
    );
  elsif p_operation_type = 'update_objects' then
    return p_inverse ->> 'type' = 'update_objects' and (
      select pg_catalog.jsonb_agg(id order by id)
      from (
        select item ->> 'objectId' id
        from pg_catalog.jsonb_array_elements(p_forward -> 'updates') item
      ) ids
    ) = (
      select pg_catalog.jsonb_agg(id order by id)
      from (
        select item ->> 'objectId' id
        from pg_catalog.jsonb_array_elements(p_inverse -> 'updates') item
      ) ids
    );
  elsif p_operation_type = 'delete_objects' then
    return p_inverse ->> 'type' = 'add_objects' and (
      select pg_catalog.jsonb_agg(id order by id)
      from pg_catalog.jsonb_array_elements_text(p_forward -> 'objectIds') id
    ) = (
      select pg_catalog.jsonb_agg(id order by id)
      from (
        select item ->> 'id' id
        from pg_catalog.jsonb_array_elements(p_inverse -> 'objects') item
      ) ids
    );
  elsif p_operation_type = 'update_layer' then
    return p_inverse ->> 'type' = 'update_layer'
      and p_inverse ->> 'layerId' = p_forward ->> 'layerId';
  end if;
  return false;
end;
$$;

create or replace function private.lukas_drawing_apply_operation(
  p_revision_id uuid,
  p_client_operation_id uuid,
  p_operation_type text,
  p_base_versions jsonb,
  p_forward jsonb,
  p_inverse jsonb
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_existing public.lukas_drawing_operations%rowtype;
  v_object public.lukas_drawing_objects%rowtype;
  v_layer public.lukas_drawing_layers%rowtype;
  v_new_layer public.lukas_drawing_layers%rowtype;
  v_item jsonb;
  v_inverse_item jsonb;
  v_patch jsonb;
  v_object_id uuid;
  v_layer_id uuid;
  v_page_id uuid;
  v_operation_id uuid;
  v_sequence bigint;
  v_result_versions jsonb := '{}'::jsonb;
  v_count integer;
  v_restore_count integer := 0;
  v_capability text;
begin
  if v_actor is null then raise exception 'Authenticated drawing actor required'; end if;
  if p_client_operation_id is null then raise exception 'Client operation ID is required'; end if;
  if p_operation_type not in (
    'add_objects', 'update_objects', 'delete_objects', 'add_layer', 'update_layer'
  ) then raise exception 'Unsupported drawing operation type'; end if;
  if pg_catalog.jsonb_typeof(p_base_versions) <> 'object'
     or p_forward ->> 'type' is distinct from p_operation_type
     or private.lukas_drawing_operation_payload_valid(p_forward) is not true then
    raise exception 'Drawing operation domain JSON is invalid';
  end if;
  if private.lukas_drawing_operation_inverse_valid(
       p_operation_type, p_forward, p_inverse
     ) is not true then
    raise exception 'Drawing operation inverse payload is invalid';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_each(p_base_versions) b
    where pg_catalog.jsonb_typeof(b.value) <> 'number'
      or (b.value #>> '{}')::numeric <= 0
      or (b.value #>> '{}')::numeric <> pg_catalog.trunc((b.value #>> '{}')::numeric)
  ) then raise exception 'Drawing base versions must be positive integers'; end if;

  select * into v_revision
  from public.lukas_drawing_revisions r
  where r.id = p_revision_id
  for update;
  if not found then raise exception 'Drawing revision does not exist'; end if;
  v_capability := private.lukas_drawing_workspace_capability(v_revision.project_id);
  if v_capability is null or v_capability not in ('admin', 'editor') then
    raise exception 'Drawing workspace editor capability required';
  end if;

  select * into v_existing
  from public.lukas_drawing_operations o
  where o.revision_id = p_revision_id
    and o.client_operation_id = p_client_operation_id;
  if found then
    return pg_catalog.jsonb_build_object(
      'operationId', v_existing.id,
      'sequence', v_existing.sequence,
      'resultVersions', v_existing.result_versions
    );
  end if;
  if v_revision.status <> 'draft' then
    raise exception 'Drawing operation requires a draft revision';
  end if;

  if p_operation_type = 'add_objects' then
    if p_forward - array['type', 'objects'] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(p_forward -> 'objects') <> 'array'
       or pg_catalog.jsonb_array_length(p_forward -> 'objects') = 0 then
      raise exception 'Invalid add_objects payload';
    end if;
    if exists (
      select 1 from pg_catalog.jsonb_array_elements(p_forward -> 'objects') item
      group by item ->> 'id' having pg_catalog.count(*) > 1
    ) then raise exception 'Drawing operation contains duplicate object IDs'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_forward -> 'objects') loop
      if v_item - array['id', 'layerId', 'geometry', 'style', 'version'] <> '{}'::jsonb
         or pg_catalog.jsonb_typeof(v_item -> 'geometry') <> 'object'
         or pg_catalog.jsonb_typeof(v_item -> 'style') <> 'object'
         or pg_catalog.jsonb_typeof(v_item -> 'version') <> 'number' then
        raise exception 'Invalid drawing object payload';
      end if;
      v_object_id := (v_item ->> 'id')::uuid;
      v_layer_id := (v_item ->> 'layerId')::uuid;
      select * into v_layer from public.lukas_drawing_layers l
      where l.id = v_layer_id and l.revision_id = p_revision_id
        and l.project_id = v_revision.project_id for update;
      if not found or v_layer.locked then raise exception 'Drawing layer is locked or missing'; end if;
      if private.lukas_drawing_geometry_valid(
          v_item -> 'geometry' ->> 'type', v_item -> 'geometry'
        ) is not true or private.lukas_drawing_style_valid(v_item -> 'style') is not true then
        raise exception 'Drawing object domain JSON is invalid';
      end if;
      select * into v_object from public.lukas_drawing_objects o
      where o.id = v_object_id for update;
      if found then
        if v_object.revision_id <> p_revision_id
           or v_object.project_id <> v_revision.project_id
           or v_object.status <> 'deleted' then
          raise exception 'Drawing object already exists';
        end if;
        if p_base_versions -> v_object_id::text is null
           or (p_base_versions ->> v_object_id::text)::bigint <> v_object.version
           or (v_item ->> 'version')::bigint <> v_object.version + 1 then
          raise exception 'Drawing object restore version conflict';
        end if;
        update public.lukas_drawing_objects
        set page_id = v_layer.page_id, layer_id = v_layer.id,
            geometry = v_item -> 'geometry', style = v_item -> 'style',
            status = 'active', version = (v_item ->> 'version')::bigint,
            updated_by = v_actor
        where id = v_object_id;
        v_restore_count := v_restore_count + 1;
        v_result_versions := v_result_versions ||
          pg_catalog.jsonb_build_object(
            v_object_id::text, (v_item ->> 'version')::bigint
          );
      else
        if p_base_versions ? v_object_id::text
           or (v_item ->> 'version')::numeric <> 1 then
          raise exception 'Invalid new drawing object version';
        end if;
        insert into public.lukas_drawing_objects(
          id, lineage_id, page_id, layer_id, revision_id, project_id,
          object_type, geometry, style, status, version, created_by, updated_by
        ) values (
          v_object_id, v_object_id, v_layer.page_id, v_layer.id,
          p_revision_id, v_revision.project_id,
          v_item -> 'geometry' ->> 'type', v_item -> 'geometry', v_item -> 'style',
          'active', 1, v_actor, v_actor
        );
        v_result_versions := v_result_versions ||
          pg_catalog.jsonb_build_object(v_object_id::text, 1);
      end if;
    end loop;
    if (select pg_catalog.count(*) from pg_catalog.jsonb_each(p_base_versions))
         <> v_restore_count then
      raise exception 'Drawing restore base versions are incomplete';
    end if;

  elsif p_operation_type = 'update_objects' then
    if p_forward - array['type', 'updates'] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(p_forward -> 'updates') <> 'array'
       or pg_catalog.jsonb_array_length(p_forward -> 'updates') = 0 then
      raise exception 'Invalid update_objects payload';
    end if;
    select pg_catalog.count(*) into v_count
    from pg_catalog.jsonb_array_elements(p_forward -> 'updates');
    if v_count <> (select pg_catalog.count(*) from pg_catalog.jsonb_each(p_base_versions))
       or exists (
         select 1 from pg_catalog.jsonb_array_elements(p_forward -> 'updates') item
         group by item ->> 'objectId' having pg_catalog.count(*) > 1
       ) then raise exception 'Drawing update target versions are incomplete'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_forward -> 'updates') loop
      if v_item - array['objectId', 'patch'] <> '{}'::jsonb
         or pg_catalog.jsonb_typeof(v_item -> 'patch') <> 'object'
         or v_item -> 'patch' = '{}'::jsonb
         or (v_item -> 'patch') - array['layerId', 'geometry', 'style'] <> '{}'::jsonb then
        raise exception 'Invalid drawing object update payload';
      end if;
      v_object_id := (v_item ->> 'objectId')::uuid;
      v_patch := v_item -> 'patch';
      select * into v_object from public.lukas_drawing_objects o
      where o.id = v_object_id and o.revision_id = p_revision_id
        and o.project_id = v_revision.project_id and o.status = 'active' for update;
      if not found or p_base_versions -> v_object_id::text is null
         or (p_base_versions ->> v_object_id::text)::bigint <> v_object.version then
        raise exception 'Drawing object version conflict';
      end if;
      select * into v_layer from public.lukas_drawing_layers l
      where l.id = v_object.layer_id and l.revision_id = p_revision_id for update;
      if v_layer.locked then raise exception 'Drawing layer is locked'; end if;
      if v_patch ? 'layerId' then
        select * into v_new_layer from public.lukas_drawing_layers l
        where l.id = (v_patch ->> 'layerId')::uuid
          and l.revision_id = p_revision_id
          and l.project_id = v_revision.project_id
          and l.page_id = v_object.page_id for update;
        if not found or v_new_layer.locked then raise exception 'Target drawing layer is locked or missing'; end if;
      end if;
      if v_patch ? 'geometry'
         and private.lukas_drawing_geometry_valid(
           v_object.object_type, v_patch -> 'geometry'
         ) is not true then
        raise exception 'Drawing object geometry is invalid';
      end if;
      if v_patch ? 'style'
         and private.lukas_drawing_style_valid(v_patch -> 'style') is not true then
        raise exception 'Drawing object style is invalid';
      end if;
      update public.lukas_drawing_objects
      set layer_id = case when v_patch ? 'layerId' then (v_patch ->> 'layerId')::uuid else layer_id end,
          geometry = case when v_patch ? 'geometry' then v_patch -> 'geometry' else geometry end,
          style = case when v_patch ? 'style' then v_patch -> 'style' else style end,
          version = version + 1, updated_by = v_actor
      where id = v_object_id;
      v_result_versions := v_result_versions ||
        pg_catalog.jsonb_build_object(v_object_id::text, v_object.version + 1);
    end loop;

  elsif p_operation_type = 'delete_objects' then
    if p_forward - array['type', 'objectIds'] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(p_forward -> 'objectIds') <> 'array'
       or pg_catalog.jsonb_array_length(p_forward -> 'objectIds') = 0 then
      raise exception 'Invalid delete_objects payload';
    end if;
    select pg_catalog.count(*) into v_count
    from pg_catalog.jsonb_array_elements(p_forward -> 'objectIds');
    if v_count <> (select pg_catalog.count(*) from pg_catalog.jsonb_each(p_base_versions))
       or exists (
         select 1 from pg_catalog.jsonb_array_elements_text(p_forward -> 'objectIds') object_id
         group by object_id having pg_catalog.count(*) > 1
       ) then raise exception 'Drawing delete target versions are incomplete'; end if;
    for v_object_id in
      select value::uuid from pg_catalog.jsonb_array_elements_text(p_forward -> 'objectIds')
    loop
      select * into v_object from public.lukas_drawing_objects o
      where o.id = v_object_id and o.revision_id = p_revision_id
        and o.project_id = v_revision.project_id and o.status = 'active' for update;
      if not found or p_base_versions -> v_object_id::text is null
         or (p_base_versions ->> v_object_id::text)::bigint <> v_object.version then
        raise exception 'Drawing object version conflict';
      end if;
      select item into v_inverse_item
      from pg_catalog.jsonb_array_elements(p_inverse -> 'objects') item
      where item ->> 'id' = v_object_id::text;
      if v_inverse_item is distinct from pg_catalog.jsonb_build_object(
        'id', v_object.id,
        'layerId', v_object.layer_id,
        'geometry', v_object.geometry,
        'style', v_object.style,
        'version', v_object.version + 2
      ) then
        raise exception 'Drawing delete inverse is not replayable';
      end if;
      select * into v_layer from public.lukas_drawing_layers l
      where l.id = v_object.layer_id and l.revision_id = p_revision_id for update;
      if v_layer.locked then raise exception 'Drawing layer is locked'; end if;
      update public.lukas_drawing_objects
      set status = 'deleted', version = version + 1, updated_by = v_actor
      where id = v_object_id;
      v_result_versions := v_result_versions ||
        pg_catalog.jsonb_build_object(v_object_id::text, null);
    end loop;

  elsif p_operation_type = 'add_layer' then
    if p_forward - array['type', 'layer'] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(p_forward -> 'layer') <> 'object' then
      raise exception 'Invalid add_layer payload';
    end if;
    v_item := p_forward -> 'layer';
    if v_item - array['id', 'name', 'visible', 'locked', 'version'] <> '{}'::jsonb
       or pg_catalog.char_length(pg_catalog.btrim(v_item ->> 'name')) not between 1 and 255
       or pg_catalog.jsonb_typeof(v_item -> 'visible') <> 'boolean'
       or pg_catalog.jsonb_typeof(v_item -> 'locked') <> 'boolean'
       or pg_catalog.jsonb_typeof(v_item -> 'version') <> 'number'
       or (v_item ->> 'version')::bigint <> 1 then
      raise exception 'Invalid drawing layer payload';
    end if;
    v_layer_id := (v_item ->> 'id')::uuid;
    if p_base_versions <> '{}'::jsonb
       and not (pg_catalog.jsonb_object_length(p_base_versions) = 1
         and (p_base_versions ->> v_layer_id::text)::bigint = 1) then
      raise exception 'Invalid add_layer base version';
    end if;
    select p.id into v_page_id from public.lukas_drawing_pages p
    where p.revision_id = p_revision_id and p.project_id = v_revision.project_id
    order by p.page_number, p.id limit 1;
    if v_page_id is null then raise exception 'Drawing revision has no page'; end if;
    insert into public.lukas_drawing_layers(
      id, page_id, revision_id, project_id, name, sort_order,
      visible, locked, system_kind, version, created_by
    ) values (
      v_layer_id, v_page_id, p_revision_id, v_revision.project_id,
      pg_catalog.btrim(v_item ->> 'name'),
      (select coalesce(pg_catalog.max(l.sort_order), 0) + 1
       from public.lukas_drawing_layers l where l.page_id = v_page_id),
      (v_item ->> 'visible')::boolean, (v_item ->> 'locked')::boolean,
      'custom', 1, v_actor
    );
    v_result_versions := v_result_versions ||
      pg_catalog.jsonb_build_object(v_layer_id::text, 1);

  elsif p_operation_type = 'update_layer' then
    if p_forward - array['type', 'layerId', 'patch'] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(p_forward -> 'patch') <> 'object'
       or p_forward -> 'patch' = '{}'::jsonb
       or (p_forward -> 'patch') - array['name', 'visible', 'locked'] <> '{}'::jsonb then
      raise exception 'Invalid update_layer payload';
    end if;
    v_layer_id := (p_forward ->> 'layerId')::uuid;
    v_patch := p_forward -> 'patch';
    if pg_catalog.jsonb_object_length(p_base_versions) <> 1 then
      raise exception 'Drawing layer base version is required';
    end if;
    select * into v_layer from public.lukas_drawing_layers l
    where l.id = v_layer_id and l.revision_id = p_revision_id
      and l.project_id = v_revision.project_id for update;
    if not found or p_base_versions -> v_layer_id::text is null
       or (p_base_versions ->> v_layer_id::text)::bigint <> v_layer.version then
      raise exception 'Drawing layer version conflict';
    end if;
    if v_layer.system_kind = 'source' then raise exception 'Source drawing layer is immutable'; end if;
    if v_patch ? 'name'
       and pg_catalog.char_length(pg_catalog.btrim(v_patch ->> 'name')) not between 1 and 255 then
      raise exception 'Drawing layer name is invalid';
    end if;
    if v_patch ? 'visible' and pg_catalog.jsonb_typeof(v_patch -> 'visible') <> 'boolean' then
      raise exception 'Drawing layer visibility is invalid';
    end if;
    if v_patch ? 'locked' and pg_catalog.jsonb_typeof(v_patch -> 'locked') <> 'boolean' then
      raise exception 'Drawing layer lock state is invalid';
    end if;
    update public.lukas_drawing_layers
    set name = case when v_patch ? 'name' then pg_catalog.btrim(v_patch ->> 'name') else name end,
        visible = case when v_patch ? 'visible' then (v_patch ->> 'visible')::boolean else visible end,
        locked = case when v_patch ? 'locked' then (v_patch ->> 'locked')::boolean else locked end,
        version = version + 1
    where id = v_layer_id;
    v_result_versions := v_result_versions ||
      pg_catalog.jsonb_build_object(v_layer_id::text, v_layer.version + 1);
  end if;

  select coalesce(pg_catalog.max(o.sequence), 0) + 1 into v_sequence
  from public.lukas_drawing_operations o where o.revision_id = p_revision_id;
  insert into public.lukas_drawing_operations(
    revision_id, project_id, sequence, client_operation_id, operation_type,
    base_versions, forward, inverse, result_versions, actor_id
  ) values (
    p_revision_id, v_revision.project_id, v_sequence, p_client_operation_id,
    p_operation_type, p_base_versions, p_forward, p_inverse, v_result_versions, v_actor
  ) returning id into v_operation_id;
  return pg_catalog.jsonb_build_object(
    'operationId', v_operation_id,
    'sequence', v_sequence,
    'resultVersions', v_result_versions
  );
end;
$$;

create or replace function private.lukas_drawing_request_review(p_revision_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_snapshot jsonb;
  v_sha256 text;
  v_operation_sequence bigint;
  v_snapshot_id uuid;
  v_capability text;
begin
  if v_actor is null then raise exception 'Authenticated drawing actor required'; end if;
  select * into v_revision from public.lukas_drawing_revisions r
  where r.id = p_revision_id for update;
  if not found then raise exception 'Drawing revision does not exist'; end if;
  v_capability := private.lukas_drawing_workspace_capability(v_revision.project_id);
  if v_capability is null or v_capability not in ('admin', 'editor') then
    raise exception 'Drawing workspace editor capability required';
  end if;
  if v_revision.status <> 'draft' then raise exception 'Only a draft drawing revision can request review'; end if;

  select coalesce(pg_catalog.max(o.sequence), 0)
  into v_operation_sequence
  from public.lukas_drawing_operations o where o.revision_id = p_revision_id;

  v_snapshot := pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'revision', pg_catalog.jsonb_build_object(
      'id', v_revision.id,
      'documentId', v_revision.document_id,
      'projectId', v_revision.project_id,
      'sequence', v_revision.sequence,
      'version', v_revision.version
    ),
    'pages', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', p.id, 'name', p.name, 'pageNumber', p.page_number,
        'widthMm', p.width_mm, 'heightMm', p.height_mm,
        'backgroundSourceFileId', p.background_source_file_id,
        'backgroundSourceSha256', p.background_source_sha256,
        'backgroundPdfPage', p.background_pdf_page,
        'calibration', p.calibration
      ) order by p.id)
      from public.lukas_drawing_pages p where p.revision_id = p_revision_id
    ), '[]'::jsonb),
    'layers', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', l.id, 'pageId', l.page_id, 'name', l.name,
        'sortOrder', l.sort_order, 'visible', l.visible,
        'locked', l.locked, 'systemKind', l.system_kind, 'version', l.version
      ) order by l.id)
      from public.lukas_drawing_layers l where l.revision_id = p_revision_id
    ), '[]'::jsonb),
    'objects', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', o.id, 'lineageId', o.lineage_id, 'pageId', o.page_id,
        'layerId', o.layer_id, 'type', o.object_type,
        'geometry', o.geometry, 'style', o.style, 'version', o.version,
        'sources', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', s.id, 'sourceFileId', s.source_file_id,
            'sourceSha256', s.source_sha256, 'sourceKind', s.source_kind,
            'pdfPageNumber', s.pdf_page_number, 'x', s.x, 'y', s.y,
            'width', s.width, 'height', s.height, 'elementId', s.element_id,
            'ifcGlobalId', s.ifc_global_id, 'camera', s.camera_json
          ) order by s.id)
          from public.lukas_drawing_object_sources s where s.object_id = o.id
        ), '[]'::jsonb),
        'issueIds', coalesce((
          select pg_catalog.jsonb_agg(link.issue_id order by link.issue_id)
          from public.lukas_drawing_object_issue_links link where link.object_id = o.id
        ), '[]'::jsonb)
      ) order by o.id)
      from public.lukas_drawing_objects o
      where o.revision_id = p_revision_id and o.status = 'active'
    ), '[]'::jsonb),
    'operationSequence', v_operation_sequence
  );
  v_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );
  insert into public.lukas_drawing_snapshots(
    revision_id, project_id, revision_version, operation_sequence,
    canonical_json, sha256, created_by
  ) values (
    p_revision_id, v_revision.project_id, v_revision.version,
    v_operation_sequence, v_snapshot, v_sha256, v_actor
  ) returning id into v_snapshot_id;
  update public.lukas_drawing_revisions
  set status = 'review_requested', review_requested_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where id = p_revision_id;
  return pg_catalog.jsonb_build_object(
    'snapshotId', v_snapshot_id,
    'subjectVersion', v_revision.version,
    'snapshotSha256', v_sha256,
    'operationSequence', v_operation_sequence
  );
end;
$$;

create or replace function private.lukas_drawing_record_revision_decision(
  p_revision_id uuid,
  p_subject_version bigint,
  p_snapshot_sha256 text,
  p_decision text,
  p_note text
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_role text;
  v_approval_id uuid;
  v_status text;
  v_version bigint;
begin
  if v_actor is null then raise exception 'Authenticated drawing reviewer required'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'Invalid drawing decision'; end if;
  if p_note is null or pg_catalog.char_length(p_note) > 5000 then raise exception 'Drawing decision note is invalid'; end if;
  select * into v_revision from public.lukas_drawing_revisions r
  where r.id = p_revision_id for update;
  if not found then raise exception 'Drawing revision does not exist'; end if;
  v_role := private.lukas_qto_project_role(v_revision.project_id);
  if v_role is null or v_role not in ('owner', 'staff', 'reviewer') then
    raise exception 'Project role cannot approve drawing revisions';
  end if;
  if v_revision.created_by = v_actor then
    raise exception 'Reviewer cannot approve their own drawing revision';
  end if;
  if v_revision.status <> 'review_requested'
     or v_revision.version <> p_subject_version then
    raise exception 'Drawing revision subject version changed';
  end if;
  if not exists (
    select 1 from public.lukas_drawing_snapshots s
    where s.revision_id = p_revision_id
      and s.project_id = v_revision.project_id
      and s.revision_version = p_subject_version
      and s.sha256 = p_snapshot_sha256
  ) then raise exception 'Drawing decision snapshot SHA does not match'; end if;
  insert into public.lukas_drawing_revision_approvals(
    revision_id, project_id, subject_version, snapshot_sha256,
    decision, note, decided_by
  ) values (
    p_revision_id, v_revision.project_id, p_subject_version,
    p_snapshot_sha256, p_decision, p_note, v_actor
  ) returning id into v_approval_id;
  select r.status, r.version into v_status, v_version
  from public.lukas_drawing_revisions r where r.id = p_revision_id;
  return pg_catalog.jsonb_build_object(
    'approvalId', v_approval_id, 'status', v_status, 'version', v_version
  );
end;
$$;

create or replace function public.lukas_drawing_create_document(
  p_project_id uuid, p_source_file_id uuid, p_title text, p_blank boolean
) returns jsonb
language sql security invoker
set search_path = ''
as $$
  select private.lukas_drawing_create_document(
    p_project_id, p_source_file_id, p_title, p_blank
  )
$$;

create or replace function public.lukas_drawing_apply_operation(
  p_revision_id uuid, p_client_operation_id uuid, p_operation_type text,
  p_base_versions jsonb, p_forward jsonb, p_inverse jsonb
) returns jsonb
language sql security invoker
set search_path = ''
as $$
  select private.lukas_drawing_apply_operation(
    p_revision_id, p_client_operation_id, p_operation_type,
    p_base_versions, p_forward, p_inverse
  )
$$;

create or replace function public.lukas_drawing_request_review(p_revision_id uuid)
returns jsonb
language sql security invoker
set search_path = ''
as $$ select private.lukas_drawing_request_review(p_revision_id) $$;

create or replace function public.lukas_drawing_record_revision_decision(
  p_revision_id uuid, p_subject_version bigint, p_snapshot_sha256 text,
  p_decision text, p_note text
) returns jsonb
language sql security invoker
set search_path = ''
as $$
  select private.lukas_drawing_record_revision_decision(
    p_revision_id, p_subject_version, p_snapshot_sha256, p_decision, p_note
  )
$$;

alter table public.lukas_drawing_documents enable row level security;
alter table public.lukas_drawing_revisions enable row level security;
alter table public.lukas_drawing_pages enable row level security;
alter table public.lukas_drawing_layers enable row level security;
alter table public.lukas_drawing_objects enable row level security;
alter table public.lukas_drawing_operations enable row level security;
alter table public.lukas_drawing_snapshots enable row level security;
alter table public.lukas_drawing_revision_approvals enable row level security;
alter table public.lukas_drawing_object_sources enable row level security;
alter table public.lukas_drawing_object_issue_links enable row level security;

revoke all on public.lukas_drawing_documents,
  public.lukas_drawing_revisions, public.lukas_drawing_pages,
  public.lukas_drawing_layers, public.lukas_drawing_objects,
  public.lukas_drawing_operations, public.lukas_drawing_snapshots,
  public.lukas_drawing_revision_approvals,
  public.lukas_drawing_object_sources,
  public.lukas_drawing_object_issue_links
from public, anon, authenticated;

grant select, update, delete on public.lukas_drawing_documents to authenticated;
grant select on public.lukas_drawing_revisions to authenticated;
grant select, insert, update, delete on public.lukas_drawing_pages,
  public.lukas_drawing_layers, public.lukas_drawing_objects,
  public.lukas_drawing_object_sources to authenticated;
grant select, insert, delete on public.lukas_drawing_object_issue_links
  to authenticated;
grant select on public.lukas_drawing_operations,
  public.lukas_drawing_snapshots to authenticated;
grant select, insert on public.lukas_drawing_revision_approvals to authenticated;
revoke update, delete on public.lukas_drawing_operations,
  public.lukas_drawing_snapshots,
  public.lukas_drawing_revision_approvals from authenticated;

grant all on public.lukas_drawing_documents,
  public.lukas_drawing_revisions, public.lukas_drawing_pages,
  public.lukas_drawing_layers, public.lukas_drawing_objects,
  public.lukas_drawing_operations, public.lukas_drawing_snapshots,
  public.lukas_drawing_revision_approvals,
  public.lukas_drawing_object_sources,
  public.lukas_drawing_object_issue_links to service_role;

create policy "project members read drawing documents"
on public.lukas_drawing_documents for select to authenticated
using (private.lukas_drawing_workspace_capability(project_id) is not null);
create policy "workspace editors update draft drawing documents"
on public.lukas_drawing_documents for update to authenticated
using (
  private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and not exists (
    select 1 from public.lukas_drawing_revisions r
    where r.document_id = lukas_drawing_documents.id and r.status <> 'draft'
  )
)
with check (
  private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and not exists (
    select 1 from public.lukas_drawing_revisions r
    where r.document_id = lukas_drawing_documents.id and r.status <> 'draft'
  )
);
create policy "workspace editors delete draft drawing documents"
on public.lukas_drawing_documents for delete to authenticated
using (
  private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and not exists (
    select 1 from public.lukas_drawing_revisions r
    where r.document_id = lukas_drawing_documents.id and r.status <> 'draft'
  )
);

create policy "project members read drawing revisions"
on public.lukas_drawing_revisions for select to authenticated
using (private.lukas_drawing_workspace_capability(project_id) is not null);

create policy "project members read drawing pages"
on public.lukas_drawing_pages for select to authenticated
using (private.lukas_drawing_workspace_capability(project_id) is not null);
create policy "workspace editors add draft drawing pages"
on public.lukas_drawing_pages for insert to authenticated
with check (
  private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_pages.revision_id
      and r.project_id = lukas_drawing_pages.project_id and r.status = 'draft')
);
create policy "workspace editors update draft drawing pages"
on public.lukas_drawing_pages for update to authenticated
using (
  private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_pages.revision_id
      and r.project_id = lukas_drawing_pages.project_id and r.status = 'draft')
)
with check (
  private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_pages.revision_id
      and r.project_id = lukas_drawing_pages.project_id and r.status = 'draft')
);
create policy "workspace editors delete draft drawing pages"
on public.lukas_drawing_pages for delete to authenticated
using (
  private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_pages.revision_id
      and r.project_id = lukas_drawing_pages.project_id and r.status = 'draft')
);

create policy "project members read drawing layers"
on public.lukas_drawing_layers for select to authenticated
using (private.lukas_drawing_workspace_capability(project_id) is not null);
create policy "workspace editors add draft drawing layers"
on public.lukas_drawing_layers for insert to authenticated
with check (
  created_by = (select auth.uid())
  and private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_layers.revision_id
      and r.project_id = lukas_drawing_layers.project_id and r.status = 'draft')
);
create policy "workspace editors update draft drawing layers"
on public.lukas_drawing_layers for update to authenticated
using (
  private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_layers.revision_id
      and r.project_id = lukas_drawing_layers.project_id and r.status = 'draft')
)
with check (
  created_by is not null
  and private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_layers.revision_id
      and r.project_id = lukas_drawing_layers.project_id and r.status = 'draft')
);
create policy "workspace editors delete draft drawing layers"
on public.lukas_drawing_layers for delete to authenticated
using (
  private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_layers.revision_id
      and r.project_id = lukas_drawing_layers.project_id and r.status = 'draft')
);

create policy "project members read drawing objects"
on public.lukas_drawing_objects for select to authenticated
using (private.lukas_drawing_workspace_capability(project_id) is not null);
create policy "workspace editors add draft drawing objects"
on public.lukas_drawing_objects for insert to authenticated
with check (
  created_by = (select auth.uid()) and updated_by = (select auth.uid())
  and private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_objects.revision_id
      and r.project_id = lukas_drawing_objects.project_id and r.status = 'draft')
);
create policy "workspace editors update draft drawing objects"
on public.lukas_drawing_objects for update to authenticated
using (
  private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_objects.revision_id
      and r.project_id = lukas_drawing_objects.project_id and r.status = 'draft')
)
with check (
  updated_by = (select auth.uid())
  and private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_objects.revision_id
      and r.project_id = lukas_drawing_objects.project_id and r.status = 'draft')
);
create policy "workspace editors delete draft drawing objects"
on public.lukas_drawing_objects for delete to authenticated
using (
  private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_objects.revision_id
      and r.project_id = lukas_drawing_objects.project_id and r.status = 'draft')
);

create policy "project members read drawing operations"
on public.lukas_drawing_operations for select to authenticated
using (private.lukas_drawing_workspace_capability(project_id) is not null);
create policy "project members read drawing snapshots"
on public.lukas_drawing_snapshots for select to authenticated
using (private.lukas_drawing_workspace_capability(project_id) is not null);
create policy "project members read drawing revision approvals"
on public.lukas_drawing_revision_approvals for select to authenticated
using (private.lukas_drawing_workspace_capability(project_id) is not null);
create policy "revision approvals enforce maker checker"
on public.lukas_drawing_revision_approvals for insert to authenticated
with check (
  decided_by = (select auth.uid())
  and private.lukas_qto_project_role(project_id) in ('owner', 'staff', 'reviewer')
  and exists (
    select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_revision_approvals.revision_id
      and r.project_id = lukas_drawing_revision_approvals.project_id
      and r.created_by <> (select auth.uid())
  )
);

create policy "project members read drawing object sources"
on public.lukas_drawing_object_sources for select to authenticated
using (private.lukas_drawing_workspace_capability(project_id) is not null);
create policy "workspace editors add draft drawing object sources"
on public.lukas_drawing_object_sources for insert to authenticated
with check (
  created_by = (select auth.uid())
  and private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_object_sources.revision_id
      and r.project_id = lukas_drawing_object_sources.project_id and r.status = 'draft')
);
create policy "workspace editors update draft drawing object sources"
on public.lukas_drawing_object_sources for update to authenticated
using (
  private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_object_sources.revision_id
      and r.project_id = lukas_drawing_object_sources.project_id and r.status = 'draft')
)
with check (
  created_by is not null
  and private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_object_sources.revision_id
      and r.project_id = lukas_drawing_object_sources.project_id and r.status = 'draft')
);
create policy "workspace editors delete draft drawing object sources"
on public.lukas_drawing_object_sources for delete to authenticated
using (
  private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_object_sources.revision_id
      and r.project_id = lukas_drawing_object_sources.project_id and r.status = 'draft')
);

create policy "project members read drawing object issue links"
on public.lukas_drawing_object_issue_links for select to authenticated
using (private.lukas_drawing_workspace_capability(project_id) is not null);
create policy "workspace editors add draft drawing object issue links"
on public.lukas_drawing_object_issue_links for insert to authenticated
with check (
  created_by = (select auth.uid())
  and private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_object_issue_links.revision_id
      and r.project_id = lukas_drawing_object_issue_links.project_id and r.status = 'draft')
);
create policy "workspace editors delete draft drawing object issue links"
on public.lukas_drawing_object_issue_links for delete to authenticated
using (
  private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_object_issue_links.revision_id
      and r.project_id = lukas_drawing_object_issue_links.project_id and r.status = 'draft')
);

revoke all on function private.lukas_drawing_point_valid(jsonb) from public, anon, authenticated;
revoke all on function private.lukas_drawing_style_valid(jsonb) from public, anon, authenticated;
revoke all on function private.lukas_drawing_geometry_valid(text, jsonb) from public, anon, authenticated;
revoke all on function private.lukas_drawing_operation_payload_valid(jsonb)
  from public, anon, authenticated;
revoke all on function private.lukas_drawing_operation_inverse_valid(text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function private.lukas_drawing_document_guard() from public, anon, authenticated;
revoke all on function private.lukas_drawing_page_source_guard() from public, anon, authenticated;
revoke all on function private.lukas_drawing_layer_guard() from public, anon, authenticated;
revoke all on function private.lukas_drawing_object_guard() from public, anon, authenticated;
revoke all on function private.lukas_drawing_object_source_guard() from public, anon, authenticated;
revoke all on function private.lukas_drawing_revision_guard() from public, anon, authenticated;
revoke all on function private.lukas_drawing_draft_child_guard() from public, anon, authenticated;
revoke all on function private.lukas_drawing_draft_child_insert_guard()
  from public, anon, authenticated;
revoke all on function private.lukas_drawing_append_only_guard() from public, anon, authenticated;
revoke all on function private.lukas_drawing_revision_approval_guard() from public, anon, authenticated;
revoke all on function private.lukas_drawing_apply_revision_approval() from public, anon, authenticated;

revoke all on function private.lukas_drawing_workspace_capability(uuid) from public, anon;
grant execute on function private.lukas_drawing_workspace_capability(uuid)
  to authenticated, service_role;

revoke all on function private.lukas_drawing_create_document(uuid, uuid, text, boolean)
  from public, anon;
revoke all on function private.lukas_drawing_apply_operation(uuid, uuid, text, jsonb, jsonb, jsonb)
  from public, anon;
revoke all on function private.lukas_drawing_request_review(uuid) from public, anon;
revoke all on function private.lukas_drawing_record_revision_decision(uuid, bigint, text, text, text)
  from public, anon;
grant execute on function private.lukas_drawing_create_document(uuid, uuid, text, boolean)
  to authenticated, service_role;
grant execute on function private.lukas_drawing_apply_operation(uuid, uuid, text, jsonb, jsonb, jsonb)
  to authenticated, service_role;
grant execute on function private.lukas_drawing_request_review(uuid)
  to authenticated, service_role;
grant execute on function private.lukas_drawing_record_revision_decision(uuid, bigint, text, text, text)
  to authenticated, service_role;

revoke all on function public.lukas_drawing_create_document(uuid, uuid, text, boolean)
  from public, anon;
revoke all on function public.lukas_drawing_apply_operation(uuid, uuid, text, jsonb, jsonb, jsonb)
  from public, anon;
revoke all on function public.lukas_drawing_request_review(uuid) from public, anon;
revoke all on function public.lukas_drawing_record_revision_decision(uuid, bigint, text, text, text)
  from public, anon;
grant execute on function public.lukas_drawing_create_document(uuid, uuid, text, boolean)
  to authenticated, service_role;
grant execute on function public.lukas_drawing_apply_operation(uuid, uuid, text, jsonb, jsonb, jsonb)
  to authenticated, service_role;
grant execute on function public.lukas_drawing_request_review(uuid)
  to authenticated, service_role;
grant execute on function public.lukas_drawing_record_revision_decision(uuid, bigint, text, text, text)
  to authenticated, service_role;
