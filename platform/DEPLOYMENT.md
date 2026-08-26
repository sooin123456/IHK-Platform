# Lukas QTO Platform deployment

This is a server-rendered React Router application. Deploy it as a Node.js
application; do not export it as a static site because login cookies and
private Storage links are created on the server.

## Required runtime variables

Set these values in the deployment host. `VITE_*` values are intentionally
browser-visible publishable settings. The service-role key is server-only and
must never use a `VITE_` prefix or be embedded in the client bundle.

```text
SUPABASE_URL=https://naubrijesaqnnbfaehpy.supabase.co
SUPABASE_ANON_KEY=<Supabase publishable key>
VITE_SUPABASE_URL=https://naubrijesaqnnbfaehpy.supabase.co
VITE_SUPABASE_ANON_KEY=<Supabase publishable key>
APP_URL=https://<platform-domain>
SITE_URL=https://<platform-domain>
VITE_APP_NAME=Lukas QTO Platform
VITE_REVIT_2025_BETA_URL=https://<verified-release-url>
VITE_REVIT_2025_BETA_SHA256=<64-hex-sha256>
VITE_REVIT_2025_BETA_VERSION=<release-label>
SUPABASE_SERVICE_ROLE_KEY=<server-only service role key>
```

Use Node 20 or later, then run `npm ci` and `npm run build`. For Vercel,
the same application is already configured with the React Router Vercel preset;
use `npm run build:vercel` as the deployment build command.

## Supabase Auth configuration

In the connected Supabase project, set the production Site URL to the
platform domain and add this redirect URL:

```text
https://<platform-domain>/auth/confirm
```

Keep the exact callback for every local port used by the development server,
for example `http://localhost:3000/auth/confirm` and
`http://127.0.0.1:4173/auth/confirm`. Local login links return to the origin
where they were requested; production links always use `APP_URL`. Test one
passwordless email sign-in after the domain is configured: it must finish at
`/workspace`.

## Release checks

1. Create a new account with an email link.
2. Create a project and upload a non-sensitive IFC and QTO CSV.
3. Open **IFC 속성 보기** and confirm a selected element shows its raw IFC
   properties.
4. Confirm another unauthenticated browser cannot open the project URL.
5. Create a read-only share link and a review share link, then confirm the
   active `lukas-qto-share` Edge Function never returns original file bytes.
6. Open `/news`, `/news.xml`, and each published company update.
7. Confirm `/download` shows **0원** and does not request payment information.
8. Download the ZIP and independently compare its SHA-256 with the value shown
   on the page. If the URL and hash are not both configured, the button must stay disabled.
9. Submit `/inquiry` and confirm a `hangil_staff` account can update it at
   `/staff/inquiries`, while a customer account cannot open that route.
10. Confirm an anonymous Supabase Auth session cannot read or create customer
    projects even though it uses the PostgreSQL `authenticated` role.
11. Apply `0010_material_control_pilot.sql`, open a project’s **자재·발주·입고 관리**,
    and record one concrete plan, purchase order, partial receipt and invoice evidence.
12. Confirm receipt/invoice insertion fails without an immutable evidence file and
    another customer cannot read the material plan, transaction or carbon-factor rows.

## Drawing collaboration deployment order

Apply the drawing collaboration release in this order:

1. Record the current schema and production deployment ID.
2. Apply the additive drawing migrations in filename order.
3. Confirm all `lukas_drawing_*` tables have RLS enabled and authenticated grants
   match the least-privilege migration.
4. Confirm only issues, comments, and events are members of `supabase_realtime`.
5. Run `node --test tests/*.test.mjs`, `npm run build`, and the IFC geometry smoke.
6. Deploy to Vercel production and verify public 200 responses plus protected-route
   redirects.
7. Run the disposable four-role Playwright flow against production with a real,
   non-logged `SUPABASE_SERVICE_ROLE_KEY`:
   `E2E_BASE_URL=https://lukas-qto-platform.vercel.app npx playwright test e2e/drawing-collaboration.spec.ts --project=chromium`.
8. Complete the two-user desktop/mobile checklist in
   `../docs/DRAWING_COLLABORATION_FIELD_CHECK.md`.

Useful verification queries:

```sql
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename like 'lukas_drawing_%'
order by tablename;

select c.relname, c.relrowsecurity, c.relacl
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname like 'lukas_drawing_%'
  and c.relkind = 'r'
order by c.relname;
```

Do not mark the drawing room complete from build output alone. Production maker,
reviewer, viewer, and non-member behavior must be verified by database enforcement,
and two real users must complete the field flow.

## Drawing Workspace P3 collaboration database

The P3 state migration creates `lukas_drawing_collaboration` as a
`NOLOGIN NOINHERIT` database role. After applying the migration, create or rotate
a separate `LOGIN NOINHERIT` runtime role through the deployment secret manager,
then grant it membership in only `lukas_drawing_collaboration`. Never commit its
password or place its database URL in a `VITE_*` variable. The collaboration
service must not use the Supabase service-role key.

As the database operator, grant the generated login only the dedicated role
after its password has been installed out of band:

```sql
grant lukas_drawing_collaboration to "<runtime-login>";
```

