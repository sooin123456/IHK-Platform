-- Verified BOQ V1: immutable source quantities, customer-owned price books,
-- deterministic direct-cost calculation and maker-checker approval.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.lukas_qto_files'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (id, project_id, sha256)'
  ) then
    alter table public.lukas_qto_files
      add constraint lukas_qto_files_boq_source_identity_key
      unique (id, project_id, sha256);
  end if;
end;
$$;

create table public.lukas_qto_price_books (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  version_label text not null check (char_length(trim(version_label)) between 1 and 80),
  effective_date date not null,
  currency text not null default 'KRW' check (currency = 'KRW'),
  rights_basis text not null check (rights_basis in ('customer_owned','licensed','public_authorized')),
  license_note text not null check (char_length(trim(license_note)) between 1 and 1000),
  source_file_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, project_id),
  unique (project_id, name, version_label),
  constraint lukas_qto_price_books_source_identity_fkey
    foreign key (source_file_id, project_id, source_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict
);

create table public.lukas_qto_price_resources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  price_book_id uuid not null,
  resource_code text not null check (char_length(trim(resource_code)) between 1 and 80),
  resource_type text not null check (resource_type in ('material','labor','equipment','expense')),
  resource_name text not null check (char_length(trim(resource_name)) between 1 and 160),
  specification text not null default '' check (char_length(specification) <= 200),
  unit text not null check (unit in ('EA','m','m2','m3','kg','t','day','hr')),
  unit_price_krw numeric(29,6) not null check (unit_price_krw >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, project_id),
  unique (price_book_id, resource_code),
  constraint lukas_qto_price_resources_book_fkey
    foreign key (price_book_id, project_id)
    references public.lukas_qto_price_books(id, project_id) on delete restrict
);

create table public.lukas_qto_boq_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  version_no integer not null check (version_no > 0),
  title text not null check (char_length(trim(title)) between 1 and 160),
  status text not null default 'draft'
    check (status in ('draft','in_review','approved','superseded')),
  calculation_policy text not null
    check (calculation_policy in ('general_half_away','ems_component_truncate')),
  quantity_scale smallint not null default 6 check (quantity_scale between 0 and 9),
  price_book_id uuid not null,
  supersedes_id uuid,
  engine_version text not null default 'VERIFIED-BOQ-1.0'
    check (engine_version = 'VERIFIED-BOQ-1.0'),
  result_sha256 text check (result_sha256 is null or result_sha256 ~ '^[0-9a-f]{64}$'),
  direct_cost_krw numeric(29,6) check (direct_cost_krw is null or direct_cost_krw >= 0),
  line_count integer check (line_count is null or line_count >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, project_id),
  unique (project_id, version_no),
  constraint lukas_qto_boq_versions_price_book_fkey
    foreign key (price_book_id, project_id)
    references public.lukas_qto_price_books(id, project_id) on delete restrict,
  constraint lukas_qto_boq_versions_supersedes_fkey
    foreign key (supersedes_id, project_id)
    references public.lukas_qto_boq_versions(id, project_id) on delete restrict,
  check (supersedes_id is null or supersedes_id <> id),
  check ((status = 'draft' and submitted_at is null and approved_at is null)
    or (status = 'in_review' and submitted_at is not null and approved_at is null
        and result_sha256 is not null and direct_cost_krw is not null and line_count is not null)
    or (status in ('approved','superseded') and submitted_at is not null and approved_at is not null
        and result_sha256 is not null and direct_cost_krw is not null and line_count is not null))
);

create table public.lukas_qto_boq_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  version_id uuid not null,
  parent_id uuid,
  code text not null check (char_length(trim(code)) between 1 and 80),
  name text not null check (char_length(trim(name)) between 1 and 160),
  sort_order integer not null default 0,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, version_id, project_id),
  unique (version_id, code),
  constraint lukas_qto_boq_sections_version_fkey
    foreign key (version_id, project_id)
    references public.lukas_qto_boq_versions(id, project_id) on delete cascade,
  constraint lukas_qto_boq_sections_parent_fkey
    foreign key (parent_id, version_id, project_id)
    references public.lukas_qto_boq_sections(id, version_id, project_id) on delete restrict,
  check (parent_id is null or parent_id <> id)
);

