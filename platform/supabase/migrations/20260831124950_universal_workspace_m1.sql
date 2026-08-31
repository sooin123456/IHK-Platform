begin;

alter table public.lukas_drawing_documents
  add column creation_request_id uuid,
  add column creation_request_sha256 text
    check (creation_request_sha256 is null or creation_request_sha256~'^[0-9a-f]{64}$'),
  add constraint lukas_drawing_documents_creation_identity_check check (
    (creation_request_id is null and creation_request_sha256 is null)
    or (creation_request_id is not null and creation_request_sha256 is not null)
  );

create unique index lukas_drawing_documents_creation_request_key
  on public.lukas_drawing_documents(project_id,created_by,creation_request_id)
  where creation_request_id is not null;

create or replace function private.lukas_drawing_document_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_owner name;
  v_marker text;
begin
  select pg_catalog.pg_get_userbyid(c.relowner) into v_owner
  from pg_catalog.pg_class c where c.oid=tg_relid;
  if tg_op='INSERT' then
    if v_actor is null or new.created_by<>v_actor then
      raise exception 'Drawing document creator must be the authenticated user';
    end if;
    if new.creation_request_id is not null
      or new.creation_request_sha256 is not null then
      raise exception using errcode='P1C01',
        message='Drawing document creation identity is immutable';
    end if;
  elsif tg_op='UPDATE' then
    if new.project_id is distinct from old.project_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'Drawing document identity is immutable';
    end if;
    if new.creation_request_id is distinct from old.creation_request_id
      or new.creation_request_sha256 is distinct from old.creation_request_sha256 then
      v_marker:=pg_catalog.current_setting('lukas.drawing_creation_identity',true);
      if old.creation_request_id is not null
        or old.creation_request_sha256 is not null
        or new.creation_request_id is null
        or new.creation_request_sha256 is null
        or current_user<>v_owner
        or v_marker is distinct from
          old.id::text||':'||new.creation_request_id::text||':'||new.creation_request_sha256 then
        raise exception using errcode='P1C01',
          message='Drawing document creation identity is immutable';
      end if;
    end if;
  end if;
  if tg_op<>'INSERT' and exists(
    select 1 from public.lukas_drawing_revisions r
    where r.document_id=old.id and r.status<>'draft'
  ) then
    raise exception 'Drawing document with a non-draft revision is immutable';
  end if;
  if tg_op='DELETE' then return old; end if;
  if new.source_file_id is not null and not exists(
    select 1 from public.lukas_qto_files f
    where f.id=new.source_file_id and f.project_id=new.project_id
      and f.sha256=new.source_sha256 and f.kind in ('pdf','ifc') and f.immutable
  ) then
    raise exception 'Drawing source must be an immutable PDF or IFC from the project';
  end if;
  new.updated_at:=pg_catalog.now();
  return new;
end;
$$;

create or replace function private.lukas_drawing_document_creation_result(
  p_document_id uuid
) returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'documentId',d.id,
    'revisionId',r.id,
    'pageId',p.id,
    'canvasId',c.id,
    'sourceLayerId',(pg_catalog.array_agg(l.id order by l.id)
      filter(where l.system_kind='source'))[1],
    'workLayerId',(pg_catalog.array_agg(l.id order by l.id)
      filter(where l.system_kind='work'))[1]
  )
  from public.lukas_drawing_documents d
  join public.lukas_drawing_revisions r
    on r.document_id=d.id and r.project_id=d.project_id and r.sequence=1
  join public.lukas_drawing_pages p
    on p.revision_id=r.id and p.project_id=r.project_id and p.sort_order=0
  join public.lukas_drawing_canvases c
    on c.page_id=p.id and c.revision_id=r.id and c.project_id=r.project_id
      and c.sort_order=0
  join public.lukas_drawing_layers l
    on l.canvas_id=c.id and l.revision_id=r.id and l.project_id=r.project_id
  where d.id=p_document_id
  group by d.id,r.id,p.id,c.id
$$;