Membership does not activate the dedicated privileges on the runtime session.
Every newly opened physical pool connection must execute
`SET ROLE lukas_drawing_collaboration` before calling a private collaboration
function. A per-request transaction may instead use
`SET LOCAL ROLE lukas_drawing_collaboration`; it must do so in every transaction.
Do not rely on a one-time statement issued through an arbitrary pooled checkout.
`RESET ROLE` before returning a connection that may be reused outside the
collaboration service.

Before deploying the collaboration service, connect as the runtime login and
verify the inactive session, explicit role transition, and active function grant.
Replace `<runtime-login>` only in the operator session; never paste its password
into the runbook:

```sql
select rolname, rolcanlogin, rolinherit
from pg_roles
where rolname in ('lukas_drawing_collaboration', '<runtime-login>')
order by rolname;

select session_user, current_user,
  has_function_privilege(
    current_user,
    'private.lukas_drawing_collaboration_load_state(uuid,uuid,uuid)',
    'execute'
  ) as can_load_before_set_role;

set role lukas_drawing_collaboration;

select session_user, current_user,
  has_function_privilege(
    current_user,
    'private.lukas_drawing_collaboration_load_state(uuid,uuid,uuid)',
    'execute'
  ) as can_load_after_set_role;

reset role;

select grantee, routine_schema, routine_name, privilege_type
from information_schema.role_routine_grants
where routine_name like 'lukas_drawing_collaboration_%'
order by routine_schema, routine_name, grantee;

select has_table_privilege(
  'authenticated',
  'private.lukas_drawing_collaboration_states',
  'select'
) as authenticated_can_read_private_state;
```

The dedicated role must report `rolcanlogin = false` and `rolinherit = false`;
the runtime login must report `rolinherit = false`. Before `SET ROLE`, the
function check must be false. After it, `current_user` must be
`lukas_drawing_collaboration` and the function check must be true. Private service
functions must be executable only through that active role; the table check must
remain false because the service writes only through bounded functions. Confirm
stored `byte_size` and `yjs_sha256` match the exact `yjs_state` bytes and preserve
the returned `store_generation` plus SHA as the CAS token for the next store.
On `P3S03`, reload, merge, and retry; never resubmit stale full-state bytes with a
guessed token. No collaboration-state table may appear in `supabase_realtime`.
Only the public invalidation tables listed by the workspace Realtime adapter may
be added to that publication. The migration never changes the locked `realtime`
schema.

Run the real transaction-snapshot gate only against a disposable PostgreSQL
fixture where the actor already owns or edits the project:

```sh
P3_POSTGRES_CONCURRENCY_DATABASE_URL=<secret-test-database-url> \
P3_POSTGRES_ACTOR_ID=<fixture-user-uuid> \
P3_POSTGRES_PROJECT_ID=<fixture-project-uuid> \
node --test tests/drawing-workspace-p3-postgres-concurrency.test.mjs
```

The test holds a `REPEATABLE READ` reader transaction, commits a valid Drawing
operation from a second connection, proves the public and service bootstraps are
identical inside the reader snapshot, then proves a new transaction observes the
committed sequence. Missing fixture variables are reported as `UNEXECUTED`.

## Drawing Workspace P3 release runbook

P3 is a two-process release: the React Router application and the Node 22
Hocuspocus collaboration service. Run the following stages in order. A failed
stage stops promotion; it does not authorize skipping ahead.

### 1. Backup and snapshot

Record the managed backup identifier, current application and collaboration
image digests, and the current migration list in the release record. Capture a
schema-only snapshot before applying anything:

```sh
mkdir -p release-evidence/p3
npx supabase migration list --linked > release-evidence/p3/migrations-before.txt
npx supabase db dump --linked \
  --file release-evidence/p3/schema-before.sql
shasum -a 256 release-evidence/p3/schema-before.sql
```

The managed backup identifier comes from the approved Supabase backup workflow;
the local schema dump is not a database backup. Record representative PDF and
IFC database SHA-256, downloaded-byte SHA-256, and byte size without storing the
customer bytes in release evidence.

### 2. Asymmetric JWKS preflight

The service accepts only a non-empty asymmetric Supabase JWKS containing RS256
RSA or ES256 EC signing keys. This secret-free preflight must return `true`:

```sh
curl -fsS "${SUPABASE_URL%/}/auth/v1/.well-known/jwks.json" \
  | jq -e '.keys | type == "array" and any(.[];
      (.alg == "RS256" and .kty == "RSA") or
      (.alg == "ES256" and .kty == "EC"))'
```

An empty JWKS or an HS256-only project is fail-closed and remains
`UNEXECUTED`; do not deploy the service with a legacy shared JWT secret as a
substitute.

Signing-key rotation is reversible until the final retirement step. Execute and
record this exact sequence:

1. In Supabase Auth, **create asymmetric standby key** and record its exact
   `NEW_KID`; do not rotate it yet.