create table public.lukas_qto_boq_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  version_id uuid not null,
  section_id uuid not null,
  item_code text not null check (char_length(trim(item_code)) between 1 and 80),
  item_name text not null check (char_length(trim(item_name)) between 1 and 200),
  specification text not null default '' check (char_length(specification) <= 240),
  unit text not null check (unit in ('EA','m','m2','m3')),
  signed_adjustment numeric(29,9) not null default 0,
  adjustment_reason text not null default '' check (char_length(adjustment_reason) <= 1000),
  sort_order integer not null default 0,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, version_id, project_id),
  unique (version_id, item_code),
  constraint lukas_qto_boq_lines_version_fkey
    foreign key (version_id, project_id)
    references public.lukas_qto_boq_versions(id, project_id) on delete cascade,
  constraint lukas_qto_boq_lines_section_fkey
    foreign key (section_id, version_id, project_id)
    references public.lukas_qto_boq_sections(id, version_id, project_id) on delete restrict,
  check (signed_adjustment = 0 or char_length(trim(adjustment_reason)) > 0)
);

create table public.lukas_qto_boq_wbs_nodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  version_id uuid not null,
  parent_id uuid,
  code text not null check (char_length(trim(code)) between 1 and 80),
  name text not null check (char_length(trim(name)) between 1 and 160),
  sort_order integer not null default 0,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, version_id, project_id),
  unique (version_id, code),
  constraint lukas_qto_boq_wbs_nodes_version_fkey
    foreign key (version_id, project_id)
    references public.lukas_qto_boq_versions(id, project_id) on delete cascade,
  constraint lukas_qto_boq_wbs_nodes_parent_fkey
    foreign key (parent_id, version_id, project_id)
    references public.lukas_qto_boq_wbs_nodes(id, version_id, project_id) on delete restrict,
  check (parent_id is null or parent_id <> id)
);

create table public.lukas_qto_boq_wbs_allocations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  version_id uuid not null,
  line_id uuid not null,
  wbs_node_id uuid not null,
  allocation_percent numeric(7,4) not null check (allocation_percent > 0 and allocation_percent <= 100),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (line_id, wbs_node_id),
  constraint lukas_qto_boq_wbs_allocations_line_fkey
    foreign key (line_id, version_id, project_id)
    references public.lukas_qto_boq_lines(id, version_id, project_id) on delete cascade,
  constraint lukas_qto_boq_wbs_allocations_node_fkey
    foreign key (wbs_node_id, version_id, project_id)
    references public.lukas_qto_boq_wbs_nodes(id, version_id, project_id) on delete restrict
);

create table public.lukas_qto_boq_quantity_mappings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  version_id uuid not null,
  line_id uuid not null,
  source_file_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_subject_key text not null check (char_length(trim(source_subject_key)) between 1 and 240),
  source_quantity numeric(29,9) not null check (source_quantity >= 0),
  factor numeric(20,9) not null check (factor > 0),
  unit text not null check (unit in ('EA','m','m2','m3')),
  element_ids text[] not null default '{}',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (line_id, source_file_id, source_subject_key),
  constraint lukas_qto_boq_quantity_mappings_line_fkey
    foreign key (line_id, version_id, project_id)
    references public.lukas_qto_boq_lines(id, version_id, project_id) on delete cascade,
  constraint lukas_qto_boq_quantity_mappings_source_fkey
    foreign key (source_file_id, project_id, source_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict,
  check (cardinality(element_ids) <= 100000)
);