create or replace function private.lukas_drawing_create_document_idempotent(
  p_project_id uuid,p_source_file_id uuid,p_title text,p_blank boolean,
  p_client_request_id uuid,p_library_version_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_existing public.lukas_drawing_documents%rowtype;
  v_request_sha text;
  v_result jsonb;
begin
  if v_actor is null or p_client_request_id is null
    or p_title is null
    or pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 1 and 240
    or p_blank is null then
    raise exception using errcode='P1R01',message='Drawing creation is unavailable';
  end if;
  if private.lukas_drawing_workspace_capability(p_project_id)
      not in ('admin','editor') then
    raise exception using errcode='P1R01',message='Drawing creation is unavailable';
  end if;
  v_request_sha:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'projectId',p_project_id,'sourceFileId',p_source_file_id,
      'title',pg_catalog.btrim(p_title),'blank',p_blank,
      'libraryVersionId',p_library_version_id
    )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor::text||':'||p_client_request_id::text,0
  ));
  select * into v_existing from public.lukas_drawing_documents d
  where d.project_id=p_project_id and d.created_by=v_actor
    and d.creation_request_id=p_client_request_id for update;
  if found then
    if v_existing.creation_request_sha256 is distinct from v_request_sha then
      raise exception using errcode='P1C01',
        message='Request ID does not match the stored drawing creation';
    end if;
    return private.lukas_drawing_document_creation_result(v_existing.id);
  end if;
  v_result:=private.lukas_drawing_create_document(
    p_project_id,p_source_file_id,p_title,p_blank
  );
  perform pg_catalog.set_config(
    'lukas.drawing_creation_identity',
    (v_result->>'documentId')||':'||p_client_request_id::text||':'||v_request_sha,
    true
  );
  update public.lukas_drawing_documents set
    creation_request_id=p_client_request_id,
    creation_request_sha256=v_request_sha
  where id=(v_result->>'documentId')::uuid and project_id=p_project_id;
  perform pg_catalog.set_config('lukas.drawing_creation_identity','',true);
  return v_result;
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01'
    or serialization_failure or deadlock_detected then raise;
  when unique_violation or foreign_key_violation or check_violation
    or not_null_violation then
    raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

create function public.lukas_drawing_create_document_idempotent(
  p_project_id uuid,p_source_file_id uuid,p_title text,p_blank boolean,
  p_client_request_id uuid,p_library_version_id uuid default null
) returns jsonb language sql security invoker set search_path='' as $$
  select private.lukas_drawing_create_document_idempotent(
    p_project_id,p_source_file_id,p_title,p_blank,p_client_request_id,
    p_library_version_id
  )
$$;

create table private.lukas_drawing_platform_starters (
  key text not null check(key~'^[a-z][a-z0-9-]{0,63}$'),
  version bigint not null check(version>0),
  canonical_payload jsonb not null check(
    pg_catalog.jsonb_typeof(canonical_payload)='object'
    and pg_catalog.octet_length(canonical_payload::text)<=65536
  ),
  content_sha256 text not null check(content_sha256~'^[0-9a-f]{64}$'),
  primary key(key,version),
  check(canonical_payload->>'key'=key),
  check((canonical_payload->>'version')::bigint=version),
  check(canonical_payload->>'schemaVersion'='1hk-platform-starter/1'),
  check(pg_catalog.jsonb_typeof(canonical_payload->'layers')='array'),
  check(pg_catalog.jsonb_array_length(canonical_payload->'layers')>0),
  check(canonical_payload->'categories'=
    '["바닥","벽","천장","문","창호","가구","철거"]'::jsonb),
  check(canonical_payload->'evidenceKinds'=
    '["수기 입력","현장 실측","가정값","원본 연결"]'::jsonb),
  check(canonical_payload->'table'->>'name'='기본 내역'),
  check(canonical_payload->'table'->'columns'=
    '["적산 분류","품목 코드","측정 종류","단위","검토 규칙"]'::jsonb),
  check(canonical_payload->'table'->'rows'='[]'::jsonb),
  check(content_sha256=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(canonical_payload::text,'UTF8'),'sha256'
  ),'hex'))
);

insert into private.lukas_drawing_platform_starters(
  key,version,canonical_payload,content_sha256
)
select seed.key,seed.version,seed.canonical_payload,
  pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(seed.canonical_payload::text,'UTF8'),'sha256'
  ),'hex')
from (values
('interior-basic',1,$json${
  "schemaVersion":"1hk-platform-starter/1","key":"interior-basic","version":1,
  "name":"실내건축 기본 적산","description":"바닥·벽·천장·문·창호·가구 기본 수량을 정리합니다.",
  "layers":["실측","바닥","벽","천장","문·창호","가구"],
  "categories":["바닥","벽","천장","문","창호","가구","철거"],
  "evidenceKinds":["수기 입력","현장 실측","가정값","원본 연결"],
  "table":{"name":"기본 내역","columns":["적산 분류","품목 코드","측정 종류","단위","검토 규칙"],"rows":[]}
}$json$::jsonb),
('apartment-remodel',1,$json${
  "schemaVersion":"1hk-platform-starter/1","key":"apartment-remodel","version":1,
  "name":"공동주택 리모델링","description":"세대 공간별 마감·창호·가구·철거 수량을 정리합니다.",
  "layers":["실측","기존","철거","신설","마감","가구"],
  "categories":["바닥","벽","천장","문","창호","가구","철거"],
  "evidenceKinds":["수기 입력","현장 실측","가정값","원본 연결"],
  "table":{"name":"기본 내역","columns":["적산 분류","품목 코드","측정 종류","단위","검토 규칙"],"rows":[]}
}$json$::jsonb),
('commercial-interior',1,$json${
  "schemaVersion":"1hk-platform-starter/1","key":"commercial-interior","version":1,
  "name":"상업공간 인테리어","description":"영업 공간의 구획·마감·집기 수량을 정리합니다.",
  "layers":["실측","구획","바닥","벽","천장","집기","설비 근거"],
  "categories":["바닥","벽","천장","문","창호","가구","철거"],
  "evidenceKinds":["수기 입력","현장 실측","가정값","원본 연결"],
  "table":{"name":"기본 내역","columns":["적산 분류","품목 코드","측정 종류","단위","검토 규칙"],"rows":[]}
}$json$::jsonb),
('demolition-restoration',1,$json${
  "schemaVersion":"1hk-platform-starter/1","key":"demolition-restoration","version":1,
  "name":"철거·원상복구","description":"철거 대상과 복구 대상을 분리해 수량을 정리합니다.",
  "layers":["실측","존치","철거","폐기","복구","보양"],
  "categories":["바닥","벽","천장","문","창호","가구","철거"],
  "evidenceKinds":["수기 입력","현장 실측","가정값","원본 연결"],
  "table":{"name":"기본 내역","columns":["적산 분류","품목 코드","측정 종류","단위","검토 규칙"],"rows":[]}
}$json$::jsonb)) as seed(key,version,canonical_payload);

