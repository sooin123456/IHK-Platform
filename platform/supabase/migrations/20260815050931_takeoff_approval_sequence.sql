-- UUIDs are not chronological. Preserve an explicit append order so a later
-- approval/rejection can never be mistaken for an earlier decision when
-- timestamps tie inside a transaction.

alter table public.lukas_qto_takeoff_approvals
  add column decision_sequence bigint generated always as identity;

create unique index lukas_qto_takeoff_approvals_sequence_key
  on public.lukas_qto_takeoff_approvals(artifact_id, decision_sequence);

create or replace function public.lukas_qto_validate_material_plan_artifact()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  artifact_report_file_id uuid;
  artifact_report_sha256 text;
  latest_decision text;
begin
  if new.source_artifact_id is null then
    return new;
  end if;

  select report_file_id, report_sha256
    into artifact_report_file_id, artifact_report_sha256
    from public.lukas_qto_takeoff_artifacts
    where id = new.source_artifact_id and project_id = new.project_id;
  if artifact_report_file_id is null then
    raise exception 'The material plan takeoff artifact does not belong to the project';
  end if;
  if new.source_file_id is distinct from artifact_report_file_id
     or new.source_sha256 is distinct from artifact_report_sha256 then
    raise exception 'The material plan source must be the approved takeoff report';
  end if;

  select decision into latest_decision
    from public.lukas_qto_takeoff_approvals
    where artifact_id = new.source_artifact_id
    order by decision_sequence desc
    limit 1;
  if latest_decision is distinct from 'approved' then
    raise exception 'The latest takeoff decision must be approved';
  end if;
  return new;
end;
$$;