2. Poll the discovery endpoint from the same network path as every service
   replica until the **new kid** is visible on every path. For a container
   rollout, run this for every ID in `COLLABORATION_REPLICA_IDS`:

   ```sh
   for replica in $COLLABORATION_REPLICA_IDS; do
     docker exec -e SUPABASE_URL -e NEW_KID "$replica" node -e '
       fetch(process.env.SUPABASE_URL.replace(/\/$/, "") +
         "/auth/v1/.well-known/jwks.json")
         .then(r => { if (!r.ok) throw new Error("JWKS unavailable"); return r.json() })
         .then(j => { if (!j.keys?.some(k => k.kid === process.env.NEW_KID))
           throw new Error("standby kid absent") })
     '
   done
   ```

3. Only after every probe passes, **rotate the signing key** so the standby key
   becomes current. If any later check fails before retirement, restore the
   previous key as current and stop the release.
4. Complete a new login/refresh and obtain a **fresh access token**. Decode only
   its JOSE header locally and require its `kid` to equal `NEW_KID`; never print
   the token:

   ```sh
   P3_JWKS_FRESH_ACCESS_TOKEN="$P3_JWKS_FRESH_ACCESS_TOKEN" \
   NEW_KID="$NEW_KID" node -e '
     const h = JSON.parse(Buffer.from(process.env.P3_JWKS_FRESH_ACCESS_TOKEN
       .split(".")[0], "base64url"));
     if (h.kid !== process.env.NEW_KID) process.exit(1)
   '
   ```

5. Configure each process with a unique, non-secret
   `COLLABORATION_INSTANCE_ID`, then send `SIGHUP` to **purge each replica**
   JWKS cache. `/healthz` is an additional database/readiness check, not key
   proof.
6. Set `P3_COLLABORATION_REPLICAS_JSON` to a JSON array containing the unique,
   non-secret `id`, direct `wss://` `websocketUrl`, and direct `https://`
   `healthUrl` for every listed replica. Load-balancer or shared ingress URLs are
   forbidden. Set `P3_JWKS_NEW_KID="$NEW_KID"`, then run
   `npm run smoke:drawing-collaboration:production`. The smoke iterates the list,
   verifies that the fresh token header equals `NEW_KID`, completes
   **authenticated room admission on every replica**, and reads the configured
   instance ID from both the direct `/healthz` boundary and the authenticated
   admission message. Both observed IDs must equal each other and the inventory
   `id`; duplicate input IDs, WSS URLs, HTTPS health URLs, or observed process
   IDs fail closed. The smoke records the admission-observed ID as a Playwright
   annotation. A missing, duplicate, indirect, aliased, or unadmitted replica
   restores the previous current key and leaves admission closed.
7. Keep the previous key valid for the configured **access-token lifetime plus the safety margin**.
   Set and record `JWT_EXP_SECONDS` and a minimum
   `JWKS_SAFETY_MARGIN_SECONDS=900`; do not shorten the interval because the
   discovery endpoint or service cache appeared fast once.
8. After that interval and another fresh-token admission pass on every replica,
   **revoke the previous key**. Revocation before all evidence above exists is a
   release failure.

Restore the previous key as current if any pre-retirement probe fails; because
the previous key remains valid through the safety window, this recovery does not
require accepting an unverified signing key.

### 3. Collaboration login

Create a dedicated `LOGIN NOINHERIT` role in the database operator session. Use
psql `\password` so the generated password is prompted for rather than copied
into shell history, then store the resulting database URL only as the service's
`COLLABORATION_DATABASE_URL` secret:

```sql
create role "lukas_drawing_collaboration_runtime" login noinherit;
grant lukas_drawing_collaboration
  to "lukas_drawing_collaboration_runtime";
\password "lukas_drawing_collaboration_runtime"
```

The shipped postgres adapter executes
`SET LOCAL ROLE lukas_drawing_collaboration` inside every service transaction,
so the transaction end resets it. If a deployment adapter instead activates the
role once per fresh physical connection with
`SET ROLE lukas_drawing_collaboration`, it must use `RESET ROLE` before returning
that connection to a differently scoped pool. Never issue a one-time `SET ROLE`
through an arbitrary pooled checkout. Provision separate random values of at
least 32 characters for `COLLABORATION_INTERNAL_SECRET` and
`COLLABORATION_FREEZE_SECRET`. Never reuse either value or expose them through a
`VITE_*` variable.

### 4. Additive migrations and types

Review the linked diff, apply migrations in filename order, snapshot the applied
list, and generate types. Applied files are immutable; corrections are new
forward-fix migrations.

```sh
npx supabase db diff --linked
npx supabase db push --linked --include-all
npx supabase migration list --linked > release-evidence/p3/migrations-after.txt
SUPABASE_PROJECT_REF="$SUPABASE_PROJECT_REF" npm run db:typegen
git diff -- database.types.ts
```

The P3 migration range in this release begins at
`20260825192113_drawing_workspace_p3_collaboration_state.sql` and ends at
`20260826073708_drawing_workspace_p3_preload_store_fence.sql`; the complete
ordered list from `migrations-after.txt`, rather than that range alone, is the
deployment authority.

Run these copy-pastable verification queries as an operator. They expose no
secret values:

```sql
-- Publication: the exact P3-relevant set; this must return zero rows.
with expected(schemaname, tablename) as (values
  ('public', 'lukas_drawing_revisions'),
  ('public', 'lukas_drawing_object_issue_links'),
  ('public', 'lukas_drawing_issues'),
  ('public', 'lukas_drawing_issue_comments'),
  ('public', 'lukas_drawing_issue_events'),
  ('public', 'lukas_drawing_issue_approvals'),
  ('public', 'lukas_qto_project_members'),
  ('public', 'lukas_drawing_comment_mentions'),
  ('public', 'lukas_drawing_canvas_region_anchors')
), actual as (
  select schemaname::text, tablename::text
  from pg_catalog.pg_publication_tables
  where pubname = 'supabase_realtime'
    and (schemaname = 'private'
         or tablename like 'lukas_drawing_%'
         or tablename = 'lukas_qto_project_members')
)
select case
    when e.tablename is null then 'unexpected publication'
    else 'missing publication'
  end as violation,
  coalesce(e.schemaname, a.schemaname) as schemaname,
  coalesce(e.tablename, a.tablename) as tablename
from expected e
full join actual a using (schemaname, tablename)
where e.tablename is null or a.tablename is null
order by schemaname, tablename;

-- Dedicated roles.
select rolname, rolcanlogin, rolinherit
from pg_catalog.pg_roles
where rolname in (
  'lukas_drawing_collaboration',
  'lukas_drawing_collaboration_runtime'
)
order by rolname;

-- Exact routine/table/default ACL: this must return zero rows.
-- BEGIN P3 ACL AUDIT
with expected_routine(proname, argument_types) as (values
  ('lukas_drawing_collaboration_authorize',
    'uuid, uuid, uuid'),
  ('lukas_drawing_collaboration_load_state',
    'uuid, uuid, uuid'),
  ('lukas_drawing_collaboration_store_state',
    'uuid, uuid, uuid, smallint, bytea, bigint, bigint, text'),
  ('lukas_drawing_collaboration_lookup_operations',
    'uuid, uuid[]'),
  ('lukas_drawing_collaboration_bootstrap',
    'uuid, uuid, uuid'),
  ('lukas_drawing_collaboration_service_load_state',
    'uuid, uuid'),
  ('lukas_drawing_collaboration_service_store_state',
    'uuid, uuid, smallint, bytea, bigint, bigint, text'),
  ('lukas_drawing_collaboration_service_bootstrap',
    'uuid, uuid'),
  ('lukas_drawing_collaboration_read_freeze',
    'uuid, uuid'),
  ('lukas_drawing_collaboration_acquire_freeze_lease',
    'uuid, uuid, uuid, uuid, integer, bytea, bigint'),
  ('lukas_drawing_collaboration_renew_freeze_lease',
    'uuid, uuid, uuid, uuid, integer'),
  ('lukas_drawing_collaboration_release_freeze_lease',
    'uuid, uuid, uuid, uuid'),
  ('lukas_drawing_collaboration_begin_freeze',
    'uuid, uuid, uuid, bytea, bigint, uuid'),
  ('lukas_drawing_collaboration_complete_freeze',
    'uuid, uuid, uuid, bytea, jsonb, text, integer, bigint, text, jsonb, uuid'),
  ('lukas_drawing_collaboration_release_freeze',
    'uuid, uuid, uuid, bytea, uuid'),
  ('lukas_drawing_collaboration_sync_released_state',
    'uuid, uuid, uuid, bytea, uuid')
), collaboration_role as (
  select oid from pg_catalog.pg_roles
  where rolname = 'lukas_drawing_collaboration'
), routines as (
  select p.oid, p.proowner, p.proname,
    pg_catalog.oidvectortypes(p.proargtypes) as argument_types,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    coalesce(
      p.proacl,
      pg_catalog.acldefault('f', p.proowner)
    ) as effective_acl
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname like 'lukas_drawing_collaboration_%'
), routine_acl as (
  select r.*, x.grantee, x.privilege_type, x.is_grantable,
    coalesce(g.rolname, 'PUBLIC') as grantee_name
  from routines r
  cross join lateral pg_catalog.aclexplode(r.effective_acl) x
  left join pg_catalog.pg_roles g on g.oid = x.grantee
), expected_binding as (
  select e.*, r.oid, r.identity_arguments,
    exists (
      select 1 from routine_acl a, collaboration_role c
      where a.oid = r.oid and a.grantee = c.oid
        and a.privilege_type = 'EXECUTE' and not a.is_grantable
    ) as exact_grant_present
  from expected_routine e
  left join routines r using (proname, argument_types)
), routine_violation as (
  select 'missing dedicated routine grant'::text as violation,
    e.proname as object_name,
    coalesce(e.identity_arguments, e.argument_types) as identity_arguments,
    'lukas_drawing_collaboration'::text as grantee_name
  from expected_binding e
  where e.oid is null or not e.exact_grant_present
  union all
  select 'forbidden routine grant', a.proname,
    a.identity_arguments, a.grantee_name
  from routine_acl a
  left join expected_routine e
    on e.proname = a.proname and e.argument_types = a.argument_types
  left join collaboration_role c on true
  where a.privilege_type = 'EXECUTE'
    and a.grantee <> a.proowner
    and (a.grantee <> c.oid or e.proname is null or a.is_grantable)
), protected_table as (
  select c.oid, c.relowner, c.relname,
    coalesce(
      c.relacl,
      pg_catalog.acldefault('r', c.relowner)
    ) as effective_acl
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private'
    and c.relname in (
      'lukas_drawing_collaboration_states',
      'lukas_drawing_collaboration_freeze_leases'
    )
), table_violation as (
  select 'forbidden table grant'::text as violation,
    t.relname as object_name, null::text as identity_arguments,
    coalesce(g.rolname, 'PUBLIC') as grantee_name
  from protected_table t
  cross join lateral pg_catalog.aclexplode(t.effective_acl) x
  left join pg_catalog.pg_roles g on g.oid = x.grantee
  where x.grantee <> t.relowner
), object_owner(role_oid) as (
  select proowner from routines
  union
  select relowner from protected_table
), default_scope(role_oid, schema_oid, object_type) as (
  select o.role_oid, n.oid, k.object_type
  from object_owner o
  cross join pg_catalog.pg_namespace n
  cross join (values ('f'::"char"), ('r'::"char")) k(object_type)
  where n.nspname = 'private'
), effective_default_acl as (
  select s.*,
    coalesce(
      global_acl.defaclacl,
      pg_catalog.acldefault(s.object_type, s.role_oid)
    ) || coalesce(
      schema_acl.defaclacl,
      '{}'::pg_catalog.aclitem[]
    ) as effective_acl
  from default_scope s
  left join pg_catalog.pg_default_acl global_acl
    on global_acl.defaclrole = s.role_oid
    and global_acl.defaclnamespace = 0
    and global_acl.defaclobjtype = s.object_type
  left join pg_catalog.pg_default_acl schema_acl
    on schema_acl.defaclrole = s.role_oid
    and schema_acl.defaclnamespace = s.schema_oid
    and schema_acl.defaclobjtype = s.object_type
), default_acl_violation as (
  select 'forbidden default ACL'::text as violation,
    case d.object_type when 'f' then 'function' else 'table' end as object_name,
    null::text as identity_arguments,
    coalesce(g.rolname, 'PUBLIC') as grantee_name
  from effective_default_acl d
  cross join lateral pg_catalog.aclexplode(d.effective_acl) x
  left join pg_catalog.pg_roles g on g.oid = x.grantee
  where x.grantee <> d.role_oid
)
select * from routine_violation
union all select * from table_violation
union all select * from default_acl_violation
order by violation, object_name, identity_arguments, grantee_name;
-- END P3 ACL AUDIT

-- Stored-byte integrity, lease ownership, and freeze boundaries.
select revision_id, freeze_state, freeze_request_id,
  accepted_manifest_sha256, accepted_operation_count,
  frozen_base_operation_sequence, review_committed_at,
  freeze_owner_token is not null as freeze_owner_present,
  freeze_owner_request_id,
  freeze_owner_lease_expires_at,
  byte_size = pg_catalog.octet_length(yjs_state) as byte_size_valid,
  yjs_sha256 = pg_catalog.encode(
    extensions.digest(yjs_state, 'sha256'), 'hex'
  ) as yjs_sha_valid
from private.lukas_drawing_collaboration_states
order by revision_id;

select l.revision_id, l.request_id, l.subject_revision_version,
  l.lease_expires_at,
  l.lease_expires_at > pg_catalog.clock_timestamp() as lease_live,
  s.freeze_owner_token = l.owner_token as owner_matches,
  s.freeze_owner_request_id = l.request_id as request_matches
from private.lukas_drawing_collaboration_freeze_leases l
join private.lukas_drawing_collaboration_states s
  on s.revision_id = l.revision_id and s.project_id = l.project_id
order by l.revision_id;
```