create function private.lukas_drawing_platform_starter_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  raise exception using errcode='P1C01',
    message='Platform drawing starter versions are immutable';
end;
$$;
create trigger lukas_drawing_platform_starter_guard
before update or delete on private.lukas_drawing_platform_starters
for each row execute function private.lukas_drawing_platform_starter_guard();

alter table public.lukas_drawing_library_versions
  add column source_kind text not null default 'project_revision'
    constraint lukas_drawing_library_versions_source_kind_value_check
    check(source_kind in('project_revision','platform_starter')),
  add column platform_starter_key text,
  add column platform_starter_version bigint,
  alter column source_project_id drop not null,
  alter column source_revision_id drop not null,
  add constraint lukas_drawing_library_versions_source_kind_check check(
    (source_kind='project_revision' and source_project_id is not null
      and source_revision_id is not null and platform_starter_key is null
      and platform_starter_version is null)
    or
    (source_kind='platform_starter' and source_project_id is null
      and source_revision_id is null and source_entity_id is null
      and platform_starter_key is not null and platform_starter_version is not null)
  ),
  add constraint lukas_drawing_library_versions_platform_starter_fkey
    foreign key(platform_starter_key,platform_starter_version)
    references private.lukas_drawing_platform_starters(key,version)
    on delete restrict;

create unique index lukas_drawing_library_versions_platform_starter_key
  on public.lukas_drawing_library_versions(
    organization_id,platform_starter_key,platform_starter_version
  ) where source_kind='platform_starter';

create or replace function private.lukas_drawing_library_version_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    if current_user<>pg_catalog.pg_get_userbyid(
        (select c.relowner from pg_catalog.pg_class c where c.oid=tg_relid)
      ) or new.status<>'draft' then
      raise exception using errcode='P1C01',
        message='Library versions must start as an authorized draft';
    end if;
    return new;
  end if;
  if tg_op='DELETE' then
    raise exception using errcode='P1C01',
      message='Published library versions are immutable';
  end if;
  if new.id is distinct from old.id
    or new.registry_id is distinct from old.registry_id
    or new.organization_id is distinct from old.organization_id
    or new.version_no is distinct from old.version_no
    or new.canonical_payload is distinct from old.canonical_payload
    or new.content_sha256 is distinct from old.content_sha256
    or new.predecessor_version_id is distinct from old.predecessor_version_id
    or new.predecessor_registry_id is distinct from old.predecessor_registry_id
    or new.predecessor_organization_id is distinct from old.predecessor_organization_id
    or new.source_project_id is distinct from old.source_project_id
    or new.source_revision_id is distinct from old.source_revision_id
    or new.source_entity_id is distinct from old.source_entity_id
    or new.source_kind is distinct from old.source_kind
    or new.platform_starter_key is distinct from old.platform_starter_key
    or new.platform_starter_version is distinct from old.platform_starter_version
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.published_by is distinct from coalesce(old.published_by,new.published_by)
    or new.published_at is distinct from coalesce(old.published_at,new.published_at)
    or not(
      current_user=pg_catalog.pg_get_userbyid(
        (select c.relowner from pg_catalog.pg_class c where c.oid=tg_relid)
      ) and(
        (old.status='draft' and new.status='published'
          and old.published_by is null and new.published_by is not null
          and old.published_at is null and new.published_at is not null
          and old.deprecated_at is null and new.deprecated_at is null)
        or(old.status='published' and new.status='deprecated'
          and new.published_by=old.published_by
          and new.published_at=old.published_at
          and old.deprecated_at is null and new.deprecated_at is not null)
      )
    ) then
    raise exception using errcode='P1C01',message='Library version content is immutable';
  end if;
  return new;
