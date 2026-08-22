create table public.lukas_qto_license_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check(plan='free'),
  status text not null default 'active' check(status='active'),
  granted_at timestamptz not null default now()
);

create table public.lukas_qto_download_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  release_version text not null check(char_length(trim(release_version)) between 1 and 120),
  release_sha256 text not null check(release_sha256 ~ '^[A-F0-9]{64}$'),
  downloaded_at timestamptz not null default now()
);

alter table public.lukas_qto_license_entitlements enable row level security;
alter table public.lukas_qto_download_events enable row level security;
revoke all on public.lukas_qto_license_entitlements, public.lukas_qto_download_events from anon;
grant select,insert on public.lukas_qto_license_entitlements, public.lukas_qto_download_events to authenticated;
grant all on public.lukas_qto_license_entitlements, public.lukas_qto_download_events to service_role;

create policy "users read own free entitlement"
on public.lukas_qto_license_entitlements for select to authenticated
using(user_id=(select auth.uid()));
create policy "users activate own free entitlement"
on public.lukas_qto_license_entitlements for insert to authenticated
with check(user_id=(select auth.uid()) and plan='free' and status='active');
create policy "users read own download events"
on public.lukas_qto_download_events for select to authenticated
using(user_id=(select auth.uid()));
create policy "users append own download events"
on public.lukas_qto_download_events for insert to authenticated
with check(
  user_id=(select auth.uid())
  and exists(
    select 1 from public.lukas_qto_license_entitlements entitlement
    where entitlement.user_id=(select auth.uid())
      and entitlement.plan='free'
      and entitlement.status='active'
  )
);

create index lukas_qto_download_events_user_id_idx
  on public.lukas_qto_download_events(user_id,downloaded_at desc);