The publication and ACL violation queries must both return zero rows. The ACL
query expands `PUBLIC` and built-in defaults with `acldefault`/`aclexplode`,
checks owner-specific global/private `pg_default_acl`, includes
`pg_get_function_identity_arguments` in every routine finding, and accepts only
the 16 exact dedicated-role signatures above. `PUBLIC`, `anon`, `authenticated`,
`service_role`, `lukas_drawing_collaboration_runtime`, and every other non-owner
role must have no direct private-table privilege and no forbidden direct routine
execute privilege. The dedicated role is `NOLOGIN NOINHERIT`; the runtime role
is `LOGIN NOINHERIT` and reaches the allowlist only after the explicit role
transition. Any false byte/hash check, mismatched owner/request pair, or
unexpected expired in-flight lease stops the release for investigation.

### 5. Collaboration image

Build the minimal Node 22 image from `platform`, record its immutable digest,
push that exact digest, and initially run one replica:

```sh
docker build --pull -f collaboration/Dockerfile \
  -t "$COLLABORATION_IMAGE" .
docker push "$COLLABORATION_IMAGE"
docker image inspect "$COLLABORATION_IMAGE" \
  --format '{{index .RepoDigests 0}}'
```

The image must retain the non-root user, one exposed port, healthcheck, and
minimal collaboration-only manifest. The initial release is capped at exactly one replica.
The Postgres lease protects freeze ownership only; it does not
broadcast Yjs updates or Awareness. Ordinary sticky sessions are not sufficient
because two clients for one room can still land on different instances.