end;
$$;

create function private.lukas_drawing_list_platform_starters(
  p_organization_id uuid,p_project_id uuid
) returns table(
  key text,version bigint,name text,description text,
  canonical_payload jsonb,content_sha256 text
) language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null
    or not private.lukas_qto_verified_session()
    or not private.lukas_qto_organization_library_access(p_organization_id)
    or private.lukas_drawing_workspace_capability(p_project_id) is null
    or not exists(
      select 1 from public.lukas_qto_projects p
      where p.id=p_project_id and p.organization_id=p_organization_id
    )
    or not private.lukas_qto_project_feature_active(
      p_project_id,'organization_library'
    ) then
    raise exception using errcode='P1R01',
      message='Platform drawing starters are unavailable';
  end if;
  return query
  select s.key,s.version,s.canonical_payload->>'name',
    s.canonical_payload->>'description',s.canonical_payload,s.content_sha256
  from private.lukas_drawing_platform_starters s
  order by s.key collate "C",s.version;
end;
$$;

create function public.lukas_drawing_list_platform_starters(
  p_organization_id uuid,p_project_id uuid
) returns table(
  key text,version bigint,name text,description text,
  canonical_payload jsonb,content_sha256 text
) language sql stable security invoker set search_path='' as $$
  select * from private.lukas_drawing_list_platform_starters(
    p_organization_id,p_project_id
  )
$$;

create function private.lukas_drawing_ensure_platform_starter_version(
  p_organization_id uuid,p_project_id uuid,p_key text,p_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_starter private.lukas_drawing_platform_starters%rowtype;
  v_entry public.lukas_drawing_library_entries%rowtype;
  v_version public.lukas_drawing_library_versions%rowtype;
  v_previous public.lukas_drawing_library_versions%rowtype;
  v_version_no bigint;
begin
  if v_actor is null or not private.lukas_qto_verified_session()
    or private.lukas_drawing_workspace_capability(p_project_id)
      not in('admin','editor')
    or not private.lukas_qto_organization_library_access(p_organization_id)
    or not private.lukas_qto_project_feature_active(
      p_project_id,'organization_library'
    )
    or not exists(
      select 1 from public.lukas_qto_projects p
      where p.id=p_project_id and p.organization_id=p_organization_id
    ) then
    raise exception using errcode='P1R01',
      message='Platform drawing starter is unavailable';
  end if;
  select * into v_starter from private.lukas_drawing_platform_starters s
  where s.key=p_key and s.version=p_version;
  if not found then
    raise exception using errcode='P1R01',
      message='Platform drawing starter is unavailable';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text||':platform-starter:'||p_key||':'||p_version::text,0
  ));
  select * into v_version from public.lukas_drawing_library_versions v
  where v.organization_id=p_organization_id
    and v.source_kind='platform_starter'
    and v.platform_starter_key=p_key
    and v.platform_starter_version=p_version
  for update;
  if found then
    if v_version.status<>'published'
      or v_version.canonical_payload is distinct from v_starter.canonical_payload
      or v_version.content_sha256 is distinct from v_starter.content_sha256 then
      raise exception using errcode='P1C01',
        message='Platform starter library version is inconsistent';
    end if;
    return pg_catalog.jsonb_build_object(
      'registryId',v_version.registry_id,'versionId',v_version.id,
      'versionNo',v_version.version_no,'key',p_key,'version',p_version,
      'name',v_starter.canonical_payload->>'name',
      'description',v_starter.canonical_payload->>'description',
      'canonicalPayload',v_version.canonical_payload,
      'contentSha256',v_version.content_sha256,'status',v_version.status
    );
  end if;
  select * into v_entry from public.lukas_drawing_library_entries e
  where e.organization_id=p_organization_id and e.kind='workspace_template'
    and e.name=v_starter.canonical_payload->>'name' for update;
  if found then
    if not exists(
      select 1 from public.lukas_drawing_library_versions v
      where v.registry_id=v_entry.id and v.organization_id=p_organization_id
        and v.source_kind='platform_starter'
    ) then
      raise exception using errcode='P1C01',
        message='A custom drawing library entry already uses this starter name';
    end if;
  else
    insert into public.lukas_drawing_library_entries(
      organization_id,kind,name,created_by
    ) values(
      p_organization_id,'workspace_template',
      v_starter.canonical_payload->>'name',v_actor
    ) returning * into v_entry;
  end if;
  select * into v_previous from public.lukas_drawing_library_versions v
  where v.registry_id=v_entry.id and v.organization_id=p_organization_id
  order by v.version_no desc limit 1 for update;
  v_version_no:=coalesce(v_previous.version_no,0)+1;
  insert into public.lukas_drawing_library_versions(
    registry_id,organization_id,version_no,status,canonical_payload,
    content_sha256,predecessor_version_id,predecessor_registry_id,
    predecessor_organization_id,source_project_id,source_revision_id,
    source_entity_id,source_kind,platform_starter_key,
    platform_starter_version,created_by
  ) values(
    v_entry.id,p_organization_id,v_version_no,'draft',
    v_starter.canonical_payload,v_starter.content_sha256,
    v_previous.id,case when v_previous.id is null then null else v_entry.id end,
    case when v_previous.id is null then null else p_organization_id end,
    null,null,null,'platform_starter',p_key,p_version,v_actor
  ) returning * into v_version;
  update public.lukas_drawing_library_versions set
    status='published',published_by=v_actor,published_at=pg_catalog.now()
  where id=v_version.id returning * into v_version;
  return pg_catalog.jsonb_build_object(
    'registryId',v_version.registry_id,'versionId',v_version.id,
    'versionNo',v_version.version_no,'key',p_key,'version',p_version,
    'name',v_starter.canonical_payload->>'name',
    'description',v_starter.canonical_payload->>'description',
    'canonicalPayload',v_version.canonical_payload,
    'contentSha256',v_version.content_sha256,'status',v_version.status
  );
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01'
    or serialization_failure or deadlock_detected then raise;
  when unique_violation or foreign_key_violation or check_violation
    or not_null_violation then
    raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

