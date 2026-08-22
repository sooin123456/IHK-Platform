-- Immutable machine suggestions and append-only human decisions.
-- Suggestions never change quantities; approved deterministic rules remain authoritative.
alter table public.lukas_qto_files
  add constraint lukas_qto_files_evidence_identity_key unique (id, project_id, sha256);

create table if not exists public.lukas_qto_suggestions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  file_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  producer_kind text not null check (producer_kind = 'rule'),
  producer_version text not null check (char_length(trim(producer_version)) between 1 and 120),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  suggestion_kind text not null check (suggestion_kind in ('anomaly','classification','mapping','revision_change')),
  subject_key text not null check (char_length(trim(subject_key)) between 1 and 200),
  title text not null check (char_length(trim(title)) between 1 and 200),
  detail text not null check (char_length(detail) <= 5000),
  confidence numeric check (confidence is null or confidence between 0 and 1),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  payload_file_id uuid,
  payload_sha256 text check (payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check ((payload_file_id is null) = (payload_sha256 is null)),
  unique (file_id, producer_kind, producer_version, suggestion_kind, subject_key),
  constraint lukas_qto_suggestions_source_identity_fkey
    foreign key (file_id, project_id, source_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict,
  constraint lukas_qto_suggestions_payload_identity_fkey
    foreign key (payload_file_id, project_id, payload_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict
);

create table if not exists public.lukas_qto_suggestion_decisions (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.lukas_qto_suggestions(id) on delete cascade,
  decided_by uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('accepted','rejected','deferred')),
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists lukas_qto_suggestions_project_created_idx
  on public.lukas_qto_suggestions(project_id, created_at desc);
create index if not exists lukas_qto_suggestion_decisions_suggestion_created_idx
  on public.lukas_qto_suggestion_decisions(suggestion_id, created_at desc);

alter table public.lukas_qto_suggestions enable row level security;
alter table public.lukas_qto_suggestion_decisions enable row level security;

create policy "project members read machine suggestions" on public.lukas_qto_suggestions for select to authenticated
  using (exists (
    select 1 from public.lukas_qto_projects p where p.id = project_id
      and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')
  ));
create policy "project members read suggestion decisions" on public.lukas_qto_suggestion_decisions for select to authenticated
  using (exists (
    select 1 from public.lukas_qto_suggestions s
    join public.lukas_qto_projects p on p.id = s.project_id
    where s.id = suggestion_id
      and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')
  ));
create policy "project members add suggestion decisions" on public.lukas_qto_suggestion_decisions for insert to authenticated
  with check (decided_by = (select auth.uid()) and exists (
    select 1 from public.lukas_qto_suggestions s
    join public.lukas_qto_projects p on p.id = s.project_id
    where s.id = suggestion_id
      and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')
  ));

-- 2026 Supabase projects may require explicit Data API grants for new public tables.
grant select on public.lukas_qto_suggestions to authenticated;
revoke insert, update, delete on public.lukas_qto_suggestions from authenticated;
grant select, insert on public.lukas_qto_suggestion_decisions to authenticated;
revoke update, delete on public.lukas_qto_suggestion_decisions from authenticated;
grant all on public.lukas_qto_suggestions to service_role;
grant all on public.lukas_qto_suggestion_decisions to service_role;