create table public.lukas_qto_boq_source_exclusions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  version_id uuid not null,
  source_file_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_subject_key text not null check (char_length(trim(source_subject_key)) between 1 and 240),
  source_quantity numeric(29,9) not null check (source_quantity >= 0),
  unit text not null check (unit in ('EA','m','m2','m3')),
  element_ids text[] not null default '{}',
  reason text not null check (char_length(trim(reason)) between 1 and 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (version_id, source_file_id, source_subject_key, unit),
  constraint lukas_qto_boq_source_exclusions_version_fkey
    foreign key (version_id, project_id)
    references public.lukas_qto_boq_versions(id, project_id) on delete cascade,
  constraint lukas_qto_boq_source_exclusions_source_fkey
    foreign key (source_file_id, project_id, source_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict,
  check (cardinality(element_ids) between 1 and 100000)
);

create table public.lukas_qto_boq_rate_components (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  version_id uuid not null,
  line_id uuid not null,
  resource_id uuid not null,
  coefficient numeric(20,9) not null check (coefficient > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (line_id, resource_id),
  constraint lukas_qto_boq_rate_components_line_fkey
    foreign key (line_id, version_id, project_id)
    references public.lukas_qto_boq_lines(id, version_id, project_id) on delete cascade,
  constraint lukas_qto_boq_rate_components_resource_fkey
    foreign key (resource_id, project_id)
    references public.lukas_qto_price_resources(id, project_id) on delete restrict
);

create table public.lukas_qto_boq_approvals (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.lukas_qto_boq_versions(id) on delete cascade,
  decided_by uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approved','rejected','deferred')),
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now()
);

create index lukas_qto_price_books_project_idx on public.lukas_qto_price_books(project_id, created_at desc);
create index lukas_qto_price_resources_book_idx on public.lukas_qto_price_resources(price_book_id, resource_type, resource_code);
create index lukas_qto_boq_versions_project_idx on public.lukas_qto_boq_versions(project_id, version_no desc);
create index lukas_qto_boq_sections_version_idx on public.lukas_qto_boq_sections(version_id, sort_order, code);
create index lukas_qto_boq_lines_version_idx on public.lukas_qto_boq_lines(version_id, sort_order, item_code);
create index lukas_qto_boq_wbs_nodes_version_idx on public.lukas_qto_boq_wbs_nodes(version_id, sort_order, code);
create index lukas_qto_boq_wbs_allocations_version_idx on public.lukas_qto_boq_wbs_allocations(version_id, line_id);
create index lukas_qto_boq_mappings_version_idx on public.lukas_qto_boq_quantity_mappings(version_id, line_id);
create index lukas_qto_boq_exclusions_version_idx on public.lukas_qto_boq_source_exclusions(version_id, source_file_id);
create index lukas_qto_boq_components_version_idx on public.lukas_qto_boq_rate_components(version_id, line_id);
create index lukas_qto_boq_approvals_version_idx on public.lukas_qto_boq_approvals(version_id, created_at desc);

create or replace function public.lukas_qto_guard_boq_draft_child()
returns trigger language plpgsql security invoker set search_path=public as $$
declare target_version uuid; target_project uuid; current_status text; maker uuid;
begin
  if tg_op='DELETE' then
    target_version := old.version_id;
    target_project := old.project_id;
  else
    target_version := new.version_id;
    target_project := new.project_id;
  end if;
  select status,created_by into current_status,maker from public.lukas_qto_boq_versions
    where id=target_version and project_id=target_project;
  if current_status is distinct from 'draft' then
    raise exception 'Only a draft BOQ version can be edited';
  end if;
  if maker is distinct from (select auth.uid()) then
    raise exception 'Only the BOQ maker can edit draft rows';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create trigger lukas_qto_boq_sections_draft_guard before insert or update or delete
on public.lukas_qto_boq_sections for each row execute function public.lukas_qto_guard_boq_draft_child();
create trigger lukas_qto_boq_lines_draft_guard before insert or update or delete
on public.lukas_qto_boq_lines for each row execute function public.lukas_qto_guard_boq_draft_child();
create trigger lukas_qto_boq_wbs_nodes_draft_guard before insert or update or delete
on public.lukas_qto_boq_wbs_nodes for each row execute function public.lukas_qto_guard_boq_draft_child();
create trigger lukas_qto_boq_wbs_allocations_draft_guard before insert or update or delete
on public.lukas_qto_boq_wbs_allocations for each row execute function public.lukas_qto_guard_boq_draft_child();
create trigger lukas_qto_boq_mappings_draft_guard before insert or update or delete
on public.lukas_qto_boq_quantity_mappings for each row execute function public.lukas_qto_guard_boq_draft_child();
create trigger lukas_qto_boq_exclusions_draft_guard before insert or update or delete
on public.lukas_qto_boq_source_exclusions for each row execute function public.lukas_qto_guard_boq_draft_child();
create trigger lukas_qto_boq_components_draft_guard before insert or update or delete
on public.lukas_qto_boq_rate_components for each row execute function public.lukas_qto_guard_boq_draft_child();

create or replace function public.lukas_qto_guard_boq_source_decision()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if tg_table_name='lukas_qto_boq_quantity_mappings' then
    if exists(
      select 1 from public.lukas_qto_boq_source_exclusions exclusion
      where exclusion.version_id=new.version_id
        and exclusion.source_file_id=new.source_file_id
        and exclusion.source_subject_key=new.source_subject_key
        and exclusion.unit=new.unit
    ) then
      raise exception 'A source quantity cannot be both mapped and excluded';
    end if;
  elsif exists(
    select 1 from public.lukas_qto_boq_quantity_mappings mapping
    where mapping.version_id=new.version_id
      and mapping.source_file_id=new.source_file_id
      and mapping.source_subject_key=new.source_subject_key
      and mapping.unit=new.unit
  ) then
    raise exception 'A source quantity cannot be both mapped and excluded';
  end if;
  return new;
end;
$$;
create trigger lukas_qto_boq_mapping_source_decision_guard before insert or update
on public.lukas_qto_boq_quantity_mappings for each row execute function public.lukas_qto_guard_boq_source_decision();
create trigger lukas_qto_boq_exclusion_source_decision_guard before insert or update
on public.lukas_qto_boq_source_exclusions for each row execute function public.lukas_qto_guard_boq_source_decision();

create or replace function public.lukas_qto_guard_boq_section_tree()
returns trigger language plpgsql security invoker set search_path=public as $$
declare has_cycle boolean; max_depth integer;
begin
  if new.parent_id is null then return new; end if;
  with recursive ancestors(id,parent_id,depth) as (
    select node.id,node.parent_id,1 from public.lukas_qto_boq_sections node where node.id=new.parent_id
    union all
    select node.id,node.parent_id,ancestors.depth+1 from public.lukas_qto_boq_sections node
      join ancestors on node.id=ancestors.parent_id where ancestors.depth<13
  )
  select bool_or(id=new.id),max(depth) into has_cycle,max_depth from ancestors;
  if coalesce(has_cycle,false) then raise exception 'CBS hierarchy cannot contain a cycle'; end if;
  if coalesce(max_depth,0)>=12 then raise exception 'CBS hierarchy is limited to 12 levels'; end if;
  return new;
end;
$$;
create trigger lukas_qto_boq_sections_tree_guard before insert or update of parent_id
on public.lukas_qto_boq_sections for each row execute function public.lukas_qto_guard_boq_section_tree();

create or replace function public.lukas_qto_guard_boq_wbs_tree()
returns trigger language plpgsql security invoker set search_path=public as $$
declare has_cycle boolean; max_depth integer;
begin
  if new.parent_id is null then return new; end if;
  with recursive ancestors(id,parent_id,depth) as (
    select node.id,node.parent_id,1 from public.lukas_qto_boq_wbs_nodes node where node.id=new.parent_id
    union all
    select node.id,node.parent_id,ancestors.depth+1 from public.lukas_qto_boq_wbs_nodes node
      join ancestors on node.id=ancestors.parent_id where ancestors.depth<13
  )
  select bool_or(id=new.id),max(depth) into has_cycle,max_depth from ancestors;
  if coalesce(has_cycle,false) then raise exception 'WBS hierarchy cannot contain a cycle'; end if;
  if coalesce(max_depth,0)>=12 then raise exception 'WBS hierarchy is limited to 12 levels'; end if;
  return new;
end;
$$;
create trigger lukas_qto_boq_wbs_nodes_tree_guard before insert or update of parent_id
on public.lukas_qto_boq_wbs_nodes for each row execute function public.lukas_qto_guard_boq_wbs_tree();

create or replace function public.lukas_qto_guard_boq_version_transition()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.id is distinct from old.id or new.project_id is distinct from old.project_id
     or new.version_no is distinct from old.version_no or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'BOQ version identity is immutable';
  end if;
  if old.status='superseded' then
    raise exception 'A superseded BOQ version is immutable';
  end if;
  if old.status='approved' then
    if new.status='superseded' and exists(
      select 1 from public.lukas_qto_boq_versions successor
      where successor.supersedes_id=old.id and successor.status='approved'
    ) then
      return new;
    end if;
    raise exception 'An approved BOQ version is immutable except when superseded by an approved successor';
  end if;
  if new.status = old.status then
    if old.status <> 'draft' then
      raise exception 'A submitted BOQ version cannot be edited';
    end if;
    if old.created_by is distinct from (select auth.uid()) then
      raise exception 'Only the BOQ maker can edit a draft version';
    end if;
    return new;
  end if;
  if old.status='draft' and new.status='in_review' then
    if old.created_by is distinct from (select auth.uid()) then
      raise exception 'Only the BOQ maker can submit a draft version';
    end if;
    if exists(
      select 1 from public.lukas_qto_boq_lines line
      where line.version_id=old.id and exists(
        select 1 from public.lukas_qto_boq_sections child where child.parent_id=line.section_id
      )
    ) then
      raise exception 'Every BOQ line must belong to a CBS leaf node';
    end if;
    if exists(select 1 from public.lukas_qto_boq_wbs_nodes where version_id=old.id)
       and exists(
         select 1 from public.lukas_qto_boq_lines line
         left join public.lukas_qto_boq_wbs_allocations allocation on allocation.line_id=line.id
         where line.version_id=old.id
         group by line.id having coalesce(sum(allocation.allocation_percent),0)<>100
       ) then
      raise exception 'Every BOQ line must have exactly 100 percent WBS allocation';
    end if;
    if exists(
      select 1 from public.lukas_qto_boq_wbs_allocations allocation
      where allocation.version_id=old.id and exists(
        select 1 from public.lukas_qto_boq_wbs_nodes child where child.parent_id=allocation.wbs_node_id
      )
    ) then
      raise exception 'Every WBS allocation must target a leaf node';
    end if;
    new.submitted_at := coalesce(new.submitted_at,now());
    new.approved_at := null;
  elsif old.status='in_review' and new.status='draft' then
    if not exists(select 1 from public.lukas_qto_boq_approvals a
      where a.version_id=old.id and a.decision='rejected') then
      raise exception 'A rejected review is required before returning to draft';
    end if;
    new.submitted_at := null;
    new.approved_at := null;
  elsif old.status='in_review' and new.status='approved' then
    if not exists(select 1 from public.lukas_qto_boq_approvals a
      where a.version_id=old.id and a.decision='approved'
        and a.decided_by=(select auth.uid()) and a.decided_by<>old.created_by) then
      raise exception 'An independent approval by the current reviewer is required';
    end if;
    new.approved_at := coalesce(new.approved_at,now());
  else
    raise exception 'Unsupported BOQ status transition';
  end if;
  return new;
end;
$$;
create trigger lukas_qto_boq_versions_transition_guard before update
on public.lukas_qto_boq_versions for each row execute function public.lukas_qto_guard_boq_version_transition();

create or replace function public.lukas_qto_guard_boq_approval()
returns trigger language plpgsql security invoker set search_path=public as $$
declare maker uuid; current_status text;
begin
  select created_by,status into maker,current_status from public.lukas_qto_boq_versions where id=new.version_id;
  if maker is null or current_status is distinct from 'in_review' then
    raise exception 'Only an in-review BOQ version can receive a decision';
  end if;
  if new.decided_by is distinct from (select auth.uid()) or new.decided_by=maker then
    raise exception 'The BOQ maker cannot approve their own version';
  end if;
  return new;
end;
$$;
create trigger lukas_qto_boq_approvals_guard before insert
on public.lukas_qto_boq_approvals for each row execute function public.lukas_qto_guard_boq_approval();

create or replace function public.lukas_qto_decide_boq(
  p_version_id uuid,
  p_decision text,
  p_note text default ''
) returns void language plpgsql security invoker set search_path=public as $$
begin
  if p_decision not in ('approved','rejected','deferred') then
    raise exception 'Unsupported BOQ decision';
  end if;
  insert into public.lukas_qto_boq_approvals(version_id,decided_by,decision,note)
  values(p_version_id,(select auth.uid()),p_decision,coalesce(p_note,''));
  if p_decision='approved' then
    update public.lukas_qto_boq_versions set status='approved' where id=p_version_id;
    update public.lukas_qto_boq_versions predecessor set status='superseded'
      where predecessor.id=(select successor.supersedes_id from public.lukas_qto_boq_versions successor where successor.id=p_version_id)
        and predecessor.status='approved';
  elsif p_decision='rejected' then
    update public.lukas_qto_boq_versions set status='draft' where id=p_version_id;
  end if;
end;
$$;
revoke all on function public.lukas_qto_decide_boq(uuid,text,text) from public;
grant execute on function public.lukas_qto_decide_boq(uuid,text,text) to authenticated,service_role;

create or replace function public.lukas_qto_import_boq_structure(
  p_version_id uuid,
  p_payload jsonb
) returns void language plpgsql security invoker set search_path=public as $$
declare
  target_project uuid;
  maker uuid;
  current_status text;
  pass_number integer;
  inserted_count integer;
  expected_count integer;
begin
  select project_id,created_by,status into target_project,maker,current_status
    from public.lukas_qto_boq_versions where id=p_version_id;
  if target_project is null or maker is distinct from (select auth.uid()) or current_status is distinct from 'draft' then
    raise exception 'Only the BOQ maker can import into a draft version';
  end if;
  if jsonb_typeof(p_payload->'sections') is distinct from 'array'
     or jsonb_typeof(p_payload->'wbsNodes') is distinct from 'array'
     or jsonb_typeof(p_payload->'items') is distinct from 'array' then
    raise exception 'Invalid BOQ structure payload';
  end if;
  if jsonb_array_length(p_payload->'sections')>500
     or jsonb_array_length(p_payload->'wbsNodes')>5000
     or jsonb_array_length(p_payload->'items')>100000 then
    raise exception 'BOQ structure payload exceeds the supported limit';
  end if;
  if exists(select 1 from public.lukas_qto_boq_sections where version_id=p_version_id)
     or exists(select 1 from public.lukas_qto_boq_wbs_nodes where version_id=p_version_id)
     or exists(select 1 from public.lukas_qto_boq_lines where version_id=p_version_id) then
    raise exception 'BOQ structure import requires an empty draft version';
  end if;

  insert into public.lukas_qto_boq_sections(project_id,version_id,code,name,sort_order,created_by)
  select target_project,p_version_id,item->>'code',item->>'name',ordinality::integer,(select auth.uid())
  from jsonb_array_elements(p_payload->'sections') with ordinality source(item,ordinality);
  get diagnostics inserted_count=row_count;
  if inserted_count<>jsonb_array_length(p_payload->'sections') or inserted_count=0 then
    raise exception 'Every imported CBS row must be valid';
  end if;

  expected_count := jsonb_array_length(p_payload->'wbsNodes');
  for pass_number in 1..3 loop
    insert into public.lukas_qto_boq_wbs_nodes(project_id,version_id,parent_id,code,name,sort_order,created_by)
    select target_project,p_version_id,parent.id,item->>'code',item->>'name',ordinality::integer,(select auth.uid())
    from jsonb_array_elements(p_payload->'wbsNodes') with ordinality source(item,ordinality)
    left join public.lukas_qto_boq_wbs_nodes parent
      on parent.version_id=p_version_id and parent.code=item->>'parentCode'
    where not exists(
      select 1 from public.lukas_qto_boq_wbs_nodes existing
      where existing.version_id=p_version_id and existing.code=item->>'code'
    ) and (coalesce(item->>'parentCode','')='' or parent.id is not null);
  end loop;
  if (select count(*) from public.lukas_qto_boq_wbs_nodes where version_id=p_version_id)<>expected_count then
    raise exception 'Imported WBS has an orphan, cycle, duplicate, or more than three levels';
  end if;

  insert into public.lukas_qto_boq_lines(
    project_id,version_id,section_id,item_code,item_name,specification,unit,
    signed_adjustment,adjustment_reason,sort_order,created_by
  )
  select target_project,p_version_id,section.id,item->>'code',item->>'name',
    coalesce(item->>'specification',''),item->>'unit',
    coalesce(nullif(item->>'signedAdjustment',''),'0')::numeric,
    coalesce(item->>'adjustmentReason',''),ordinality::integer,(select auth.uid())
  from jsonb_array_elements(p_payload->'items') with ordinality source(item,ordinality)
  join public.lukas_qto_boq_sections section
    on section.version_id=p_version_id and section.code=item->>'cbsCode';
  get diagnostics inserted_count=row_count;
  if inserted_count<>jsonb_array_length(p_payload->'items') or inserted_count=0 then
    raise exception 'Every imported item must reference one imported CBS row';
  end if;

  insert into public.lukas_qto_boq_wbs_allocations(
    project_id,version_id,line_id,wbs_node_id,allocation_percent,created_by
  )
  select target_project,p_version_id,line.id,node.id,
    (item->>'wbsAllocationPercent')::numeric,(select auth.uid())
  from jsonb_array_elements(p_payload->'items') source(item)
  join public.lukas_qto_boq_lines line
    on line.version_id=p_version_id and line.item_code=item->>'code'
  join public.lukas_qto_boq_wbs_nodes node
    on node.version_id=p_version_id and node.code=item->>'wbsCode'
  where coalesce(item->>'wbsCode','')<>'';
end;
$$;
revoke all on function public.lukas_qto_import_boq_structure(uuid,jsonb) from public;
grant execute on function public.lukas_qto_import_boq_structure(uuid,jsonb) to authenticated,service_role;

alter table public.lukas_qto_price_books enable row level security;
alter table public.lukas_qto_price_resources enable row level security;
alter table public.lukas_qto_boq_versions enable row level security;
alter table public.lukas_qto_boq_sections enable row level security;
alter table public.lukas_qto_boq_lines enable row level security;
alter table public.lukas_qto_boq_wbs_nodes enable row level security;
alter table public.lukas_qto_boq_wbs_allocations enable row level security;
alter table public.lukas_qto_boq_quantity_mappings enable row level security;
alter table public.lukas_qto_boq_source_exclusions enable row level security;
alter table public.lukas_qto_boq_rate_components enable row level security;
alter table public.lukas_qto_boq_approvals enable row level security;

create policy "project roles read price books" on public.lukas_qto_price_books for select to authenticated
using(private.lukas_qto_project_role(project_id) is not null);
create policy "estimators add immutable price books" on public.lukas_qto_price_books for insert to authenticated
with check(created_by=(select auth.uid()) and private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));
create policy "project roles read price resources" on public.lukas_qto_price_resources for select to authenticated
using(private.lukas_qto_project_role(project_id) is not null);
create policy "estimators add immutable price resources" on public.lukas_qto_price_resources for insert to authenticated
with check(created_by=(select auth.uid()) and private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));