create function public.lukas_drawing_ensure_platform_starter_version(
  p_organization_id uuid,p_project_id uuid,p_key text,p_version bigint
) returns jsonb language sql security invoker set search_path='' as $$
  select private.lukas_drawing_ensure_platform_starter_version(
    p_organization_id,p_project_id,p_key,p_version
  )
$$;

create function private.lukas_drawing_record_platform_starter_import(
  p_organization_id uuid,p_version_id uuid,p_project_id uuid,
  p_document_id uuid,p_revision_id uuid,p_client_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_version public.lukas_drawing_library_versions%rowtype;
  v_starter private.lukas_drawing_platform_starters%rowtype;
  v_existing public.lukas_drawing_library_imports%rowtype;
  v_table public.lukas_drawing_tables%rowtype;
  v_layer_names jsonb;
  v_schema_fingerprint jsonb;
  v_structure jsonb;
  v_structure_sha text;
  v_request_sha text;
  v_import_id uuid;
  v_expected_applies_to constant jsonb:=
    '["line","polyline","rectangle","circle","text","dimension","wall","opening","space","area","grid","arc","block_instance"]'::jsonb;
begin
  if v_actor is null or p_client_request_id is null
    or not private.lukas_qto_verified_session()
    or private.lukas_drawing_workspace_capability(p_project_id)
      not in('admin','editor')
    or not private.lukas_qto_organization_library_access(p_organization_id)
    or not private.lukas_qto_project_feature_active(
      p_project_id,'organization_library'
    )
    or not exists(
      select 1 from public.lukas_qto_projects p
      where p.id=p_project_id and p.organization_id=p_organization_id
    ) then
    raise exception using errcode='P1R01',
      message='Platform starter import is unavailable';
  end if;
  select * into v_version from public.lukas_drawing_library_versions v
  where v.id=p_version_id and v.organization_id=p_organization_id
    and v.source_kind='platform_starter' and v.status='published'
  for key share;
  if not found then
    raise exception using errcode='P1R01',
      message='Platform starter library version is unavailable';
  end if;
  select * into v_starter from private.lukas_drawing_platform_starters s
  where s.key=v_version.platform_starter_key
    and s.version=v_version.platform_starter_version;
  if not found
    or v_version.canonical_payload is distinct from v_starter.canonical_payload
    or v_version.content_sha256 is distinct from v_starter.content_sha256 then
    raise exception using errcode='P1R01',
      message='Platform starter library version changed';
  end if;
  if not exists(
    select 1 from public.lukas_drawing_documents d
    join public.lukas_drawing_revisions r
      on r.document_id=d.id and r.project_id=d.project_id
    where d.id=p_document_id and d.project_id=p_project_id
      and r.id=p_revision_id and r.status='draft'
  ) then
    raise exception using errcode='P1R01',
      message='Platform starter target is unavailable';
  end if;
  select coalesce(pg_catalog.jsonb_agg(l.name order by l.sort_order,l.id),'[]'::jsonb)
    into v_layer_names
  from public.lukas_drawing_layers l
  where l.revision_id=p_revision_id and l.project_id=p_project_id
    and l.system_kind='custom';
  if v_layer_names is distinct from v_starter.canonical_payload->'layers' then
    raise exception using errcode='P1C01',
      message='Platform starter structure does not match its immutable version';
  end if;
  if (select pg_catalog.count(*) from public.lukas_drawing_property_schemas s
      where s.revision_id=p_revision_id and s.project_id=p_project_id)<>5
    or exists(
      select 1 from public.lukas_drawing_property_schemas s
      where s.revision_id=p_revision_id and s.project_id=p_project_id
        and (s.version<>1 or s.required or s.applies_to is distinct from v_expected_applies_to)
    )
    or not exists(
      select 1 from public.lukas_drawing_property_schemas s
      where s.revision_id=p_revision_id and s.project_id=p_project_id
        and s.name='적산 분류' and s.value_type='enum'
        and s.enum_options=v_starter.canonical_payload->'categories'
    )
    or not exists(
      select 1 from public.lukas_drawing_property_schemas s
      where s.revision_id=p_revision_id and s.project_id=p_project_id
        and s.name='근거 상태' and s.value_type='enum'
        and s.enum_options=v_starter.canonical_payload->'evidenceKinds'
    )
    or (select pg_catalog.count(*) from public.lukas_drawing_property_schemas s
      where s.revision_id=p_revision_id and s.project_id=p_project_id
        and s.name in('공종','품목 코드','근거 사유')
        and s.value_type='text' and s.enum_options='[]'::jsonb)<>3 then
    raise exception using errcode='P1C01',
      message='Platform starter structure does not match its immutable version';
  end if;
  select * into v_table from public.lukas_drawing_tables t
  where t.revision_id=p_revision_id and t.project_id=p_project_id
    and t.name='기본 내역';
  if not found or v_table.version<>1 or v_table.rows_json<>'[]'::jsonb
    or (select pg_catalog.jsonb_agg(c.value->>'name' order by c.ordinality)
      from pg_catalog.jsonb_array_elements(v_table.columns_json)
        with ordinality c(value,ordinality))
      is distinct from v_starter.canonical_payload->'table'->'columns'
    or not exists(
      select 1 from public.lukas_drawing_property_schemas s
      where s.revision_id=p_revision_id and s.project_id=p_project_id
        and s.name='적산 분류'
        and s.id=(v_table.columns_json->0->>'propertySchemaId')::uuid
    )
    or not exists(
      select 1 from public.lukas_drawing_property_schemas s
      where s.revision_id=p_revision_id and s.project_id=p_project_id
        and s.name='품목 코드'
        and s.id=(v_table.columns_json->1->>'propertySchemaId')::uuid
    )
    or exists(
      select 1 from pg_catalog.jsonb_array_elements(v_table.columns_json)
        with ordinality c(value,ordinality)
      where c.ordinality>2 and c.value->'propertySchemaId'<>'null'::jsonb
    ) then
    raise exception using errcode='P1C01',
      message='Platform starter structure does not match its immutable version';
  end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'name',s.name,'valueType',s.value_type,'enumOptions',s.enum_options,
      'appliesTo',s.applies_to,'required',s.required,'version',s.version
    ) order by s.name collate "C") into v_schema_fingerprint
  from public.lukas_drawing_property_schemas s
  where s.revision_id=p_revision_id and s.project_id=p_project_id;
  v_structure:=pg_catalog.jsonb_build_object(
    'layers',v_layer_names,'schemas',v_schema_fingerprint,
    'table',pg_catalog.jsonb_build_object(
      'name',v_table.name,'columns',v_table.columns_json,
      'rows',v_table.rows_json,'version',v_table.version
    )
  );
  v_structure_sha:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_structure::text,'UTF8'),'sha256'
  ),'hex');
  v_request_sha:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'organizationId',p_organization_id,'versionId',p_version_id,
      'projectId',p_project_id,'documentId',p_document_id,
      'revisionId',p_revision_id,'structureFingerprint',v_structure_sha
    )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor::text||':'||p_client_request_id::text,0
  ));
  select * into v_existing from public.lukas_drawing_library_imports i
  where i.imported_by=v_actor and i.client_request_id=p_client_request_id
  for update;
  if found then
    if v_existing.request_sha256 is distinct from v_request_sha
      or v_existing.organization_id<>p_organization_id
      or v_existing.version_id<>p_version_id
      or v_existing.project_id<>p_project_id
      or v_existing.target_document_id is distinct from p_document_id
      or v_existing.target_revision_id is distinct from p_revision_id then
      raise exception using errcode='P1C01',
        message='Request ID does not match the stored platform starter import';
    end if;
    return pg_catalog.jsonb_build_object(
      'importId',v_existing.id,'documentId',v_existing.target_document_id,
      'revisionId',v_existing.target_revision_id,
      'contentSha256',v_existing.source_content_sha256,
      'structureFingerprint',v_structure_sha
    );
  end if;
  insert into public.lukas_drawing_library_imports(
    organization_id,registry_id,version_id,project_id,revision_id,
    target_entity_id,target_document_id,target_revision_id,
    source_content_sha256,imported_by,client_request_id,request_sha256
  ) values(
    v_version.organization_id,v_version.registry_id,v_version.id,p_project_id,
    null,null,p_document_id,p_revision_id,v_version.content_sha256,v_actor,
    p_client_request_id,v_request_sha
  ) returning id into v_import_id;
  return pg_catalog.jsonb_build_object(
    'importId',v_import_id,'documentId',p_document_id,
    'revisionId',p_revision_id,'contentSha256',v_version.content_sha256,
    'structureFingerprint',v_structure_sha
  );
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01'
    or serialization_failure or deadlock_detected then raise;
  when unique_violation or foreign_key_violation or check_violation
    or not_null_violation or invalid_text_representation then
    raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

