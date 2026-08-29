-- Historical baseline promoted from sql/migrations/0000 through 0010.
-- Supabase-managed auth/storage schemas and roles exist before this migration.

-- Source: sql/migrations/0000_worried_vision.sql
/**
 * Initial Database Migration: 0000_worried_vision
 *
 * This migration establishes the core data model for the Supaplate application,
 * creating the payments and profiles tables with appropriate constraints,
 * foreign keys, and row-level security policies.
 */

/**
 * Payments Table
 *
 * Stores payment transaction records with detailed information about each payment.
 * Links to the auth.users table to track which user made each payment.
 *
 * Key features:
 * - Auto-incrementing payment_id as the primary key
 * - Stores payment provider data (payment_key, receipt_url)
 * - Captures order details (order_id, order_name, total_amount)
 * - Stores raw transaction data and metadata as JSON
 * - Tracks payment status and timestamps
 * - Links to user accounts via user_id foreign key
 */
CREATE TABLE "payments" (
	"payment_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payments_payment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"payment_key" text NOT NULL,
	"order_id" text NOT NULL,
	"order_name" text NOT NULL,
	"total_amount" double precision NOT NULL,
	"metadata" jsonb NOT NULL,
	"raw_data" jsonb NOT NULL,
	"receipt_url" text NOT NULL,
	"status" text NOT NULL,
	"user_id" uuid,
	"approved_at" timestamp NOT NULL,
	"requested_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Enable Row Level Security on payments table to restrict access based on user identity
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
/**
 * Profiles Table
 *
 * Stores user profile information that extends the auth.users table.
 * Each record corresponds to a user in the auth.users table via profile_id.
 *
 * Key features:
 * - UUID primary key that matches the auth.users.id
 * - Stores display name and optional avatar image URL
 * - Tracks marketing consent for compliance with privacy regulations
 * - Includes standard audit timestamps (created_at, updated_at)
 */
CREATE TABLE "profiles" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Enable Row Level Security on profiles table to restrict access based on user identity
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Add foreign key constraint to link payments to users
-- CASCADE deletion ensures no orphaned payment records when a user is deleted
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Add foreign key constraint to link profiles to users
-- CASCADE deletion ensures profile is deleted when the corresponding user is deleted
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_profile_id_users_id_fk" FOREIGN KEY ("profile_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
/**
 * Row Level Security Policies
 *
 * These policies control access to the tables based on the authenticated user's identity.
 * They ensure users can only access their own data, implementing a multi-tenant security model.
 */

-- Allow users to view only their own payment records
CREATE POLICY "select-payment-policy" ON "payments" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "payments"."user_id");--> statement-breakpoint
-- Allow users to update only their own profile
-- Both USING and WITH CHECK clauses ensure the user can only modify their own profile
CREATE POLICY "edit-profile-policy" ON "profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.uid()) = "profiles"."profile_id") WITH CHECK ((select auth.uid()) = "profiles"."profile_id");--> statement-breakpoint
-- Allow users to delete only their own profile
CREATE POLICY "delete-profile-policy" ON "profiles" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.uid()) = "profiles"."profile_id");--> statement-breakpoint
-- Allow users to view only their own profile
CREATE POLICY "select-profile-policy" ON "profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "profiles"."profile_id");
-- Source: sql/migrations/0001_great_junta.sql
/**
 * Database Migration: 0001_great_junta
 *
 * This migration adds database triggers and functions to handle:
 * 1. Automatic profile creation when a user signs up
 * 2. Automatic updating of timestamp fields
 *
 * These automated database features ensure data consistency and reduce the need
 * for application code to handle these common operations.
 */

/**
 * User Sign-Up Handler Function
 *
 * This function automatically creates a profile record when a new user signs up.
 * It handles different authentication providers and extracts relevant user information
 * from the metadata provided during sign-up.
 *
 * The function differentiates between:
 * - Email/phone authentication: Uses provided name or defaults to 'Anonymous'
 * - OAuth providers: Uses profile data from the provider (name, avatar URL)
 *
 * Security considerations:
 * - Uses SECURITY DEFINER to run with the privileges of the function owner
 * - Sets an empty search path to prevent search path injection attacks
 */
CREATE OR REPLACE FUNCTION handle_sign_up()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET SEARCH_PATH = ''
AS $$
BEGIN
    -- Check if the user record has provider information in the metadata
    IF new.raw_app_meta_data IS NOT NULL AND new.raw_app_meta_data ? 'provider' THEN
        -- Handle email or phone authentication
        IF new.raw_app_meta_data ->> 'provider' = 'email' OR new.raw_app_meta_data ->> 'provider' = 'phone' THEN
            -- If user provided a name during registration, use it
            IF new.raw_user_meta_data ? 'name' THEN
                INSERT INTO public.profiles (profile_id, name, marketing_consent)
                VALUES (new.id, new.raw_user_meta_data ->> 'name', (new.raw_user_meta_data ->> 'marketing_consent')::boolean);
            ELSE
                -- Otherwise, set a default name and opt-in to marketing
                INSERT INTO public.profiles (profile_id, name, marketing_consent)
                VALUES (new.id, 'Anonymous', TRUE);
            END IF;
        ELSE
            -- Handle OAuth providers (Google, GitHub, etc.)
            -- Use the profile data provided by the OAuth provider
            INSERT INTO public.profiles (profile_id, name, avatar_url, marketing_consent)
            VALUES (new.id, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'avatar_url', TRUE);
        END IF;
    END IF;
    RETURN NEW; -- Return the user record that triggered this function