create policy "project roles read boq versions" on public.lukas_qto_boq_versions for select to authenticated
using(private.lukas_qto_project_role(project_id) is not null);
create policy "estimators create boq versions" on public.lukas_qto_boq_versions for insert to authenticated
with check(created_by=(select auth.uid()) and status='draft' and private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));
create policy "estimators and reviewers transition boq versions" on public.lukas_qto_boq_versions for update to authenticated
using((status='draft' and created_by=(select auth.uid())
       and private.lukas_qto_project_role(project_id) in('owner','staff','estimator'))
   or (status='in_review' and private.lukas_qto_project_role(project_id) in('owner','staff','reviewer'))
   or (status='approved' and private.lukas_qto_project_role(project_id) in('owner','staff','reviewer')))
with check(private.lukas_qto_project_role(project_id) in('owner','staff','estimator','reviewer'));

create policy "project roles read boq sections" on public.lukas_qto_boq_sections for select to authenticated
using(private.lukas_qto_project_role(project_id) is not null);
create policy "estimators add boq sections" on public.lukas_qto_boq_sections for insert to authenticated
with check(created_by=(select auth.uid()) and private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));
create policy "estimators update boq sections" on public.lukas_qto_boq_sections for update to authenticated
using(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'))
with check(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));
create policy "estimators delete boq sections" on public.lukas_qto_boq_sections for delete to authenticated
using(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));

