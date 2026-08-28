begin;

do $$
begin
  if exists(select 1 from public.lukas_drawing_ifc_derivatives where status='ready') then
    raise exception using errcode='23514',
      message='Ready IFC derivatives require byte-size backfill before authority upgrade';
  end if;
end;
$$;

alter table public.lukas_drawing_ifc_derivatives
  add column manifest_byte_size bigint,
  add column geometry_byte_size bigint;

alter table public.lukas_drawing_ifc_derivatives
  drop constraint lukas_drawing_ifc_derivatives_ready_payload_check,
  add constraint lukas_drawing_ifc_derivatives_ready_payload_check check(
    status='ready'
      and manifest_json is not null
      and pg_catalog.jsonb_typeof(manifest_json)='object'
      and manifest_json->>'schemaVersion'=schema_version::text
      and manifest_json#>>'{source,fileId}'=source_file_id::text
      and manifest_json#>>'{source,sha256}'=source_sha256
      and manifest_json#>>'{geometry,sha256}'=geometry_sha256
      and pg_catalog.jsonb_typeof(manifest_json->'elements')='array'
      and manifest_byte_size between 1 and 33554432
      and geometry_byte_size between 1 and 209715200
      and manifest_sha256 ~ '^[0-9a-f]{64}$'
      and geometry_sha256 ~ '^[0-9a-f]{64}$'
      and manifest_storage_path=
        'projects/'||project_id::text||'/ifc-derivatives/'||source_sha256||
        '/v'||version::text||'/'||manifest_sha256||'.json'
      and geometry_storage_path=
        'projects/'||project_id::text||'/ifc-derivatives/'||source_sha256||
        '/v'||version::text||'/'||geometry_sha256||'.glb'
    or status in ('pending','failed')
      and manifest_json is null
      and manifest_storage_path is null
      and manifest_byte_size is null
      and manifest_sha256 is null
      and geometry_storage_path is null
      and geometry_byte_size is null
      and geometry_sha256 is null
  ),
  add constraint lukas_drawing_ifc_derivatives_binding_identity_key unique(
    id,project_id,source_file_id,source_sha256,version,
    manifest_sha256,geometry_sha256
  );

create table public.lukas_drawing_revision_ifc_derivatives(
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null,
  revision_version bigint not null check(revision_version>0),
  project_id uuid not null references public.lukas_qto_projects(id) on delete restrict,
  source_file_id uuid not null,
  source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
  derivative_id uuid not null,
  derivative_version bigint not null check(derivative_version>0),
  manifest_sha256 text not null check(manifest_sha256 ~ '^[0-9a-f]{64}$'),
  geometry_sha256 text not null check(geometry_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  constraint lukas_drawing_revision_ifc_derivatives_revision_fkey
    foreign key(revision_id,project_id)
    references public.lukas_drawing_revisions(id,project_id) on delete restrict,
  constraint lukas_drawing_revision_ifc_derivatives_source_fkey
    foreign key(source_file_id,project_id,source_sha256)
    references public.lukas_qto_files(id,project_id,sha256) on delete restrict,
  constraint lukas_drawing_revision_ifc_derivatives_derivative_fkey
    foreign key(
      derivative_id,project_id,source_file_id,source_sha256,
      derivative_version,manifest_sha256,geometry_sha256
    ) references public.lukas_drawing_ifc_derivatives(
      id,project_id,source_file_id,source_sha256,
      version,manifest_sha256,geometry_sha256
    ) on delete restrict,
  unique(revision_id,revision_version,source_file_id)
);

create function private.lukas_drawing_revision_ifc_derivative_immutable_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  raise exception using errcode='42501',
    message='Drawing revision IFC derivative bindings are immutable';
end;
$$;

create trigger lukas_drawing_revision_ifc_derivatives_immutable
before update or delete on public.lukas_drawing_revision_ifc_derivatives
for each row execute function private.lukas_drawing_revision_ifc_derivative_immutable_guard();

create function private.lukas_drawing_bind_ifc_derivatives(p_revision_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_source record;
  v_derivative public.lukas_drawing_ifc_derivatives%rowtype;
begin
  select r.* into v_revision from public.lukas_drawing_revisions r
  where r.id=p_revision_id and v_actor is not null
    and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor')
  for update;
  if not found or v_revision.status<>'draft' then
    raise exception using errcode='P1R01',
      message='Drawing revision IFC derivative binding target is unavailable';
  end if;
  for v_source in
    select distinct source.id,source.sha256
    from (
      select f.id,f.sha256
      from public.lukas_drawing_documents d
      join public.lukas_qto_files f
        on f.id=d.source_file_id and f.project_id=d.project_id
      where d.id=v_revision.document_id and d.project_id=v_revision.project_id
        and f.kind='ifc' and f.immutable
      union
      select f.id,f.sha256
      from public.lukas_drawing_object_sources s
      join public.lukas_qto_files f
        on f.id=s.source_file_id and f.project_id=s.project_id
       and f.sha256=s.source_sha256
      where s.revision_id=v_revision.id and s.project_id=v_revision.project_id
        and s.status='active' and s.source_kind='ifc_element'
        and f.kind='ifc' and f.immutable
    ) source order by source.id
  loop
    select d.* into v_derivative
    from public.lukas_drawing_ifc_derivatives d
    where d.project_id=v_revision.project_id
      and d.source_file_id=v_source.id
      and d.source_sha256=v_source.sha256
      and d.status='ready'
    order by d.version desc,d.id desc limit 1;
    if not found then
      raise exception using errcode='P1C01',
        message='Drawing review requires a ready IFC derivative';
    end if;
    insert into public.lukas_drawing_revision_ifc_derivatives(
      revision_id,revision_version,project_id,source_file_id,source_sha256,
      derivative_id,derivative_version,manifest_sha256,geometry_sha256,created_by
    ) values(
      v_revision.id,v_revision.version,v_revision.project_id,
      v_source.id,v_source.sha256,v_derivative.id,v_derivative.version,
      v_derivative.manifest_sha256,v_derivative.geometry_sha256,v_actor
    ) on conflict(revision_id,revision_version,source_file_id) do nothing;
  end loop;
end;
$$;

alter function private.lukas_drawing_request_review(uuid)
  rename to lukas_drawing_request_review_pre_ifc_derivative_binding;
create function private.lukas_drawing_request_review(p_revision_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.lukas_drawing_bind_ifc_derivatives(p_revision_id);
  return private.lukas_drawing_request_review_pre_ifc_derivative_binding(
    p_revision_id
  );
end;
$$;

alter table public.lukas_drawing_revision_ifc_derivatives enable row level security;
alter table public.lukas_drawing_revision_ifc_derivatives force row level security;
revoke all on table public.lukas_drawing_revision_ifc_derivatives
from public,anon,authenticated;
grant select on table public.lukas_drawing_revision_ifc_derivatives
to authenticated,service_role;
create policy "project members read pinned IFC derivatives"
on public.lukas_drawing_revision_ifc_derivatives for select to authenticated
using(private.lukas_qto_project_role(project_id) is not null);

revoke all on function private.lukas_drawing_revision_ifc_derivative_immutable_guard(),
  private.lukas_drawing_bind_ifc_derivatives(uuid),
  private.lukas_drawing_request_review_pre_ifc_derivative_binding(uuid)
from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_request_review(uuid)
from public,anon;
grant execute on function private.lukas_drawing_request_review(uuid)
to authenticated,service_role;

alter default privileges revoke execute on functions from public;

commit;
