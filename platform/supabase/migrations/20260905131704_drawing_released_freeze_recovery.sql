begin;

-- Preserve released request identity after lease deletion. A newer preparation
-- lease still owns the projected freezing state and must keep request priority.
create or replace function private.lukas_drawing_collaboration_read_freeze(
  p_project_id uuid,p_revision_id uuid
) returns table(
  freeze_state text,freeze_request_id uuid,revision_status text,
  revision_version bigint,accepted_manifest_sha256 text,
  accepted_operation_count integer,frozen_base_operation_sequence bigint,
  frozen_subject_revision_version bigint,frozen_yjs_state_vector text,
  frozen_operation_statuses jsonb,review_committed boolean,
  freeze_owner_token uuid,freeze_owner_request_id uuid,
  freeze_owner_lease_expires_at timestamptz
) language sql stable security definer set search_path='' as $$
  select case when s.freeze_state in ('freezing','frozen') then s.freeze_state
      when l.revision_id is not null then 'freezing'
      else coalesce(s.freeze_state,'active') end,
    case when s.freeze_state in ('freezing','frozen') then s.freeze_request_id
      else coalesce(l.request_id,s.freeze_request_id) end,r.status,r.version,
    s.accepted_manifest_sha256,s.accepted_operation_count,
    s.frozen_base_operation_sequence,
    coalesce(s.frozen_subject_revision_version,l.subject_revision_version),
    s.frozen_yjs_state_vector,s.frozen_operation_statuses,
    s.review_committed_at is not null,l.owner_token,
    l.request_id,l.lease_expires_at
  from public.lukas_drawing_revisions r
  left join private.lukas_drawing_collaboration_states s
    on s.revision_id=r.id and s.project_id=r.project_id
  left join private.lukas_drawing_collaboration_freeze_leases l
    on l.revision_id=r.id and l.project_id=r.project_id
  where r.id=p_revision_id and r.project_id=p_project_id
$$;

commit;