create policy "project roles read boq lines" on public.lukas_qto_boq_lines for select to authenticated
using(private.lukas_qto_project_role(project_id) is not null);
create policy "estimators add boq lines" on public.lukas_qto_boq_lines for insert to authenticated
with check(created_by=(select auth.uid()) and private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));
create policy "estimators update boq lines" on public.lukas_qto_boq_lines for update to authenticated
using(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'))
with check(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));
create policy "estimators delete boq lines" on public.lukas_qto_boq_lines for delete to authenticated
using(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));

create policy "project roles read boq wbs nodes" on public.lukas_qto_boq_wbs_nodes for select to authenticated
using(private.lukas_qto_project_role(project_id) is not null);
create policy "estimators add boq wbs nodes" on public.lukas_qto_boq_wbs_nodes for insert to authenticated
with check(created_by=(select auth.uid()) and private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));
create policy "estimators update boq wbs nodes" on public.lukas_qto_boq_wbs_nodes for update to authenticated
using(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'))
with check(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));
create policy "estimators delete boq wbs nodes" on public.lukas_qto_boq_wbs_nodes for delete to authenticated
using(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));

create policy "project roles read boq wbs allocations" on public.lukas_qto_boq_wbs_allocations for select to authenticated
using(private.lukas_qto_project_role(project_id) is not null);
create policy "estimators add boq wbs allocations" on public.lukas_qto_boq_wbs_allocations for insert to authenticated
with check(created_by=(select auth.uid()) and private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));
create policy "estimators update boq wbs allocations" on public.lukas_qto_boq_wbs_allocations for update to authenticated
using(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'))
with check(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));
create policy "estimators delete boq wbs allocations" on public.lukas_qto_boq_wbs_allocations for delete to authenticated
using(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));