Do not remove the cap until either (a) deterministic canonical-room affinity
routes every connection for one room to the same healthy instance and documents
failover without split-room admission, or (b) an implemented shared Yjs/Awareness broadcast
transport converges document and presence state across
instances. The scale-up gate also requires a multi-replica two-client smoke that
proves bidirectional Yjs and Awareness reflection during normal operation and
instance failover. Cross-instance freeze-lease tests alone do not satisfy it.

### 6. Service smoke

Start the exact pushed image with its secret-manager bindings and allowed app
origin. The smoke creates and cleans a disposable fixture in the target Supabase
project and requires real editor/non-member tokens, WebSocket storage, internal
endpoints and operator lifecycle commands. It returns nonzero unless authenticated admission,
non-member rejection, store/reload, outcome receipt, freeze/release, restart and
SIGTERM drain all complete:

```sh
E2E_BASE_URL="$E2E_BASE_URL" \
SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
VITE_DRAWING_COLLABORATION_URL="$VITE_DRAWING_COLLABORATION_URL" \
COLLABORATION_INTERNAL_URL="$COLLABORATION_INTERNAL_URL" \
COLLABORATION_INTERNAL_SECRET="$COLLABORATION_INTERNAL_SECRET" \
COLLABORATION_FREEZE_SECRET="$COLLABORATION_FREEZE_SECRET" \
P3_E2E_DATABASE_ADMIN_URL="$P3_E2E_DATABASE_ADMIN_URL" \
P3_E2E_RUN_ID="$P3_E2E_RUN_ID" \
P3_COLLABORATION_SIGTERM_COMMAND_JSON="$P3_COLLABORATION_SIGTERM_COMMAND_JSON" \
P3_COLLABORATION_RESTART_COMMAND_JSON="$P3_COLLABORATION_RESTART_COMMAND_JSON" \
P3_COLLABORATION_REPLICAS_JSON="$P3_COLLABORATION_REPLICAS_JSON" \
P3_JWKS_NEW_KID="$P3_JWKS_NEW_KID" \
npm run smoke:drawing-collaboration:production
```

The service process must receive a unique, non-secret
`COLLABORATION_INSTANCE_ID` matching the `id` assigned to that same direct
target in `P3_COLLABORATION_REPLICAS_JSON`. It is returned by `/healthz` and by
the stateless `1hk-collaboration-admission` message sent only after authenticated
room admission.

Each lifecycle variable is a JSON string array whose first item is the approved
orchestrator executable and whose remaining items are arguments. The SIGTERM
command must signal the exact smoke replica and wait for graceful Hocuspocus
flush/drain; the restart command must start the exact image digest. The smoke
waits for `/healthz` itself after each restart and suppresses lifecycle command
output. Do not put secrets in command arguments or output.

`P3_COLLABORATION_REPLICAS_JSON` is the release inventory, for example
`[{"id":"collab-a","websocketUrl":"wss://collab-a.internal.example/ws","healthUrl":"https://collab-a.internal.example/healthz"}]`.
Every listed direct target must admit the fresh `P3_JWKS_NEW_KID` token in the
first serial smoke test. Retain the non-secret `jwks-replica-admission`
annotations containing the admission-observed instance IDs. Before old-key
retirement, compare the health-observed ID, authenticated-admission-observed ID,
and inventory ID for every target, and reject duplicate observed IDs that expose
two inventory entries aliasing the same process. One shared ingress admission is
never sufficient.

The endpoint contracts are intentionally different:

- `/internal/outcomes` uses **HMAC-SHA-256** over the exact UTF-8 request body
  with `COLLABORATION_INTERNAL_SECRET`; the lowercase hexadecimal MAC is sent in
  `x-1hk-signature` and compared in constant time.
- `/internal/freeze` does not use HMAC. It sends the raw
  `COLLABORATION_FREEZE_SECRET` as a constant-time compared bearer secret in
  `x-1hk-freeze-secret` over the private service network.

The smoke reconnects after restart and after SIGTERM drain to prove the accepted
operation/status survived store/reload. A missing/masked variable, failed
non-member denial, lifecycle command, persistence boundary, cleanup, or endpoint
response is `UNEXECUTED`/failure, never PASS. Record only the command exit status,
fixture cleanup result and non-secret IDs; do not log tokens, database URLs, Yjs
bytes, internal secrets, or source hashes.

### 7. Application preview

Deploy an application preview configured with the exact collaboration WebSocket
and internal service URLs. Verify login, blank/PDF workspace hydration, Editor
mutation, Viewer read-only behavior, reconnect recovery, comments/history, review
freeze, PDF/IFC byte invariance, quantity lineage, existing IFC/PDF review, Revit
download, and no browser exposure of service/database secrets.

### 8. P3 production fixture

Run the fail-closed disposable fixture only when every real authority is present:

```sh
E2E_BASE_URL="$E2E_BASE_URL" \
SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
VITE_DRAWING_COLLABORATION_URL="$VITE_DRAWING_COLLABORATION_URL" \
COLLABORATION_INTERNAL_URL="$COLLABORATION_INTERNAL_URL" \
COLLABORATION_INTERNAL_SECRET="$COLLABORATION_INTERNAL_SECRET" \
COLLABORATION_FREEZE_SECRET="$COLLABORATION_FREEZE_SECRET" \
P3_E2E_DATABASE_ADMIN_URL="$P3_E2E_DATABASE_ADMIN_URL" \
P3_E2E_RUN_ID="$P3_E2E_RUN_ID" \
npm run test:e2e:drawing-workspace-p3:production
```

Retain the generated owner/editor/reviewer/viewer/nonmember results, three-browser
warm reflection p95, exact 100-operation offline recovery set, conflict winner,
review/approval/frozen denial, restored child draft, source before/after hashes,
quantity lineage, and cleanup. This fixture does not change deployment images and
does not exercise deployment recovery. Missing or masked authorities make the
entire production fixture `UNEXECUTED`; they never become local PASS.

### 9. Operator rollback rehearsal

Run this as a separate operator-controlled gate against the isolated release
environment; the production fixture above is not its substitute. **Stop new room admission**,
record frozen and in-flight rooms, flush and await Hocuspocus
persistence, gracefully drain WebSockets, and promote the previous compatible
application and collaboration image digests without a down migration. Verify
that the additive database state, accepted operations, snapshots, source bytes,
freeze state, and rejected-draft recovery remain authoritative. Run health,
authenticated/non-member, store/reload, freeze/release, source-invariance, and
two-user checks on those previous images. Restore the candidate's exact tested
digests, repeat those checks, and reopen admission only after both recovery
directions pass. Retain orchestrator events, image digests, room recovery
results, command exit statuses, and cleanup result; never record secrets.

Any incomplete direction is a failed or `UNEXECUTED` rehearsal. A document-only
walkthrough, the Stage 8 fixture, or the general recovery procedure below is not
operator rollback evidence.

### 10. Promote

Promote the already-tested app and collaboration image digests only after the
production fixture and two-user field checklist both pass. Record deployment and
image IDs, migration list, type diff, source hashes, browser/OS/viewport,
CPU/memory conditions, object mix, cold/warm annotation, p95, offline loss count,
role denials, cleanup, and the separate Stage 9 rollback rehearsal. P3 is not
operationally complete until those deployed records exist.

### P3 rollback and recovery

1. Stop new room admission at the ingress, while keeping health visibility for
   existing instances.
2. Stop application mutations, flush and await Hocuspocus persistence, then
   gracefully drain WebSockets. Record rooms that remain frozen or in-flight.
3. Retain additive database state and the Postgres operation/snapshot authority.
   Never delete collaboration rows, accepted operations, review evidence,
   approved snapshots, or immutable sources to make rollback appear clean.
4. Roll back the application and collaboration service images to their last
   known compatible digests. Do not run a down migration.
5. Repair schema or data behavior only with a reviewed forward-fix migration.
   Backup restore is allowed only through the approved incident procedure after
   proving how post-backup customer writes will be preserved.
6. For a frozen in-flight room, inspect the persisted freeze state and lease. A
   live owner finishes or releases it; only an expired lease may be taken over.
   A committed review stays frozen. A rejected review must reconcile to a
   released draft before admission; rejected offline operations remain
   exportable/recoverable and are never injected into the frozen revision.
7. Re-run health, auth, storage, freeze, role, source-invariance and two-user
   smoke before reopening admission. Record an unsuccessful recovery as failed,
   not as a rollback pass.

## Drawing Workspace P4 coordinated release gate

P4 keeps the web application and the single-replica collaboration service as a
coordinated release. Build both artifacts, run `npm run
release:drawing-workspace-p4:local`, deploy the collaboration image first, run
its authenticated health/admission/store/freeze smoke, then deploy the web
preview against that exact WebSocket/internal endpoint. Run the fail-closed
hosted fixture only with all P3/P4 app, Supabase, collaboration, database, and
run-identity authorities:

```sh
npm run release:drawing-workspace-p4:production
```

Missing, masked, loopback, or placeholder authorities exit nonzero as `P4
production gate is UNEXECUTED` before Playwright or a local server starts. A
local P4 result cannot satisfy hosted organization membership/RLS, provider
convergence, three-browser provider p95 `<= 500 ms`, approval freeze, deployed
source hashes, cleanup, or rollback evidence.

The production fixture first executes the P3 provider-authoritative gates (30
warm reflection samples, exact 100-operation offline recovery, role denial,
freeze/approval/child draft, immutable PDF/IFC, quantity/approval/Revit
regressions), then the hosted P4 semantic graph gate for wall/opening/space/area/
grid/arc, server `P4_MEASUREMENT_V1`, read-only schedules, draft-only editor
mutation, reviewer/viewer/nonmember denial, approved immutability, and source
re-read. It has no `test.skip` production path.

Rollback is forward-safe: stop new admission, flush and await Hocuspocus,
preserve operations/snapshots/approved evidence/source rows, drain the one
replica, and restore the previous compatible web and collaboration image pair.
Never down-migrate the P4 semantic constraints. Re-run health, authenticated and
nonmember admission, P4 semantic load/schedules/export, source hashes, and a
two-user reconnect before reopening admission. Record an incomplete direction
as failed or `UNEXECUTED`, never PASS.

