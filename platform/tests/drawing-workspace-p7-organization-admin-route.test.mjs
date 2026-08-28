import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ids = Object.freeze({
  organization: "75000000-0000-4000-8000-000000000001",
  member: "75000000-0000-4000-8000-000000000002",
  invitation: "75000000-0000-4000-8000-000000000003",
  project: "75000000-0000-4000-8000-000000000004",
  destination: "75000000-0000-4000-8000-000000000005",
  request: "75000000-0000-4000-8000-000000000006",
});

function form(entries) {
  const value = new FormData();
  for (const [key, item] of Object.entries(entries)) value.set(key, item);
  return value;
}

test("organization administration accepts stable bounded authority inputs only", async () => {
  const { parseOrganizationAdministrationForm } =
    await import("../app/lukas/lib/organization-administration.server.ts");
  assert.deepEqual(
    parseOrganizationAdministrationForm(
      form({
        intent: "invite_member",
        email: " Member@Example.com ",
        role: "member",
        library_access: "on",
        expires_in_days: "7",
        request_id: ids.request,
      }),
    ),
    {
      intent: "invite_member",
      email: "member@example.com",
      role: "member",
      libraryAccess: true,
      expiresInDays: 7,
      requestId: ids.request,
    },
  );
  assert.deepEqual(
    parseOrganizationAdministrationForm(
      form({
        intent: "set_entitlement",
        plan: "team",
        seat_limit: "12",
        project_limit: "25",
        library_version_limit: "100",
        trial_ends_at: "2026-09-30T00:00:00.000Z",
        drawing_workspace: "on",
        organization_library: "on",
        realtime_collaboration: "on",
        ifc_workspace: "on",
        quantity_lineage: "on",
        reason: "연간 계약",
        request_id: ids.request,
      }),
    ),
    {
      intent: "set_entitlement",
      plan: "team",
      seatLimit: 12,
      projectLimit: 25,
      libraryVersionLimit: 100,
      trialEndsAt: "2026-09-30T00:00:00.000Z",
      features: {
        drawing_workspace: true,
        organization_library: true,
        realtime_collaboration: true,
        ifc_workspace: true,
        quantity_lineage: true,
      },
      reason: "연간 계약",
      requestId: ids.request,
    },
  );
  assert.throws(
    () =>
      parseOrganizationAdministrationForm(
        form({
          intent: "change_member",
          user_id: ids.member,
          role: "owner",
          request_id: ids.request,
        }),
      ),
    /역할/,
  );
  assert.throws(
    () =>
      parseOrganizationAdministrationForm(
        form({
          intent: "move_project",
          project_id: ids.project,
          destination_organization_id: ids.destination,
          organization_id: ids.organization,
          request_id: ids.request,
        }),
      ),
    /허용되지 않은 필드/,
  );
});

test("every organization mutation binds the route organization into one exact RPC", async () => {
  const { runOrganizationAdministrationMutation } =
    await import("../app/lukas/lib/organization-administration.server.ts");
  const calls = [];
  const client = {
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data: {}, error: null });
    },
  };
  for (const mutation of [
    {
      intent: "change_member",
      userId: ids.member,
      role: "admin",
      libraryAccess: true,
      requestId: ids.request,
    },
    {
      intent: "revoke_invitation",
      invitationId: ids.invitation,
      reason: "잘못된 이메일",
      requestId: ids.request,
    },
    {
      intent: "move_project",
      projectId: ids.project,
      destinationOrganizationId: ids.destination,
      reason: "사업부 이동",
      requestId: ids.request,
    },
  ])
    await runOrganizationAdministrationMutation(
      client,
      ids.organization,
      mutation,
    );
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every((call) => call.args.p_organization_id === ids.organization),
  );
});

test("project features are revalidated from the exact project organization", async () => {
  const { assertProjectOrganizationFeature } =
    await import("../app/lukas/lib/organization-administration.server.ts");
  const calls = [];
  const client = {
    from(table) {
      assert.equal(table, "lukas_qto_projects");
      return {
        select(columns) {
          assert.equal(columns, "organization_id");
          return {
            eq(column, value) {
              calls.push({ column, value });
              return {
                maybeSingle: () =>
                  Promise.resolve({
                    data: { organization_id: ids.organization },
                    error: null,
                  }),
              };
            },
          };
        },
      };
    },
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data: false, error: null });
    },
  };
  await assert.rejects(
    assertProjectOrganizationFeature(client, ids.project, "ifc_workspace"),
    (error) => error instanceof Response && error.status === 403,
  );
  assert.deepEqual(calls, [
    { column: "id", value: ids.project },
    {
      name: "lukas_qto_organization_feature_enabled",
      args: {
        p_organization_id: ids.organization,
        p_feature: "ifc_workspace",
      },
    },
  ]);
});