create policy "project roles read boq mappings" on public.lukas_qto_boq_quantity_mappings for select to authenticated
using(private.lukas_qto_project_role(project_id) is not null);
create policy "estimators add boq mappings" on public.lukas_qto_boq_quantity_mappings for insert to authenticated
with check(created_by=(select auth.uid()) and private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));
create policy "estimators update boq mappings" on public.lukas_qto_boq_quantity_mappings for update to authenticated
using(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'))
with check(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));
create policy "estimators delete boq mappings" on public.lukas_qto_boq_quantity_mappings for delete to authenticated
using(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));

create policy "project roles read boq exclusions" on public.lukas_qto_boq_source_exclusions for select to authenticated
using(private.lukas_qto_project_role(project_id) is not null);
create policy "estimators add boq exclusions" on public.lukas_qto_boq_source_exclusions for insert to authenticated
with check(created_by=(select auth.uid()) and private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));
create policy "estimators update boq exclusions" on public.lukas_qto_boq_source_exclusions for update to authenticated
using(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'))
with check(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));
create policy "estimators delete boq exclusions" on public.lukas_qto_boq_source_exclusions for delete to authenticated
using(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));

create policy "project roles read boq components" on public.lukas_qto_boq_rate_components for select to authenticated
using(private.lukas_qto_project_role(project_id) is not null);
create policy "estimators add boq components" on public.lukas_qto_boq_rate_components for insert to authenticated
with check(created_by=(select auth.uid()) and private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));
create policy "estimators update boq components" on public.lukas_qto_boq_rate_components for update to authenticated
using(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'))
with check(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));
create policy "estimators delete boq components" on public.lukas_qto_boq_rate_components for delete to authenticated
using(private.lukas_qto_project_role(project_id) in('owner','staff','estimator'));