END;
$$;

/**
 * User Sign-Up Trigger
 *
 * This trigger executes the handle_sign_up function automatically
 * after a new user is inserted into the auth.users table.
 *
 * The trigger runs once for each row inserted (FOR EACH ROW)
 * and only activates on INSERT operations, not on UPDATE or DELETE.
 */
CREATE TRIGGER handle_sign_up
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION handle_sign_up();


/**
 * Updated Timestamp Handler Function
 *
 * This utility function automatically updates the 'updated_at' timestamp
 * field of a record whenever it is modified. It's designed to be used with
 * triggers on tables that have an updated_at column to track modification times.
 *
 * The function sets the updated_at field to the current UTC timestamp,
 * ensuring consistent timezone handling across the application.
 *
 * Security considerations:
 * - Uses SECURITY DEFINER to run with the privileges of the function owner
 * - Sets an empty search path to prevent search path injection attacks
 */
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET SEARCH_PATH = ''
AS $$
BEGIN
    -- Set the updated_at field to the current UTC timestamp
    -- This ensures consistent timezone handling across the application
    NEW.updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC';

    -- Return the modified record to be saved to the database
    RETURN NEW;
END;
$$;

/**
 * Profiles Updated Timestamp Trigger
 *
 * This trigger automatically updates the updated_at timestamp
 * whenever a profile record is modified.
 *
 * It runs BEFORE UPDATE to modify the record before it's saved,
 * ensuring that every update operation includes the current timestamp.
 */
CREATE TRIGGER set_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();


/**
 * Payments Updated Timestamp Trigger
 *
 * This trigger automatically updates the updated_at timestamp
 * whenever a payment record is modified.
 *
 * It runs BEFORE UPDATE to modify the record before it's saved,
 * ensuring that every update operation includes the current timestamp.
 *
 * This is particularly important for payment records to maintain
 * an accurate audit trail of when payment information was last modified.
 */
CREATE TRIGGER set_payments_updated_at
BEFORE UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();



