begin;

create table public.lukas_drawing_ifc_derivatives (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete restrict,
  source_file_id uuid not null,
  source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
  version bigint not null check(version > 0),
  schema_version integer not null check(schema_version = 1),
  status text not null check(status in ('pending','ready','failed')),
  manifest_json jsonb,
  manifest_storage_path text,
  manifest_sha256 text,
  geometry_storage_path text,
  geometry_sha256 text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  constraint lukas_drawing_ifc_derivatives_source_identity_fkey
    foreign key (source_file_id,project_id,source_sha256)
    references public.lukas_qto_files(id,project_id,sha256) on delete restrict,
  constraint lukas_drawing_ifc_derivatives_source_version_key
    unique(source_file_id,project_id,version),
  constraint lukas_drawing_ifc_derivatives_ready_payload_check check(
    status='ready'
      and manifest_json is not null
      and pg_catalog.jsonb_typeof(manifest_json)='object'
      and manifest_json->>'schemaVersion'=schema_version::text
      and manifest_json#>>'{source,fileId}'=source_file_id::text
      and manifest_json#>>'{source,sha256}'=source_sha256
      and manifest_json#>>'{geometry,sha256}'=geometry_sha256
      and pg_catalog.jsonb_typeof(manifest_json->'elements')='array'
      and pg_catalog.char_length(manifest_storage_path) between 1 and 1000
      and manifest_sha256 ~ '^[0-9a-f]{64}$'
      and pg_catalog.char_length(geometry_storage_path) between 1 and 1000
      and geometry_sha256 ~ '^[0-9a-f]{64}$'
    or status in ('pending','failed')
      and manifest_json is null
      and manifest_storage_path is null
      and manifest_sha256 is null
      and geometry_storage_path is null
      and geometry_sha256 is null
  )
);

create function private.lukas_drawing_ifc_derivative_insert_guard()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare v_file public.lukas_qto_files%rowtype;
begin
  select f.* into v_file
  from public.lukas_qto_files f
  where f.id=new.source_file_id
    and f.project_id=new.project_id
    and f.sha256=new.source_sha256;
  if not found or v_file.kind<>'ifc' or not v_file.immutable then
    raise exception using errcode='23514',
      message='IFC derivative requires an immutable IFC source identity';
  end if;
  return new;
end;
$$;

create function private.lukas_drawing_ifc_derivative_immutable_guard()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  if exists(
    select 1
    from public.lukas_drawing_revisions r
    join public.lukas_drawing_documents d
      on d.id=r.document_id and d.project_id=r.project_id
    where d.source_file_id=old.source_file_id
      and r.project_id=old.project_id
      and r.status in ('approved','superseded')
  ) or exists(
    select 1
    from public.lukas_drawing_revisions r
    join public.lukas_drawing_object_sources s
      on s.revision_id=r.id and s.project_id=r.project_id
    where s.source_file_id=old.source_file_id
      and r.project_id=old.project_id
      and r.status in ('approved','superseded')
  ) then
    raise exception using errcode='42501',
      message='cannot mutate approved IFC derivative evidence';
  end if;
  raise exception using errcode='42501',
    message='IFC derivative artifacts are immutable; insert a new version';
end;
$$;

create trigger lukas_drawing_ifc_derivatives_insert_guard
before insert on public.lukas_drawing_ifc_derivatives
for each row execute function private.lukas_drawing_ifc_derivative_insert_guard();

create trigger lukas_drawing_ifc_derivatives_immutable
before update or delete on public.lukas_drawing_ifc_derivatives
for each row execute function private.lukas_drawing_ifc_derivative_immutable_guard();

alter table public.lukas_drawing_ifc_derivatives enable row level security;
alter table public.lukas_drawing_ifc_derivatives force row level security;

revoke all on table public.lukas_drawing_ifc_derivatives from public,anon,authenticated;
grant select on table public.lukas_drawing_ifc_derivatives to authenticated;
grant select,insert on table public.lukas_drawing_ifc_derivatives to service_role;

create policy "project members read immutable IFC derivatives"
on public.lukas_drawing_ifc_derivatives
for select to authenticated
using(private.lukas_qto_project_role(project_id) is not null);

revoke all on function private.lukas_drawing_ifc_derivative_insert_guard()
from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_ifc_derivative_immutable_guard()
from public,anon,authenticated,service_role;

alter default privileges revoke execute on functions from public;

commit;