create function public.lukas_drawing_record_platform_starter_import(
  p_organization_id uuid,p_version_id uuid,p_project_id uuid,
  p_document_id uuid,p_revision_id uuid,p_client_request_id uuid
) returns jsonb language sql security invoker set search_path='' as $$
  select private.lukas_drawing_record_platform_starter_import(
    p_organization_id,p_version_id,p_project_id,p_document_id,p_revision_id,
    p_client_request_id
  )
$$;

create or replace function public.lukas_drawing_publish_library_version(
  p_organization_id uuid,p_version_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_version public.lukas_drawing_library_versions%rowtype;
  v_payload jsonb;
  v_sha text;
begin
  select * into v_version from public.lukas_drawing_library_versions v
  where v.id=p_version_id and v.organization_id=p_organization_id for update;
  if not found or v_actor is null
    or not private.lukas_drawing_library_manager(v_version.organization_id)
    or v_version.status<>'draft' then
    raise exception using errcode='P1R01',
      message='Drawing library version is unavailable';
  end if;
  if v_version.source_kind='platform_starter' then
    raise exception using errcode='P1C01',
      message='Platform starter versions have an immutable lifecycle';
  end if;
  v_payload:=private.lukas_drawing_library_payload(
    (select e.kind from public.lukas_drawing_library_entries e
      where e.id=v_version.registry_id),
    v_version.source_revision_id,v_version.source_entity_id
  );
  v_sha:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_payload::text,'UTF8'),'sha256'
  ),'hex');
  if v_payload is distinct from v_version.canonical_payload
    or v_sha is distinct from v_version.content_sha256 then
    raise exception using errcode='P1R01',message='Drawing library source changed';
  end if;
  update public.lukas_drawing_library_versions set
    status='published',published_by=v_actor,published_at=pg_catalog.now()
  where id=v_version.id;
  return pg_catalog.jsonb_build_object(
    'versionId',v_version.id,'status','published',
    'contentSha256',v_version.content_sha256
  );