test("organization administration is mounted and project membership no longer scans all users", () => {
  const routes = readFileSync(
    new URL("../app/routes.ts", import.meta.url),
    "utf8",
  );
  const screen = readFileSync(
    new URL("../app/lukas/screens/organization-settings.tsx", import.meta.url),
    "utf8",
  );
  const members = readFileSync(
    new URL("../app/lukas/screens/project-members.tsx", import.meta.url),
    "utf8",
  );
  assert.match(routes, /organizations\/:organizationId\/settings/);
  assert.match(routes, /organization-invitations\/:invitationId\/accept/);
  assert.match(screen, /회사 관리/);
  assert.match(screen, /좌석/);
  assert.match(screen, /기능 권한/);
  assert.doesNotMatch(screen, /checkout|payment|결제/i);
  assert.doesNotMatch(members, /listUsers/);
  assert.doesNotMatch(members, /do\s*\{/);
  assert.match(members, /lukas_qto_list_project_members/);
  assert.match(members, /lukas_qto_set_project_member/);
  assert.match(members, /p_after_user_id/);
  assert.match(screen, /memberAfter/);
  assert.match(screen, /invitationAfter/);
  assert.match(screen, /projectAfter/);
  assert.match(screen, /destinationAfter/);
  assert.match(screen, /lukas_qto_list_organization_invitations/);
  assert.match(screen, /lukas_qto_list_organization_projects/);
  assert.match(screen, /lukas_qto_list_managed_organizations/);
  assert.doesNotMatch(screen, /targetUserId|inviteUserByEmail/);
  assert.match(screen, /deliverOrganizationInvitationEmail/);
});

test("registered and unregistered invitation delivery uses one neutral fail-closed provider path", async () => {
  const { deliverOrganizationInvitationEmail } =
    await import("../app/lukas/lib/organization-administration.server.ts");
  const deliveries = [];
  const input = {
    email: "person@example.com",
    invitationId: ids.invitation,
    organizationName: "1HK",
    origin: "https://example.com",
  };
  await deliverOrganizationInvitationEmail(input, {
    apiKey: "test-key",
    send: async (message) => {
      deliveries.push(message);
      return { error: null };
    },
  });
  assert.equal(deliveries.length, 1);
  assert.deepEqual(deliveries[0].to, [input.email]);
  assert.match(deliveries[0].html, new RegExp(ids.invitation));
  await assert.rejects(
    deliverOrganizationInvitationEmail(input, {
      apiKey: "",
      send: async () => ({ error: null }),
    }),
    /delivery provider is unavailable/i,
  );
  await assert.rejects(
    deliverOrganizationInvitationEmail(input, {
      apiKey: "test-key",
      send: async () => ({ error: { message: "provider failed" } }),
    }),
    /provider failed/i,
  );
});

test("workspace dashboard hides organization administration from ordinary members", () => {
  const workspace = readFileSync(
    new URL("../app/lukas/screens/workspace.tsx", import.meta.url),
    "utf8",
  );
  const dashboard = readFileSync(
    new URL("../app/lukas/components/workspace-dashboard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(workspace, /owner_id/);
  assert.match(workspace, /can_manage/);
  assert.match(dashboard, /organization\.can_manage[\s\S]*회사 관리/);
});

test("organization invitations, projects, and destinations continue beyond 100 exact rows", async () => {
  const { loadOrganizationAdminPage } =
    await import("../app/lukas/lib/organization-administration.server.ts");
  const { organizationAdminPageHref } =
    await import("../app/lukas/lib/organization-administration.ts");
  const configurations = [
    {
      rpc: "lukas_qto_list_organization_invitations",
      cursorArgument: "p_after_invitation_id",
    },
    {
      rpc: "lukas_qto_list_organization_projects",
      cursorArgument: "p_after_project_id",
    },
    {
      rpc: "lukas_qto_list_managed_organizations",
      cursorArgument: "p_after_organization_id",
    },
  ];
  const rows = Array.from({ length: 101 }, (_, index) => ({
    id: `75000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  }));
  for (const configuration of configurations) {
    const calls = [];
    const client = {
      rpc(name, args) {
        assert.equal(name, configuration.rpc);
        calls.push(args);
        const after = args[configuration.cursorArgument];
        const offset =
          after === null ? 0 : rows.findIndex(({ id }) => id === after) + 1;
        return Promise.resolve({
          data: rows.slice(offset, offset + args.p_page_size),
          error: null,
        });
      },
    };
    const first = await loadOrganizationAdminPage(
      client,
      configuration.rpc,
      ids.organization,
      null,
    );
    const second = await loadOrganizationAdminPage(
      client,
      configuration.rpc,
      ids.organization,
      first.next,
    );
    assert.equal(first.rows.length, 100);
    assert.equal(second.rows.length, 1);
    assert.deepEqual(
      [...first.rows, ...second.rows].map(({ id }) => id),
      rows.map(({ id }) => id),
    );
    assert.equal(calls[1][configuration.cursorArgument], rows[99].id);
  }
  const projectPage = organizationAdminPageHref(ids.organization, {
    projectAfter: rows[99].id,
  });
  const combinedPage = organizationAdminPageHref(
    ids.organization,
    { projectAfter: rows[99].id },
    { destinationAfter: rows[99].id },
  );
  assert.equal(
    projectPage,
    `/organizations/${ids.organization}/settings?projectAfter=${rows[99].id}`,
  );
  assert.equal(
    combinedPage,
    `/organizations/${ids.organization}/settings?projectAfter=${rows[99].id}&destinationAfter=${rows[99].id}`,
  );
  const combinedSearch = new URL(combinedPage, "https://platform.local")
    .searchParams;
  const combinedClient = {
    rpc(name, args) {
      const cursorArgument =
        name === "lukas_qto_list_organization_projects"
          ? "p_after_project_id"
          : "p_after_organization_id";
      const offset =
        rows.findIndex(({ id }) => id === args[cursorArgument]) + 1;
      return Promise.resolve({
        data: rows.slice(offset, offset + args.p_page_size),
        error: null,
      });
    },
  };
  const [combinedProjects, combinedDestinations] = await Promise.all([
    loadOrganizationAdminPage(
      combinedClient,
      "lukas_qto_list_organization_projects",
      ids.organization,
      combinedSearch.get("projectAfter"),
    ),
    loadOrganizationAdminPage(
      combinedClient,
      "lukas_qto_list_managed_organizations",
      ids.organization,
      combinedSearch.get("destinationAfter"),
    ),
  ]);
  assert.deepEqual(combinedProjects.rows, [rows[100]]);
  assert.deepEqual(combinedDestinations.rows, [rows[100]]);
});

test("invitation login and magic-link preserve the exact safe acceptance return", () => {
  const acceptance = readFileSync(
    new URL(
      "../app/lukas/screens/organization-invitation-accept.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const login = readFileSync(
    new URL("../app/features/auth/screens/login-redirect.tsx", import.meta.url),
    "utf8",
  );
  const magicLink = readFileSync(
    new URL("../app/features/auth/screens/magic-link.tsx", import.meta.url),
    "utf8",
  );
  assert.match(acceptance, /login\?next=/);
  assert.match(login, /safeAuthNextPath/);
  assert.match(magicLink, /safeAuthNextPath/);
  assert.match(magicLink, /sendCrossBrowserMagicLink\([\s\S]*\bnext,/);
});

test("IFC and quantity lineage feature flags are revalidated by route actions and loaders", () => {
  const administration = readFileSync(
    new URL(
      "../app/lukas/lib/organization-administration.server.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const workspace = readFileSync(
    new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  const ifc = readFileSync(
    new URL("../app/lukas/screens/ifc-browser.tsx", import.meta.url),
    "utf8",
  );
  const verifiedBoq = readFileSync(
    new URL("../app/lukas/screens/verified-boq.tsx", import.meta.url),
    "utf8",
  );
  const materialControl = readFileSync(
    new URL("../app/lukas/screens/material-control.tsx", import.meta.url),
    "utf8",
  );
  assert.match(administration, /assertProjectOrganizationFeature/);
  assert.match(administration, /lukas_qto_organization_feature_enabled/);
  assert.match(
    workspace,
    /assertProjectOrganizationFeature[\s\S]*drawing_workspace/,
  );
  assert.match(
    workspace,
    /assertProjectOrganizationFeature[\s\S]*quantity_lineage/,
  );
  assert.match(
    workspace,
    /assertProjectOrganizationFeature[\s\S]*ifc_workspace/,
  );
  assert.match(ifc, /assertProjectOrganizationFeature[\s\S]*ifc_workspace/);
  assert.match(
    verifiedBoq,
    /assertProjectOrganizationFeature[\s\S]*quantity_lineage/,
  );
  assert.match(
    materialControl,
    /assertProjectOrganizationFeature[\s\S]*quantity_lineage/,
  );
});
