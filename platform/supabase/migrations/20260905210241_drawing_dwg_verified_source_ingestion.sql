-- First-class immutable DWG originals carry only verified header evidence.
alter table public.lukas_qto_files
  drop constraint if exists lukas_qto_files_kind_check;
alter table public.lukas_qto_files
  add constraint lukas_qto_files_kind_check check (
    kind in (
      'ifc','pdf','dxf','dwg','qto_csv','element_ledger','formwork_ledger',
      'estimate','mapping','other'
    )
  );

alter table public.lukas_qto_verified_uploads
  add column dwg_header_version text;
alter table public.lukas_qto_verified_uploads
  drop constraint if exists lukas_qto_verified_uploads_kind_check;
alter table public.lukas_qto_verified_uploads
  add constraint lukas_qto_verified_uploads_kind_check check (
    kind in (
      'ifc','pdf','dxf','dwg','qto_csv','element_ledger','formwork_ledger',
      'estimate','mapping','other'
    )
  ),
  add constraint lukas_qto_verified_uploads_dwg_header_version_check check (
    (
      kind = 'dwg'
      and dwg_header_version is not null
      and dwg_header_version ~ '^AC[0-9]{4}$'
    )
    or (kind <> 'dwg' and dwg_header_version is null)
  );

create or replace function public.lukas_qto_finalize_verified_upload(
  p_verification_id uuid,
  p_actor_id uuid,
  p_project_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.lukas_qto_verified_uploads%rowtype;
  v_file public.lukas_qto_files%rowtype;
  v_previous public.lukas_qto_files%rowtype;
  v_owner_id uuid;
begin
  if coalesce((select auth.jwt()->>'role'),'') <> 'service_role' then
    raise exception using
      errcode = 'P8U01',
      message = 'Verified upload finalization requires service authority';
  end if;
  if p_verification_id is null or p_actor_id is null or p_project_id is null then
    raise exception using
      errcode = 'P8U02',
      message = 'Verified upload finalization identity is invalid';
  end if;

  select upload.* into v_upload
  from public.lukas_qto_verified_uploads upload
  where upload.id = p_verification_id
  for update;
  if not found then
    raise exception using
      errcode = 'P8U02',
      message = 'Verified upload was not found';
  end if;
  if v_upload.actor_id <> p_actor_id or v_upload.project_id <> p_project_id then
    raise exception using
      errcode = 'P8U02',
      message = 'Verified upload does not match this project';
  end if;

  select project.owner_id into v_owner_id
  from public.lukas_qto_projects project
  join auth.users actor on actor.id = v_upload.actor_id
  where project.id = v_upload.project_id
    and coalesce(actor.is_anonymous,false) = false
    and nullif(pg_catalog.to_jsonb(actor)->>'deleted_at','') is null
    and (
      nullif(pg_catalog.to_jsonb(actor)->>'banned_until','') is null
      or (pg_catalog.to_jsonb(actor)->>'banned_until')::timestamptz
        <= pg_catalog.clock_timestamp()
    )
    and (
      project.owner_id = v_upload.actor_id
      or exists (
        select 1 from public.lukas_qto_project_members member
        where member.project_id = v_upload.project_id
          and member.user_id = v_upload.actor_id
          and member.role in ('owner','estimator')
      )
      or actor.raw_app_meta_data->>'role' = 'hangil_staff'
    );
  if not found then
    raise exception using
      errcode = 'P8U04',
      message = 'Verified upload project authority was revoked';
  end if;

  if v_upload.consumed_file_id is not null then
    select file.* into strict v_file
    from public.lukas_qto_files file
    where file.id = v_upload.consumed_file_id;
    select previous.* into v_previous
    from public.lukas_qto_file_revisions revision
    join public.lukas_qto_files previous
      on previous.id = revision.previous_file_id
    where revision.current_file_id = v_file.id;
    return pg_catalog.jsonb_build_object(
      'fileId',v_file.id,
      'kind',v_file.kind,
      'storagePath',v_file.storage_path,
      'originalFilename',v_file.original_filename,
      'contentType',coalesce(v_file.content_type,''),
      'byteSize',v_file.byte_size,
      'sha256',v_file.sha256,
      'dwgHeaderVersion',v_upload.dwg_header_version,
      'previousFileId',v_previous.id,
      'previousStoragePath',v_previous.storage_path,
      'previousByteSize',v_previous.byte_size,
      'previousSha256',v_previous.sha256
    );
  end if;
  if v_upload.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using
      errcode = 'P8U03',
      message = 'Verified upload has expired';
  end if;

  if pg_catalog.split_part(v_upload.storage_path,'/',1) <> v_owner_id::text
    or pg_catalog.split_part(v_upload.storage_path,'/',2) <> v_upload.project_id::text
    or pg_catalog.split_part(v_upload.storage_path,'/',3) <> 'source-uploads'
    or pg_catalog.split_part(v_upload.storage_path,'/',4) = ''
    or pg_catalog.split_part(v_upload.storage_path,'/',5) <> '' then
    raise exception using
      errcode = 'P8U05',
      message = 'Verified upload storage path is invalid';
  end if;

  if v_upload.kind not in ('other','dwg') then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_upload.project_id::text||':'||v_upload.kind,0)
    );
    select file.* into v_previous
    from public.lukas_qto_files file
    where file.project_id = v_upload.project_id and file.kind = v_upload.kind
    order by file.created_at desc,file.id desc
    limit 1;
    if v_previous.sha256 = v_upload.sha256 then
      raise exception using
        errcode = 'P8U06',
        message = 'The latest revision already has the same content';
    end if;
  end if;

  insert into public.lukas_qto_files(
    project_id,uploaded_by,kind,storage_path,original_filename,
    content_type,byte_size,sha256,immutable
  ) values(
    v_upload.project_id,v_upload.actor_id,v_upload.kind,v_upload.storage_path,
    v_upload.original_filename,nullif(v_upload.content_type,''),v_upload.byte_size,
    v_upload.sha256,true
  ) returning * into v_file;

  if v_previous.id is not null then
    insert into public.lukas_qto_file_revisions(
      project_id,previous_file_id,previous_sha256,current_file_id,
      current_sha256,relation_kind,created_by
    ) values(
      v_upload.project_id,v_previous.id,v_previous.sha256,v_file.id,
      v_file.sha256,'supersedes',v_upload.actor_id
    );
  end if;

  update public.lukas_qto_verified_uploads
  set consumed_file_id = v_file.id,consumed_at = pg_catalog.clock_timestamp()
  where id = v_upload.id;

  return pg_catalog.jsonb_build_object(
    'fileId',v_file.id,
    'kind',v_file.kind,
    'storagePath',v_file.storage_path,
    'originalFilename',v_file.original_filename,
    'contentType',coalesce(v_file.content_type,''),
    'byteSize',v_file.byte_size,
    'sha256',v_file.sha256,
    'dwgHeaderVersion',v_upload.dwg_header_version,
    'previousFileId',v_previous.id,
    'previousStoragePath',v_previous.storage_path,
    'previousByteSize',v_previous.byte_size,
    'previousSha256',v_previous.sha256
  );
end;
$$;

revoke all on function public.lukas_qto_finalize_verified_upload(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.lukas_qto_finalize_verified_upload(uuid,uuid,uuid)
  to service_role;