create policy "project roles read boq approvals" on public.lukas_qto_boq_approvals for select to authenticated
using(exists(select 1 from public.lukas_qto_boq_versions v
  where v.id=version_id and private.lukas_qto_project_role(v.project_id) is not null));
create policy "reviewers add boq approvals" on public.lukas_qto_boq_approvals for insert to authenticated
with check(decided_by=(select auth.uid()) and exists(select 1 from public.lukas_qto_boq_versions v
  where v.id=version_id and v.created_by<>(select auth.uid())
    and private.lukas_qto_project_role(v.project_id) in('owner','staff','reviewer')));

create policy "verified email sessions only" on public.lukas_qto_price_books as restrictive for all to authenticated
using(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false)
with check(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false);
create policy "verified email sessions only" on public.lukas_qto_price_resources as restrictive for all to authenticated
using(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false)
with check(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false);
create policy "verified email sessions only" on public.lukas_qto_boq_versions as restrictive for all to authenticated
using(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false)
with check(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false);
create policy "verified email sessions only" on public.lukas_qto_boq_sections as restrictive for all to authenticated
using(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false)
with check(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false);
create policy "verified email sessions only" on public.lukas_qto_boq_lines as restrictive for all to authenticated
using(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false)
with check(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false);
create policy "verified email sessions only" on public.lukas_qto_boq_wbs_nodes as restrictive for all to authenticated
using(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false)
with check(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false);
create policy "verified email sessions only" on public.lukas_qto_boq_wbs_allocations as restrictive for all to authenticated
using(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false)
with check(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false);
create policy "verified email sessions only" on public.lukas_qto_boq_quantity_mappings as restrictive for all to authenticated
using(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false)
with check(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false);
create policy "verified email sessions only" on public.lukas_qto_boq_source_exclusions as restrictive for all to authenticated
using(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false)
with check(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false);
create policy "verified email sessions only" on public.lukas_qto_boq_rate_components as restrictive for all to authenticated
using(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false)
with check(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false);
create policy "verified email sessions only" on public.lukas_qto_boq_approvals as restrictive for all to authenticated
using(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false)
with check(coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false);

