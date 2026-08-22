-- Bind automatically generated material plans to a human-approved concrete
-- takeoff artifact. Manual plans remain supported with both fields null.

alter table public.lukas_qto_material_plans
  add column source_artifact_id uuid,
  add column source_group_key text;

alter table public.lukas_qto_material_plans
  add constraint lukas_qto_material_plans_source_artifact_pair_check
  check ((source_artifact_id is null) = (source_group_key is null)),
  add constraint lukas_qto_material_plans_source_artifact_fkey
  foreign key (source_artifact_id, project_id)
  references public.lukas_qto_takeoff_artifacts(id, project_id) on delete restrict,
  add constraint lukas_qto_material_plans_source_group_key_check
  check (source_group_key is null or char_length(trim(source_group_key)) between 1 and 200);

create unique index lukas_qto_material_plans_artifact_group_key
  on public.lukas_qto_material_plans(project_id, source_artifact_id, source_group_key)
  where source_artifact_id is not null;
create index lukas_qto_material_plans_source_artifact_idx
  on public.lukas_qto_material_plans(source_artifact_id, project_id);

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
    order by created_at desc, id desc
    limit 1;
  if latest_decision is distinct from 'approved' then
    raise exception 'The latest takeoff decision must be approved';
  end if;
  return new;
end;
$$;

create trigger lukas_qto_material_plans_validate_artifact
before insert on public.lukas_qto_material_plans
for each row execute function public.lukas_qto_validate_material_plan_artifact();