-- Source: sql/migrations/0002_lukas_qto_platform.sql
-- Lukas QTO project data, review annotations and private source file metadata.
create table if not exists public.lukas_qto_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.lukas_qto_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('ifc','qto_csv','element_ledger','formwork_ledger','estimate','mapping','other')),
  storage_path text not null unique check (storage_path !~ '(^/|//|/\.\.?/|^$)'),
  original_filename text not null check (char_length(trim(original_filename)) between 1 and 255),
  content_type text,
  byte_size bigint not null check (byte_size >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  immutable boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.lukas_qto_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  file_id uuid references public.lukas_qto_files(id) on delete set null,
  author_id uuid references auth.users(id) on delete set null,
  status text not null default 'open' check (status in ('open','in_review','resolved','blocked')),
  note text not null default '' check (char_length(note) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.lukas_qto_shares (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  token uuid not null unique default gen_random_uuid(),
  permission text not null check (permission in ('view','review')),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists lukas_qto_projects_owner_id_idx on public.lukas_qto_projects(owner_id);
create index if not exists lukas_qto_files_project_id_idx on public.lukas_qto_files(project_id);
create index if not exists lukas_qto_reviews_project_id_idx on public.lukas_qto_reviews(project_id);
create index if not exists lukas_qto_shares_project_id_idx on public.lukas_qto_shares(project_id);

alter table public.lukas_qto_projects enable row level security;
alter table public.lukas_qto_files enable row level security;
alter table public.lukas_qto_reviews enable row level security;
alter table public.lukas_qto_shares enable row level security;
create policy "lukas qto owners manage projects" on public.lukas_qto_projects for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "lukas qto owners manage files" on public.lukas_qto_files for all to authenticated
  using (exists (select 1 from public.lukas_qto_projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  with check (uploaded_by = (select auth.uid()) and exists (select 1 from public.lukas_qto_projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy "lukas qto owners manage reviews" on public.lukas_qto_reviews for all to authenticated
  using (exists (select 1 from public.lukas_qto_projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.lukas_qto_projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy "lukas qto owners manage shares" on public.lukas_qto_shares for all to authenticated
  using (exists (select 1 from public.lukas_qto_projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  with check (created_by = (select auth.uid()) and exists (select 1 from public.lukas_qto_projects p where p.id = project_id and p.owner_id = (select auth.uid())));

create or replace function public.lukas_qto_set_updated_at() returns trigger language plpgsql security invoker set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger lukas_qto_projects_set_updated_at before update on public.lukas_qto_projects for each row execute function public.lukas_qto_set_updated_at();
create trigger lukas_qto_reviews_set_updated_at before update on public.lukas_qto_reviews for each row execute function public.lukas_qto_set_updated_at();

-- Share RPCs stay server-only. The web app validates public tokens server-side;
-- the browser never gets elevated database access nor direct access to Storage.
create or replace function public.lukas_qto_shared_project(p_token uuid)
returns table(project_id uuid, project_name text, permission text, expires_at timestamptz)
language sql security definer set search_path = public as $$
  select p.id, p.name, s.permission, s.expires_at from public.lukas_qto_shares s
  join public.lukas_qto_projects p on p.id = s.project_id
  where s.token = p_token and (s.expires_at is null or s.expires_at > now());
$$;
create or replace function public.lukas_qto_submit_share_review(p_token uuid, p_status text, p_note text, p_file_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_project_id uuid; v_review_id uuid;
begin
  select s.project_id into v_project_id from public.lukas_qto_shares s
  where s.token = p_token and s.permission = 'review' and (s.expires_at is null or s.expires_at > now());
  if v_project_id is null then raise exception 'Invalid, expired, or read-only share link'; end if;
  if p_status not in ('open','in_review','resolved','blocked') then raise exception 'Invalid review status'; end if;
  if char_length(coalesce(p_note, '')) > 5000 then raise exception 'Review note is too long'; end if;
  if p_file_id is not null and not exists (select 1 from public.lukas_qto_files f where f.id = p_file_id and f.project_id = v_project_id) then raise exception 'File does not belong to the shared project'; end if;
  insert into public.lukas_qto_reviews(project_id,file_id,author_id,status,note)
  values (v_project_id,p_file_id,null,p_status,coalesce(p_note,'')) returning id into v_review_id;
  return v_review_id;
end;
$$;
revoke all on function public.lukas_qto_shared_project(uuid) from public, anon, authenticated;
revoke all on function public.lukas_qto_submit_share_review(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.lukas_qto_shared_project(uuid) to service_role;
grant execute on function public.lukas_qto_submit_share_review(uuid,text,text,uuid) to service_role;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('lukas-qto','lukas-qto',false,1073741824,array['application/x-step','application/octet-stream','text/csv','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy "lukas qto owners read their source files" on storage.objects for select to authenticated using (bucket_id='lukas-qto' and (storage.foldername(name))[1]=(select auth.uid()::text));
create policy "lukas qto owners upload their source files" on storage.objects for insert to authenticated with check (bucket_id='lukas-qto' and (storage.foldername(name))[1]=(select auth.uid()::text));
create policy "lukas qto owners delete their source files" on storage.objects for delete to authenticated using (bucket_id='lukas-qto' and (storage.foldername(name))[1]=(select auth.uid()::text));

-- Source: sql/migrations/0003_lukas_qto_share_rpcs_server_only.sql
-- Public share URLs are handled by the server. Do not expose SECURITY DEFINER
-- token functions through the browser-accessible Supabase RPC endpoint.
revoke execute on function public.lukas_qto_shared_project(uuid) from anon, authenticated;
revoke execute on function public.lukas_qto_submit_share_review(uuid, text, text, uuid) from anon, authenticated;
grant execute on function public.lukas_qto_shared_project(uuid) to service_role;
grant execute on function public.lukas_qto_submit_share_review(uuid, text, text, uuid) to service_role;

-- Source: sql/migrations/0004_lukas_qto_file_metadata_immutable.sql
-- Source file metadata is append-only. Review annotations are the mutable layer.
drop policy if exists "lukas qto owners manage files" on public.lukas_qto_files;
create policy "lukas qto owners read files" on public.lukas_qto_files for select to authenticated
using (exists (select 1 from public.lukas_qto_projects p where p.id=project_id and p.owner_id=(select auth.uid())));
create policy "lukas qto owners add immutable files" on public.lukas_qto_files for insert to authenticated
with check (uploaded_by=(select auth.uid()) and immutable=true and exists (select 1 from public.lukas_qto_projects p where p.id=project_id and p.owner_id=(select auth.uid())));
create policy "lukas qto owners delete files" on public.lukas_qto_files for delete to authenticated
using (exists (select 1 from public.lukas_qto_projects p where p.id=project_id and p.owner_id=(select auth.uid())));

-- Source: sql/migrations/0005_hangil_service_workflow.sql
-- Customer-facing Hangil System workflow. Existing table names stay stable for compatibility.
alter table public.lukas_qto_projects
  add column if not exists workflow_status text not null default 'inquiry_received'
    check (workflow_status in ('inquiry_received','quote_review','confirmed','bim_modeling','quantity_takeoff','expert_review','delivered')),
  add column if not exists contact_name text not null default '' check (char_length(contact_name) <= 80),
  add column if not exists contact_phone text not null default '' check (char_length(contact_phone) <= 40);

create index if not exists lukas_qto_projects_workflow_status_idx on public.lukas_qto_projects(workflow_status, updated_at desc);

-- Staff authority is issued only through auth.app_metadata by a Supabase administrator.
drop policy if exists "hangil staff read projects" on public.lukas_qto_projects;
create policy "hangil staff read projects" on public.lukas_qto_projects for select to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff');
drop policy if exists "hangil staff update projects" on public.lukas_qto_projects;
create policy "hangil staff update projects" on public.lukas_qto_projects for update to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')
  with check ((select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff');
drop policy if exists "hangil staff manage files" on public.lukas_qto_files;
create policy "hangil staff manage files" on public.lukas_qto_files for all to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')
  with check ((select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff');
drop policy if exists "hangil staff manage reviews" on public.lukas_qto_reviews;
create policy "hangil staff manage reviews" on public.lukas_qto_reviews for all to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')
  with check ((select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff');

drop policy if exists "hangil staff read source files" on storage.objects;
create policy "hangil staff read source files" on storage.objects for select to authenticated
  using (bucket_id='lukas-qto' and (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff');
drop policy if exists "hangil staff upload source files" on storage.objects;
create policy "hangil staff upload source files" on storage.objects for insert to authenticated
  with check (bucket_id='lukas-qto' and (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff');
drop policy if exists "hangil staff delete source files" on storage.objects;
create policy "hangil staff delete source files" on storage.objects for delete to authenticated
  using (bucket_id='lukas-qto' and (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff');

-- Source: sql/migrations/0006_qto_suggestion_feedback.sql
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

-- Source: sql/migrations/0007_concrete_takeoff_artifacts.sql
-- Verified deterministic concrete takeoff bundles and append-only human approvals.
-- The web platform stores evidence; it does not calculate or alter quantities.
create table if not exists public.lukas_qto_takeoff_artifacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  artifact_kind text not null check (artifact_kind = 'concrete_takeoff'),
  format_version text not null check (format_version = 'CONCRETE_TAKEOFF_CSV_V1'),
  report_file_id uuid not null,
  manifest_file_id uuid not null,
  report_sha256 text not null check (report_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  row_count integer not null check (row_count > 0),
  input_sha256 jsonb not null check (
    jsonb_typeof(input_sha256) = 'object'
    and input_sha256 ?& array['export_manifest','ifc','qto','element_ledger','revit_mapping','concrete_rules','registry']
    and input_sha256 - array['export_manifest','ifc','qto','element_ledger','revit_mapping','concrete_rules','registry'] = '{}'::jsonb
  ),
  status_counts jsonb not null check (jsonb_typeof(status_counts) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, project_id),
  unique (report_file_id),
  unique (manifest_file_id),
  constraint lukas_qto_takeoff_report_identity_fkey
    foreign key (report_file_id, project_id, report_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict,
  constraint lukas_qto_takeoff_manifest_identity_fkey
    foreign key (manifest_file_id, project_id, manifest_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict,
  check (report_file_id <> manifest_file_id)
);

create table if not exists public.lukas_qto_takeoff_inputs (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null,
  project_id uuid not null,
  input_role text not null check (input_role in ('export_manifest','ifc','qto','element_ledger','revit_mapping','concrete_rules','registry')),
  file_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  unique (artifact_id, input_role),
  constraint lukas_qto_takeoff_inputs_artifact_fkey
    foreign key (artifact_id, project_id)
    references public.lukas_qto_takeoff_artifacts(id, project_id) on delete cascade,
  constraint lukas_qto_takeoff_inputs_file_identity_fkey
    foreign key (file_id, project_id, source_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict
);

create table if not exists public.lukas_qto_takeoff_approvals (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.lukas_qto_takeoff_artifacts(id) on delete cascade,
  decided_by uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approved','rejected','deferred')),
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists lukas_qto_takeoff_artifacts_project_created_idx
  on public.lukas_qto_takeoff_artifacts(project_id, created_at desc);
create index if not exists lukas_qto_takeoff_approvals_artifact_created_idx
  on public.lukas_qto_takeoff_approvals(artifact_id, created_at desc);
create index if not exists lukas_qto_takeoff_inputs_file_idx
  on public.lukas_qto_takeoff_inputs(file_id);

alter table public.lukas_qto_takeoff_artifacts enable row level security;
alter table public.lukas_qto_takeoff_approvals enable row level security;
alter table public.lukas_qto_takeoff_inputs enable row level security;

create policy "project members read takeoff artifacts" on public.lukas_qto_takeoff_artifacts for select to authenticated
  using (exists (
    select 1 from public.lukas_qto_projects p where p.id = project_id
      and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')
  ));
create policy "project members read takeoff approvals" on public.lukas_qto_takeoff_approvals for select to authenticated
  using (exists (
    select 1 from public.lukas_qto_takeoff_artifacts a
    join public.lukas_qto_projects p on p.id = a.project_id
    where a.id = artifact_id
      and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')
  ));
create policy "project members add takeoff approvals" on public.lukas_qto_takeoff_approvals for insert to authenticated
  with check (decided_by = (select auth.uid()) and exists (
    select 1 from public.lukas_qto_takeoff_artifacts a
    join public.lukas_qto_projects p on p.id = a.project_id
    where a.id = artifact_id
      and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')
  ));
create policy "project members read takeoff input evidence" on public.lukas_qto_takeoff_inputs for select to authenticated
  using (exists (
    select 1 from public.lukas_qto_projects p where p.id = project_id
      and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')
  ));

-- Artifact metadata can only be inserted by a validated server action.
grant select on public.lukas_qto_takeoff_artifacts to authenticated;
revoke insert, update, delete on public.lukas_qto_takeoff_artifacts from authenticated;
grant select, insert on public.lukas_qto_takeoff_approvals to authenticated;
revoke update, delete on public.lukas_qto_takeoff_approvals from authenticated;
grant select on public.lukas_qto_takeoff_inputs to authenticated;
revoke insert, update, delete on public.lukas_qto_takeoff_inputs from authenticated;
grant all on public.lukas_qto_takeoff_artifacts to service_role;
grant all on public.lukas_qto_takeoff_approvals to service_role;
grant all on public.lukas_qto_takeoff_inputs to service_role;

-- Source: sql/migrations/0008_file_revision_graph.sql
-- Explicit immutable revision edges. File order is evidence, never inferred from filenames.
create table if not exists public.lukas_qto_file_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  previous_file_id uuid not null,
  previous_sha256 text not null check (previous_sha256 ~ '^[0-9a-f]{64}$'),
  current_file_id uuid not null,
  current_sha256 text not null check (current_sha256 ~ '^[0-9a-f]{64}$'),
  relation_kind text not null check (relation_kind = 'supersedes'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (current_file_id),
  unique (previous_file_id),
  check (previous_file_id <> current_file_id),
  constraint lukas_qto_revision_previous_identity_fkey
    foreign key (previous_file_id, project_id, previous_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict,
  constraint lukas_qto_revision_current_identity_fkey
    foreign key (current_file_id, project_id, current_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict
);

create or replace function public.lukas_qto_validate_file_revision()
returns trigger language plpgsql security invoker set search_path = public as $$
declare previous_kind text; current_kind text; previous_created timestamptz; current_created timestamptz;
begin
  select kind, created_at into previous_kind, previous_created from public.lukas_qto_files
    where id = new.previous_file_id and project_id = new.project_id and sha256 = new.previous_sha256;
  select kind, created_at into current_kind, current_created from public.lukas_qto_files
    where id = new.current_file_id and project_id = new.project_id and sha256 = new.current_sha256;
  if previous_kind is null or current_kind is null or previous_kind <> current_kind then
    raise exception 'Revision files must exist in the same project and have the same kind';
  end if;
  if previous_created > current_created then raise exception 'Revision direction must follow file creation time'; end if;
  return new;
end;
$$;

create trigger lukas_qto_file_revisions_validate before insert on public.lukas_qto_file_revisions
for each row execute function public.lukas_qto_validate_file_revision();

create index if not exists lukas_qto_file_revisions_project_created_idx
  on public.lukas_qto_file_revisions(project_id, created_at desc);
create index if not exists lukas_qto_file_revisions_previous_idx
  on public.lukas_qto_file_revisions(previous_file_id);

alter table public.lukas_qto_file_revisions enable row level security;
create policy "project members read file revision graph" on public.lukas_qto_file_revisions for select to authenticated
  using (exists (
    select 1 from public.lukas_qto_projects p where p.id = project_id
      and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')
  ));

grant select on public.lukas_qto_file_revisions to authenticated;
revoke insert, update, delete on public.lukas_qto_file_revisions from authenticated;
grant all on public.lukas_qto_file_revisions to service_role;

-- Source: sql/migrations/0009_preflight_audit_artifacts.sql
-- Deterministic L1 QTO/estimate/mapping audit reports and append-only approval history.
create table if not exists public.lukas_qto_preflight_artifacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  format_version text not null check (format_version = 'LUKAS_PREFLIGHT_REPORT_V1'),
  ruleset_version text not null check (char_length(trim(ruleset_version)) between 1 and 40),
  scope_id text not null check (char_length(trim(scope_id)) between 1 and 160),
  report_file_id uuid not null,
  manifest_file_id uuid not null,
  report_sha256 text not null check (report_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  quantity_tolerance text not null check (quantity_tolerance ~ '^[0-9]+(\.[0-9]+)?$'),
  krw_tolerance text not null check (krw_tolerance ~ '^[0-9]+(\.[0-9]+)?$'),
  row_count integer not null check (row_count > 0),
  status_counts jsonb not null check (jsonb_typeof(status_counts) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, project_id), unique (report_file_id), unique (manifest_file_id),
  check (report_file_id <> manifest_file_id),
  constraint lukas_qto_preflight_report_identity_fkey foreign key (report_file_id, project_id, report_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict,
  constraint lukas_qto_preflight_manifest_identity_fkey foreign key (manifest_file_id, project_id, manifest_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict
);

create table if not exists public.lukas_qto_preflight_inputs (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null,
  project_id uuid not null,
  input_role text not null check (input_role in ('ifc','qto','estimate','mapping','source_manifest')),
  file_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_id text not null check (char_length(trim(source_id)) between 1 and 200),
  unique (artifact_id, input_role),
  constraint lukas_qto_preflight_inputs_artifact_fkey foreign key (artifact_id, project_id)
    references public.lukas_qto_preflight_artifacts(id, project_id) on delete cascade,
  constraint lukas_qto_preflight_inputs_file_identity_fkey foreign key (file_id, project_id, source_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict
);

create table if not exists public.lukas_qto_preflight_approvals (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.lukas_qto_preflight_artifacts(id) on delete cascade,
  decided_by uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approved','rejected','deferred')),
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists lukas_qto_preflight_artifacts_project_created_idx on public.lukas_qto_preflight_artifacts(project_id, created_at desc);
create index if not exists lukas_qto_preflight_inputs_file_idx on public.lukas_qto_preflight_inputs(file_id);
create index if not exists lukas_qto_preflight_approvals_artifact_created_idx on public.lukas_qto_preflight_approvals(artifact_id, created_at desc);

alter table public.lukas_qto_preflight_artifacts enable row level security;
alter table public.lukas_qto_preflight_inputs enable row level security;
alter table public.lukas_qto_preflight_approvals enable row level security;

create policy "project members read preflight artifacts" on public.lukas_qto_preflight_artifacts for select to authenticated using (exists (
  select 1 from public.lukas_qto_projects p where p.id = project_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));
create policy "project members read preflight input evidence" on public.lukas_qto_preflight_inputs for select to authenticated using (exists (
  select 1 from public.lukas_qto_projects p where p.id = project_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));
create policy "project members read preflight approvals" on public.lukas_qto_preflight_approvals for select to authenticated using (exists (
  select 1 from public.lukas_qto_preflight_artifacts a join public.lukas_qto_projects p on p.id = a.project_id where a.id = artifact_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));
create policy "project members add preflight approvals" on public.lukas_qto_preflight_approvals for insert to authenticated with check (
  decided_by = (select auth.uid()) and exists (select 1 from public.lukas_qto_preflight_artifacts a join public.lukas_qto_projects p on p.id = a.project_id where a.id = artifact_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));

grant select on public.lukas_qto_preflight_artifacts, public.lukas_qto_preflight_inputs to authenticated;
revoke insert, update, delete on public.lukas_qto_preflight_artifacts, public.lukas_qto_preflight_inputs from authenticated;
grant select, insert on public.lukas_qto_preflight_approvals to authenticated;
revoke update, delete on public.lukas_qto_preflight_approvals from authenticated;
grant all on public.lukas_qto_preflight_artifacts, public.lukas_qto_preflight_inputs, public.lukas_qto_preflight_approvals to service_role;

-- Public project inquiries. The browser may only append a consented inquiry;
-- reading and changing the queue is reserved for trusted server/staff tooling.
create table if not exists public.hangil_project_inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  email text not null check (char_length(trim(email)) between 3 and 254 and position('@' in email) > 1),
  phone text not null default '' check (char_length(phone) <= 40),
  company text not null default '' check (char_length(company) <= 120),
  project_name text not null check (char_length(trim(project_name)) between 1 and 160),
  message text not null check (char_length(trim(message)) between 10 and 4000),
  consent boolean not null check (consent = true),
  status text not null default 'new' check (status in ('new','contacted','qualified','closed')),
  created_at timestamptz not null default now()
);
alter table public.hangil_project_inquiries enable row level security;
create policy "public submits project inquiries" on public.hangil_project_inquiries
  for insert to anon, authenticated with check (consent = true and status = 'new');
create policy "hangil staff reads project inquiries" on public.hangil_project_inquiries
  for select to authenticated using (
    coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false
    and (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff'
  );
create policy "hangil staff updates project inquiries" on public.hangil_project_inquiries
  for update to authenticated using (
    coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false
    and (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff'
  ) with check (
    coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false
    and (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff'
  );
grant insert on public.hangil_project_inquiries to anon, authenticated;
grant select, update on public.hangil_project_inquiries to authenticated;
revoke select, update, delete on public.hangil_project_inquiries from anon;
revoke delete on public.hangil_project_inquiries from authenticated;
grant all on public.hangil_project_inquiries to service_role;

-- Anonymous Auth users use the authenticated PostgreSQL role. A restrictive
-- policy makes every customer/staff table deny those sessions even if another
-- permissive owner policy matches the anonymous user's UUID.
create policy "verified email sessions only" on public.lukas_qto_projects as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_files as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_reviews as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_shares as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_suggestions as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_suggestion_decisions as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_takeoff_artifacts as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_takeoff_inputs as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_takeoff_approvals as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_file_revisions as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_preflight_artifacts as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_preflight_inputs as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_preflight_approvals as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only for qto storage" on storage.objects as restrictive
  for all to authenticated using (bucket_id <> 'lukas-qto' or coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (bucket_id <> 'lukas-qto' or coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);

create index if not exists lukas_qto_files_uploaded_by_idx on public.lukas_qto_files(uploaded_by);
create index if not exists lukas_qto_reviews_author_id_idx on public.lukas_qto_reviews(author_id);
create index if not exists lukas_qto_reviews_file_id_idx on public.lukas_qto_reviews(file_id);
create index if not exists lukas_qto_shares_created_by_idx on public.lukas_qto_shares(created_by);
create index if not exists hangil_project_inquiries_created_idx on public.hangil_project_inquiries(created_at desc);

-- Source: sql/migrations/0010_material_control_pilot.sql
-- Concrete-first material control pilot. This is a separate web workflow from
-- the Revit add-in: source files are linked by immutable project file identity.

create table if not exists public.lukas_qto_carbon_factors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  material_code text not null check (char_length(trim(material_code)) between 1 and 80),
  product_name text not null check (char_length(trim(product_name)) between 1 and 200),
  manufacturer text not null default '' check (char_length(manufacturer) <= 160),
  declared_unit text not null check (declared_unit in ('m3','kg','t','m2','m','EA')),
  gwp_a1_a3_per_unit numeric(24,6) not null check (gwp_a1_a3_per_unit >= 0),
  source_type text not null check (source_type in ('product_epd','industry_average','generic')),
  standard text not null check (char_length(trim(standard)) between 1 and 160),
  geography text not null default '' check (char_length(geography) <= 120),
  valid_from date,
  valid_until date,
  source_file_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, project_id),
  check (valid_until is null or valid_from is null or valid_until >= valid_from),
  constraint lukas_qto_carbon_factor_source_identity_fkey
    foreign key (source_file_id, project_id, source_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict
);

create table if not exists public.lukas_qto_material_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  material_code text not null check (char_length(trim(material_code)) between 1 and 80),
  material_name text not null check (char_length(trim(material_name)) between 1 and 160),
  specification text not null check (char_length(trim(specification)) between 1 and 200),
  unit text not null check (unit in ('m3','kg','t','m2','m','EA')),
  design_quantity numeric(24,6) not null check (design_quantity >= 0),
  allowance_rate numeric(12,6) not null default 0 check (allowance_rate >= 0 and allowance_rate <= 10),
  required_quantity numeric(24,6) not null check (required_quantity >= 0),
  rule_id text not null check (char_length(trim(rule_id)) between 1 and 120),
  required_by date,
  source_file_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  baseline_factor_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, project_id),
  unique (project_id, material_code, created_at),
  check (required_quantity = round(design_quantity * (1 + allowance_rate), 6)),
  constraint lukas_qto_material_plan_source_identity_fkey
    foreign key (source_file_id, project_id, source_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict,
  constraint lukas_qto_material_plan_baseline_factor_fkey
    foreign key (baseline_factor_id, project_id)
    references public.lukas_qto_carbon_factors(id, project_id) on delete restrict
);

create table if not exists public.lukas_qto_material_transactions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  material_plan_id uuid not null,
  transaction_type text not null check (transaction_type in ('purchase_order','goods_receipt','invoice_evidence')),
  document_number text not null check (char_length(trim(document_number)) between 1 and 120),
  supplier_name text not null check (char_length(trim(supplier_name)) between 1 and 160),
  occurred_on date not null,
  quantity numeric(24,6) not null check (quantity > 0),
  unit_price_krw numeric(24,0) check (unit_price_krw >= 0),
  amount_krw numeric(24,0) check (amount_krw >= 0),
  related_order_id uuid,
  carbon_factor_id uuid,
  evidence_file_id uuid,
  evidence_sha256 text check (evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$'),
  received_by_name text not null default '' check (char_length(received_by_name) <= 120),
  site_acknowledgement boolean not null default false,
  note text not null default '' check (char_length(note) <= 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, project_id),
  unique (project_id, transaction_type, supplier_name, document_number, material_plan_id),
  check ((evidence_file_id is null) = (evidence_sha256 is null)),
  constraint lukas_qto_material_transaction_plan_fkey
    foreign key (material_plan_id, project_id)
    references public.lukas_qto_material_plans(id, project_id) on delete restrict,
  constraint lukas_qto_material_transaction_order_fkey
    foreign key (related_order_id, project_id)
    references public.lukas_qto_material_transactions(id, project_id) on delete restrict,
  constraint lukas_qto_material_transaction_factor_fkey
    foreign key (carbon_factor_id, project_id)
    references public.lukas_qto_carbon_factors(id, project_id) on delete restrict,
  constraint lukas_qto_material_transaction_evidence_identity_fkey
    foreign key (evidence_file_id, project_id, evidence_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict
);

create or replace function public.lukas_qto_validate_material_plan()
returns trigger language plpgsql security invoker set search_path = public as $$
declare factor_code text; factor_unit text;
begin
  if new.baseline_factor_id is not null then
    select material_code, declared_unit into factor_code, factor_unit
      from public.lukas_qto_carbon_factors where id = new.baseline_factor_id and project_id = new.project_id;
    if factor_code is distinct from new.material_code or factor_unit is distinct from new.unit then
      raise exception 'The baseline carbon factor must match the material code and unit';
    end if;
  end if;
  return new;
end;
$$;

create trigger lukas_qto_material_plans_validate before insert on public.lukas_qto_material_plans
for each row execute function public.lukas_qto_validate_material_plan();

create or replace function public.lukas_qto_validate_material_transaction()
returns trigger language plpgsql security invoker set search_path = public as $$
declare order_kind text; order_plan uuid; order_supplier text; plan_code text; plan_unit text; factor_code text; factor_unit text;
begin
  select material_code, unit into plan_code, plan_unit from public.lukas_qto_material_plans
    where id = new.material_plan_id and project_id = new.project_id;
  if plan_code is null then raise exception 'Material plan does not belong to the project'; end if;
  if new.carbon_factor_id is not null then
    select material_code, declared_unit into factor_code, factor_unit from public.lukas_qto_carbon_factors
      where id = new.carbon_factor_id and project_id = new.project_id;
    if factor_code is distinct from plan_code or factor_unit is distinct from plan_unit then
      raise exception 'The product carbon factor must match the material code and unit';
    end if;
  end if;
  if new.transaction_type = 'purchase_order' then
    if new.related_order_id is not null then raise exception 'A purchase order cannot reference another order'; end if;
  else
    if new.related_order_id is null then raise exception 'Receipt and invoice evidence require a purchase order'; end if;
    select transaction_type, material_plan_id, supplier_name into order_kind, order_plan, order_supplier
      from public.lukas_qto_material_transactions
      where id = new.related_order_id and project_id = new.project_id;
    if order_kind is distinct from 'purchase_order' or order_plan is distinct from new.material_plan_id then
      raise exception 'The referenced purchase order must belong to the same project and material plan';
    end if;
    if order_supplier is distinct from new.supplier_name then raise exception 'Receipt and invoice supplier must match the purchase order'; end if;
  end if;
  if new.transaction_type in ('goods_receipt','invoice_evidence') and new.evidence_file_id is null then
    raise exception 'Receipt and invoice evidence require an immutable evidence file';
  end if;
  if new.transaction_type = 'goods_receipt' and (not new.site_acknowledgement or trim(new.received_by_name) = '') then
    raise exception 'A goods receipt requires site acknowledgement and receiver name';
  end if;
  if new.transaction_type = 'invoice_evidence' and (new.unit_price_krw is null or new.amount_krw is null) then
    raise exception 'Invoice evidence requires a unit price and source amount';
  end if;
  if new.transaction_type = 'invoice_evidence' and new.amount_krw <> round(new.quantity * new.unit_price_krw, 0) then
    raise exception 'Invoice source amount does not match rounded quantity times unit price';
  end if;
  return new;
end;
$$;

create trigger lukas_qto_material_transactions_validate before insert on public.lukas_qto_material_transactions
for each row execute function public.lukas_qto_validate_material_transaction();

create index if not exists lukas_qto_carbon_factors_project_idx on public.lukas_qto_carbon_factors(project_id, created_at desc);
create index if not exists lukas_qto_material_plans_project_idx on public.lukas_qto_material_plans(project_id, created_at desc);
create index if not exists lukas_qto_material_transactions_project_idx on public.lukas_qto_material_transactions(project_id, occurred_on desc);
create index if not exists lukas_qto_material_transactions_plan_idx on public.lukas_qto_material_transactions(material_plan_id, transaction_type);

alter table public.lukas_qto_carbon_factors enable row level security;
alter table public.lukas_qto_material_plans enable row level security;
alter table public.lukas_qto_material_transactions enable row level security;

create policy "project members read carbon factors" on public.lukas_qto_carbon_factors for select to authenticated using (exists (
  select 1 from public.lukas_qto_projects p where p.id = project_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));
create policy "project members add carbon factors" on public.lukas_qto_carbon_factors for insert to authenticated with check (
  created_by = (select auth.uid()) and exists (select 1 from public.lukas_qto_projects p where p.id = project_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));
create policy "project members read material plans" on public.lukas_qto_material_plans for select to authenticated using (exists (
  select 1 from public.lukas_qto_projects p where p.id = project_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));
create policy "project members add material plans" on public.lukas_qto_material_plans for insert to authenticated with check (
  created_by = (select auth.uid()) and exists (select 1 from public.lukas_qto_projects p where p.id = project_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));
create policy "project members read material transactions" on public.lukas_qto_material_transactions for select to authenticated using (exists (
  select 1 from public.lukas_qto_projects p where p.id = project_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));
create policy "project members add material transactions" on public.lukas_qto_material_transactions for insert to authenticated with check (
  created_by = (select auth.uid()) and exists (select 1 from public.lukas_qto_projects p where p.id = project_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));

create policy "verified email sessions only" on public.lukas_qto_carbon_factors as restrictive for all to authenticated
  using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_material_plans as restrictive for all to authenticated
  using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_material_transactions as restrictive for all to authenticated
  using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);

grant select, insert on public.lukas_qto_carbon_factors, public.lukas_qto_material_plans, public.lukas_qto_material_transactions to authenticated;
revoke update, delete on public.lukas_qto_carbon_factors, public.lukas_qto_material_plans, public.lukas_qto_material_transactions from authenticated;
grant all on public.lukas_qto_carbon_factors, public.lukas_qto_material_plans, public.lukas_qto_material_transactions to service_role;

-- Field evidence stays private in the existing bucket. The Revit package MIME
-- types remain allowed; this migration only adds receipt photos and PDF slips.
update storage.buckets set allowed_mime_types = array[
  'application/x-step','application/octet-stream','text/csv','application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg','image/png','application/pdf'
] where id = 'lukas-qto';