revoke all on table public.lukas_qto_price_books,public.lukas_qto_price_resources,
  public.lukas_qto_boq_versions,public.lukas_qto_boq_sections,public.lukas_qto_boq_lines,
  public.lukas_qto_boq_wbs_nodes,public.lukas_qto_boq_wbs_allocations,
  public.lukas_qto_boq_quantity_mappings,public.lukas_qto_boq_source_exclusions,
  public.lukas_qto_boq_rate_components,
  public.lukas_qto_boq_approvals from anon,authenticated;
grant select,insert on table public.lukas_qto_price_books,public.lukas_qto_price_resources to authenticated;
grant select,insert,update on table public.lukas_qto_boq_versions to authenticated;
grant select,insert,update,delete on table public.lukas_qto_boq_sections,public.lukas_qto_boq_lines,
  public.lukas_qto_boq_wbs_nodes,public.lukas_qto_boq_wbs_allocations,
  public.lukas_qto_boq_quantity_mappings,public.lukas_qto_boq_source_exclusions,
  public.lukas_qto_boq_rate_components to authenticated;
grant select,insert on table public.lukas_qto_boq_approvals to authenticated;
grant all on table public.lukas_qto_price_books,public.lukas_qto_price_resources,
  public.lukas_qto_boq_versions,public.lukas_qto_boq_sections,public.lukas_qto_boq_lines,
  public.lukas_qto_boq_wbs_nodes,public.lukas_qto_boq_wbs_allocations,
  public.lukas_qto_boq_quantity_mappings,public.lukas_qto_boq_source_exclusions,
  public.lukas_qto_boq_rate_components,
  public.lukas_qto_boq_approvals to service_role;