## Drawing Workspace P0/P1 release runbook

The browser editor is an additive route. Keep the existing collaboration room
available throughout rollout and use it as the immediate product rollback path.

1. Take a database backup and a schema snapshot. Record the backup identifier,
   current migration list, application deployment ID, and the SHA-256 values of
   the representative immutable PDF and IFC files.
2. Apply every drawing workspace migration in filename order. Never edit an
   already-applied migration; ship an additive forward-fix migration instead.
3. Run `npm run db:typegen` with `SUPABASE_PROJECT_REF` and commit/review the
   generated database type diff before application promotion.
4. Run `npm run test:drawing-workspace`, `node --test tests/*.test.mjs`,
   `npm run test:ifc`, `npm run typecheck`, and `npm run build`.
   With no path argument, `test:ifc` requires network access and downloads the
   pinned public `examples/example.ifc` from `ThatOpen/engine_web-ifc` commit
   `3f6f3640b8317664194911fad63bcd407f7e32ca`, verifies its known SHA-256,
   runs the selectable/renderable geometry smoke, and removes the temporary
   bytes. The upstream fixture is provided under MPL-2.0. Offline or
   changed-source runs fail explicitly; they are never reported as skipped.
   A reviewer may instead run `npm run test:ifc -- /absolute/path/model.ifc`.
5. Deploy a Vercel preview. Smoke the PDF-backed and blank routes with an Editor,
   then confirm a Viewer has no mutation controls and receives a database
   rejection for an attempted mutation.
6. Run the isolated production fixture only against the intended preview or
   production target:

   ```sh
   E2E_BASE_URL=https://<target-domain> npm run test:e2e:drawing-workspace:production
   ```

   The process also requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY`. Never print their values. The fixture creates its
   own project/users/files and deletes the project cascade, Storage objects, and
   Auth users in dependency order while collecting every cleanup failure.

7. Promote only after the Editor/Viewer smoke, exact PDF/IFC SHA comparison,
   separate reviewer approval, and cleanup all pass. Record the Playwright browser,
   viewport, 10,000-object composition, 120-frame median/p95, and selection
   median/p95. The P0/P1 catastrophic threshold is 50 ms p95; 60fps remains an
   unachieved P7 optimization target.

If any required credential or target is absent, record this production gate as
`unexecuted`, never as passed. If application behavior regresses, route users back
to the existing collaboration room and roll back the application deployment. For
an applied additive database migration, prefer a reviewed forward-fix; restore the
backup only under the incident runbook after confirming no post-snapshot customer
writes would be lost. Approved revisions and immutable source-file rows must never
be directly rewritten during rollback.

## Drawing Workspace P2 release gate

Run this gate after P0/P1 and before promotion. First record a backup identifier,
schema snapshot identifier, current migration list, application deployment ID,
representative PDF SHA-256, and representative IFC SHA-256. The following
duplicate/invariant preflight must return no rows before migrations are applied:

```sql
select 'duplicate page order' as violation, revision_id::text as scope
from public.lukas_drawing_pages
group by revision_id, sort_order
having count(*) > 1
union all
select 'duplicate canvas order', page_id::text
from public.lukas_drawing_canvases
group by page_id, sort_order
having count(*) > 1
union all
select 'canvas without matching page', c.id::text
from public.lukas_drawing_canvases c
left join public.lukas_drawing_pages p on p.id = c.page_id
where p.id is null
union all
select 'layer without matching canvas', l.id::text
from public.lukas_drawing_layers l
left join public.lukas_drawing_canvases c on c.id = l.canvas_id
where c.id is null;
```

Apply pending migrations once, in filename order, without modifying any applied
migration. Run `npm run db:typegen` and review the generated type diff. Then run
`npm run test:drawing-workspace`, `node --test tests/*.test.mjs`,
`npm run test:ifc`, `npm run typecheck`, and `npm run build`; retain the pinned IFC
fixture SHA evidence. Deploy a preview and run the credential-free local Chromium
specs plus Editor, Reviewer, Viewer, and non-member smoke checks.

The production command is
`npm run test:e2e:drawing-workspace-p2:production`. Its spec fails closed unless
`E2E_BASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` are all real, unmasked values. Missing credentials are
recorded as **production unexecuted**, never skipped or passed, and secret values
must not be printed.

Promote only with the preflight result, backup/schema identifiers, migration and
typegen diffs, local command logs, preview evidence, production P2 Playwright
report, cleanup result, source hashes, and measured-target annotations attached to
the release. For application rollback, route users to the existing collaboration
room and restore the prior deployment. Database changes use an additive
**forward-fix**; a backup restore is an **incident-only** action after the incident
runbook proves that no post-snapshot customer writes will be lost.

## Commercial boundary

The current Revit field beta is a free download, not a zero-value card charge.
The unsafe scaffold checkout was removed. A paid release requires server-side
order creation, signed payment confirmation/webhooks, an entitlement bound to the
immutable release SHA-256, refund handling, and download access auditing.