end;
$$;

create or replace function public.lukas_drawing_deprecate_library_version(
  p_organization_id uuid,p_version_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_version public.lukas_drawing_library_versions%rowtype;
begin
  select * into v_version from public.lukas_drawing_library_versions v
  where v.id=p_version_id and v.organization_id=p_organization_id for update;
  if not found or v_actor is null
    or not private.lukas_drawing_library_manager(v_version.organization_id)
    or v_version.status<>'published' then
    raise exception using errcode='P1R01',
      message='Drawing library version is unavailable';
  end if;
  if v_version.source_kind='platform_starter' then
    raise exception using errcode='P1C01',
      message='Platform starter versions have an immutable lifecycle';
  end if;
  update public.lukas_drawing_library_versions set
    status='deprecated',deprecated_at=pg_catalog.now()
  where id=v_version.id;
  return pg_catalog.jsonb_build_object(
    'versionId',v_version.id,'status','deprecated'
  );
end;
$$;

create or replace function public.lukas_drawing_import_library_version(
  p_organization_id uuid,p_version_id uuid,p_project_id uuid,p_revision_id uuid,
  p_client_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_source_kind text;
begin
  if not private.lukas_qto_organization_library_access(p_organization_id)
    or not private.lukas_qto_project_feature_active(
      p_project_id,'organization_library'
    ) then
    raise exception using errcode='P7A07',
      message='Organization library entitlement is unavailable';
  end if;
  select v.source_kind into v_source_kind
  from public.lukas_drawing_library_versions v
  where v.id=p_version_id and v.organization_id=p_organization_id;
  if v_source_kind='platform_starter' then
    raise exception using errcode='P1C01',
      message='Platform starter versions use the workspace start flow';
  end if;
  return public.lukas_drawing_import_library_version_pre_entitlement(
    p_organization_id,p_version_id,p_project_id,p_revision_id,p_client_request_id
  );
end;
$$;

create table public.lukas_drawing_estimate_bindings (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null
    references public.lukas_qto_projects(id) on delete cascade,
  drawing_revision_id uuid not null,
  boq_version_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  unique(id,project_id),
  unique(drawing_revision_id),
  unique(boq_version_id),
  foreign key(drawing_revision_id,project_id)
    references public.lukas_drawing_revisions(id,project_id) on delete cascade,
  foreign key(boq_version_id,project_id)
    references public.lukas_qto_boq_versions(id,project_id) on delete cascade
);

create index lukas_drawing_estimate_bindings_project_created_idx
  on public.lukas_drawing_estimate_bindings(project_id,created_at desc,id);

create or replace function private.lukas_drawing_estimate_binding_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE'
    and pg_catalog.current_setting(
      'app.lukas_retention_purge_project',true
    )=old.project_id::text
    and current_user=pg_catalog.pg_get_userbyid(
      (select c.relowner from pg_catalog.pg_class c where c.oid=tg_relid)
    ) then
    return old;
  end if;
  raise exception using errcode='P1C01',
    message='Drawing estimate bindings are append-only';
end;
$$;

create trigger lukas_drawing_estimate_binding_guard
before update or delete on public.lukas_drawing_estimate_bindings
for each row execute function private.lukas_drawing_estimate_binding_guard();

alter table public.lukas_drawing_estimate_bindings enable row level security;

create policy "project members read drawing estimate bindings"
on public.lukas_drawing_estimate_bindings for select to authenticated
using(private.lukas_drawing_workspace_capability(project_id) is not null);

create policy "project editors create drawing estimate bindings"
on public.lukas_drawing_estimate_bindings for insert to authenticated
with check(
  created_by=(select auth.uid())
  and private.lukas_drawing_workspace_capability(project_id) in('admin','editor')
  and exists(
    select 1 from public.lukas_drawing_revisions r
    where r.id=drawing_revision_id and r.project_id=project_id
      and r.status='draft'
  )
  and exists(
    select 1 from public.lukas_qto_boq_versions b
    where b.id=boq_version_id and b.project_id=project_id and b.status='draft'
  )
);

create policy "verified sessions use drawing estimate bindings"
on public.lukas_drawing_estimate_bindings as restrictive for all to authenticated
using(private.lukas_qto_verified_session())
with check(private.lukas_qto_verified_session());

create policy "M1 drawing and quantity entitlement"
on public.lukas_drawing_estimate_bindings as restrictive for all to authenticated
using(
  private.lukas_qto_project_feature_active(project_id,'drawing_workspace')
  and private.lukas_qto_project_feature_active(project_id,'quantity_lineage')
)
with check(
  private.lukas_qto_project_feature_active(project_id,'drawing_workspace')
  and private.lukas_qto_project_feature_active(project_id,'quantity_lineage')
);

revoke all on public.lukas_drawing_estimate_bindings
  from public,anon,authenticated,service_role;
grant select,insert on public.lukas_drawing_estimate_bindings
  to authenticated;
grant select on public.lukas_drawing_estimate_bindings
  to service_role;

revoke all on table private.lukas_drawing_platform_starters
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_document_creation_result(uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_create_document_idempotent(
  uuid,uuid,text,boolean,uuid,uuid
) from public,anon,authenticated,service_role;
grant execute on function private.lukas_drawing_create_document_idempotent(
  uuid,uuid,text,boolean,uuid,uuid
) to authenticated,service_role;
revoke all on function private.lukas_drawing_list_platform_starters(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.lukas_drawing_list_platform_starters(uuid,uuid)
  to authenticated,service_role;
revoke all on function private.lukas_drawing_ensure_platform_starter_version(
  uuid,uuid,text,bigint
) from public,anon,authenticated,service_role;
grant execute on function private.lukas_drawing_ensure_platform_starter_version(
  uuid,uuid,text,bigint
) to authenticated,service_role;
revoke all on function private.lukas_drawing_record_platform_starter_import(
  uuid,uuid,uuid,uuid,uuid,uuid
) from public,anon,authenticated,service_role;
grant execute on function private.lukas_drawing_record_platform_starter_import(
  uuid,uuid,uuid,uuid,uuid,uuid
) to authenticated,service_role;
revoke all on function private.lukas_drawing_estimate_binding_guard()
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_platform_starter_guard()
  from public,anon,authenticated,service_role;

revoke all on function public.lukas_drawing_create_document_idempotent(
  uuid,uuid,text,boolean,uuid,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.lukas_drawing_create_document_idempotent(
  uuid,uuid,text,boolean,uuid,uuid
) to authenticated,service_role;
revoke all on function public.lukas_drawing_list_platform_starters(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.lukas_drawing_list_platform_starters(uuid,uuid)
  to authenticated,service_role;
revoke all on function public.lukas_drawing_ensure_platform_starter_version(
  uuid,uuid,text,bigint
) from public,anon,authenticated,service_role;
grant execute on function public.lukas_drawing_ensure_platform_starter_version(
  uuid,uuid,text,bigint
) to authenticated,service_role;
revoke all on function public.lukas_drawing_record_platform_starter_import(
  uuid,uuid,uuid,uuid,uuid,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.lukas_drawing_record_platform_starter_import(
  uuid,uuid,uuid,uuid,uuid,uuid
) to authenticated,service_role;

commit;
