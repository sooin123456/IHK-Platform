import { z } from "zod";

import { resolveAuthOrigin } from "../../features/auth/lib/auth-link.server.ts";

export const ORGANIZATION_ADMIN_PAGE_SIZE = 100;

type OrganizationAdminListRpc =
  | "lukas_qto_list_organization_members"
  | "lukas_qto_list_organization_invitations"
  | "lukas_qto_list_organization_projects"
  | "lukas_qto_list_managed_organizations";

const organizationAdminCursors = {
  lukas_qto_list_organization_members: {
    argument: "p_after_user_id",
    field: "user_id",
  },
  lukas_qto_list_organization_invitations: {
    argument: "p_after_invitation_id",
    field: "id",
  },
  lukas_qto_list_organization_projects: {
    argument: "p_after_project_id",
    field: "id",
  },
  lukas_qto_list_managed_organizations: {
    argument: "p_after_organization_id",
    field: "id",
  },
} as const;

const uuid = z.string().uuid();
const requestId = uuid;
const reason = z.string().trim().min(1).max(1000);
const role = z.enum(["admin", "member"], {
  errorMap: () => ({ message: "관리 가능한 역할은 관리자 또는 구성원입니다." }),
});
const plan = z.enum(["legacy", "free", "team", "business", "enterprise"]);
const features = [
  "drawing_workspace",
  "organization_library",
  "realtime_collaboration",
  "ifc_workspace",
  "quantity_lineage",
] as const;

function values(form: FormData) {
  return Object.fromEntries(form.entries());
}

function exact(form: FormData, allowed: readonly string[]) {
  const unexpected = [...form.keys()].find((key) => !allowed.includes(key));
  if (unexpected) throw new Error(`허용되지 않은 필드: ${unexpected}`);
}

function checked(form: FormData, name: string) {
  return form.get(name) === "on";
}

export type OrganizationAdministrationMutation =
  | {
      intent: "update_settings";
      name: string;
      requestId: string;
    }
  | {
      intent: "invite_member";
      email: string;
      role: "admin" | "member";
      libraryAccess: boolean;
      expiresInDays: number;
      requestId: string;
    }
  | {
      intent: "revoke_invitation";
      invitationId: string;
      reason: string;
      requestId: string;
    }
  | {
      intent: "change_member";
      userId: string;
      role: "admin" | "member";
      libraryAccess: boolean;
      requestId: string;
    }
  | {
      intent: "remove_member";
      userId: string;
      reason: string;
      requestId: string;
    }
  | {
      intent: "move_project";
      projectId: string;
      destinationOrganizationId: string;
      reason: string;
      requestId: string;
    }
  | {
      intent: "set_entitlement";
      plan: "legacy" | "free" | "team" | "business" | "enterprise";
      seatLimit: number;
      projectLimit: number;
      libraryVersionLimit: number;
      trialEndsAt: string | null;
      features: Record<(typeof features)[number], boolean>;
      reason: string;
      requestId: string;
    };

export function parseOrganizationAdministrationForm(
  form: FormData,
): OrganizationAdministrationMutation {
  const intent = z.string().parse(form.get("intent"));
  if (intent === "update_settings") {
    exact(form, ["intent", "name", "request_id"]);
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(160),
        request_id: requestId,
      })
      .parse(values(form));
    return { intent, name: parsed.name, requestId: parsed.request_id };
  }
  if (intent === "invite_member") {
    exact(form, [
      "intent",
      "email",
      "role",
      "library_access",
      "expires_in_days",
      "request_id",
    ]);
    const parsed = z
      .object({
        email: z
          .string()
          .trim()
          .email()
          .transform((item) => item.toLowerCase()),
        role,
        expires_in_days: z.coerce.number().int().min(1).max(30),
        request_id: requestId,
      })
      .parse(values(form));
    return {
      intent,
      email: parsed.email,
      role: parsed.role,
      libraryAccess: checked(form, "library_access"),
      expiresInDays: parsed.expires_in_days,
      requestId: parsed.request_id,
    };
  }
  if (intent === "revoke_invitation") {
    exact(form, ["intent", "invitation_id", "reason", "request_id"]);
    const parsed = z
      .object({ invitation_id: uuid, reason, request_id: requestId })
      .parse(values(form));
    return {
      intent,
      invitationId: parsed.invitation_id,
      reason: parsed.reason,
      requestId: parsed.request_id,
    };
  }
  if (intent === "change_member") {
    exact(form, ["intent", "user_id", "role", "library_access", "request_id"]);
    const parsed = z
      .object({ user_id: uuid, role, request_id: requestId })
      .parse(values(form));
    return {
      intent,
      userId: parsed.user_id,
      role: parsed.role,
      libraryAccess: checked(form, "library_access"),
      requestId: parsed.request_id,
    };
  }
  if (intent === "remove_member") {
    exact(form, ["intent", "user_id", "reason", "request_id"]);
    const parsed = z
      .object({ user_id: uuid, reason, request_id: requestId })
      .parse(values(form));
    return {
      intent,
      userId: parsed.user_id,
      reason: parsed.reason,
      requestId: parsed.request_id,
    };
  }
  if (intent === "move_project") {
    exact(form, [
      "intent",
      "project_id",
      "destination_organization_id",
      "reason",
      "request_id",
    ]);
    const parsed = z
      .object({
        project_id: uuid,
        destination_organization_id: uuid,
        reason,
        request_id: requestId,
      })
      .parse(values(form));
    return {
      intent,
      projectId: parsed.project_id,
      destinationOrganizationId: parsed.destination_organization_id,
      reason: parsed.reason,
      requestId: parsed.request_id,
    };
  }
  if (intent === "set_entitlement") {
    exact(form, [
      "intent",
      "plan",
      "seat_limit",
      "project_limit",
      "library_version_limit",
      "trial_ends_at",
      "reason",
      "request_id",
      ...features,
    ]);
    const parsed = z
      .object({
        plan,
        seat_limit: z.coerce.number().int().min(1).max(100000),
        project_limit: z.coerce.number().int().min(1).max(100000),
        library_version_limit: z.coerce.number().int().min(0).max(1000000),
        trial_ends_at: z
          .string()
          .refine(
            (item) => item === "" || !Number.isNaN(Date.parse(item)),
            "체험 종료 시각을 확인하세요.",
          )
          .transform((item) => (item ? new Date(item).toISOString() : null)),
        reason,
        request_id: requestId,
      })
      .parse(values(form));
    return {
      intent,
      plan: parsed.plan,
      seatLimit: parsed.seat_limit,
      projectLimit: parsed.project_limit,
      libraryVersionLimit: parsed.library_version_limit,
      trialEndsAt: parsed.trial_ends_at,
      features: Object.fromEntries(
        features.map((feature) => [feature, checked(form, feature)]),
      ) as Record<(typeof features)[number], boolean>,
      reason: parsed.reason,
      requestId: parsed.request_id,
    };
  }
  throw new Error("지원하지 않는 작업입니다.");
}

type RpcClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

export type OrganizationFeature = (typeof features)[number];

type ProjectFeatureClient = RpcClient & {
  from(table: "lukas_qto_projects"): {
    select(columns: "organization_id"): {
      eq(
        column: "id",
        value: string,
      ): {
        maybeSingle(): PromiseLike<{
          data: { organization_id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

export async function projectOrganizationFeatureEnabled(
  client: ProjectFeatureClient,
  projectId: string,
  feature: OrganizationFeature,
) {
  const project = await client
    .from("lukas_qto_projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle();
  if (project.error || !project.data)
    throw new Response("프로젝트를 찾을 수 없습니다.", { status: 404 });
  const entitlement = await client.rpc(
    "lukas_qto_organization_feature_enabled",
    {
      p_organization_id: project.data.organization_id,
      p_feature: feature,
    },
  );
  return !entitlement.error && entitlement.data === true;
}

export async function assertProjectOrganizationFeature(
  client: ProjectFeatureClient,
  projectId: string,
  feature: OrganizationFeature,
) {
  if (!(await projectOrganizationFeatureEnabled(client, projectId, feature)))
    throw new Response("회사 플랜에서 이 기능을 사용할 수 없습니다.", {
      status: 403,
    });
}

export async function runOrganizationAdministrationMutation(
  client: RpcClient,
  organizationId: string,
  mutation: OrganizationAdministrationMutation,
) {
  let name: string;
  let args: Record<string, unknown>;
  switch (mutation.intent) {
    case "update_settings":
      name = "lukas_qto_update_organization_settings";
      args = { p_name: mutation.name, p_request_id: mutation.requestId };
      break;
    case "invite_member":
      name = "lukas_qto_invite_organization_member";
      args = {
        p_email: mutation.email,
        p_role: mutation.role,
        p_library_access: mutation.libraryAccess,
        p_expires_in_days: mutation.expiresInDays,
        p_request_id: mutation.requestId,
      };
      break;
    case "revoke_invitation":
      name = "lukas_qto_revoke_organization_invitation";
      args = {
        p_invitation_id: mutation.invitationId,
        p_reason: mutation.reason,
        p_request_id: mutation.requestId,
      };
      break;
    case "change_member":
      name = "lukas_qto_change_organization_member";
      args = {
        p_user_id: mutation.userId,
        p_role: mutation.role,
        p_library_access: mutation.libraryAccess,
        p_request_id: mutation.requestId,
      };
      break;
    case "remove_member":
      name = "lukas_qto_remove_organization_member";
      args = {
        p_user_id: mutation.userId,
        p_reason: mutation.reason,
        p_request_id: mutation.requestId,
      };
      break;
    case "move_project":
      name = "lukas_qto_move_project";
      args = {
        p_project_id: mutation.projectId,
        p_destination_organization_id: mutation.destinationOrganizationId,
        p_reason: mutation.reason,
        p_request_id: mutation.requestId,
      };
      break;
    case "set_entitlement":
      name = "lukas_qto_set_organization_entitlement";
      args = {
        p_plan: mutation.plan,
        p_seat_limit: mutation.seatLimit,
        p_project_limit: mutation.projectLimit,
        p_library_version_limit: mutation.libraryVersionLimit,
        p_trial_ends_at: mutation.trialEndsAt,
        p_features: mutation.features,
        p_reason: mutation.reason,
        p_request_id: mutation.requestId,
      };
  }
  const result = await client.rpc(name, {
    p_organization_id: organizationId,
    ...args,
  });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function runOrganizationAdministrationMutationWithInvitationOrigin(
  client: RpcClient,
  organizationId: string,
  mutation: OrganizationAdministrationMutation,
  requestUrl: string,
  configuredAppUrl = process.env.APP_URL,
) {
  const invitationOrigin =
    mutation.intent === "invite_member"
      ? resolveAuthOrigin(requestUrl, configuredAppUrl)
      : null;
  return {
    result: await runOrganizationAdministrationMutation(
      client,
      organizationId,
      mutation,
    ),
    invitationOrigin,
  };
}

export async function loadOrganizationAdminPage<T>(
  client: RpcClient,
  rpc: OrganizationAdminListRpc,
  organizationId: string,
  after: string | null,
) {
  const cursor = after === null ? null : uuid.parse(after);
  const configuration = organizationAdminCursors[rpc];
  const result = await client.rpc(rpc, {
    p_organization_id: organizationId,
    [configuration.argument]: cursor,
    p_page_size: ORGANIZATION_ADMIN_PAGE_SIZE,
  });
  if (result.error) throw new Error(result.error.message);
  const rows = (result.data ?? []) as T[];
  return {
    rows,
    next:
      rows.length === ORGANIZATION_ADMIN_PAGE_SIZE
        ? String((rows.at(-1) as Record<string, unknown>)[configuration.field])
        : null,
  };
}

type InvitationDelivery = {
  email: string;
  invitationId: string;
  organizationName: string;
  origin: string;
};

type InvitationDeliveryOptions = {
  apiKey?: string;
  send?: (message: {
    from: string;
    to: string[];
    subject: string;
    html: string;
  }) => Promise<{ error: { message: string } | null }>;
};

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

export async function deliverOrganizationInvitationEmail(
  invitation: InvitationDelivery,
  options: InvitationDeliveryOptions = {},
) {
  const apiKey = options.apiKey ?? process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  try {
    const send =
      options.send ??
      (async (message) => {
        const { default: resendClient } = await import(
          "~/core/lib/resend-client.server"
        );
        return resendClient.emails.send(message);
      });
    const acceptUrl = `${invitation.origin}/organization-invitations/${invitation.invitationId}/accept`;
    const result = await send({
      from: "1HK Platform <hello@supaplate.com>",
      to: [invitation.email],
      subject: `${invitation.organizationName} 회사 초대`,
      html: `<p>${escapeHtml(invitation.organizationName)} 회사에 초대되었습니다.</p><p><a href="${escapeHtml(acceptUrl)}">로그인 또는 가입 후 초대 수락</a></p>`,
    });
    return !result.error;
  } catch {
    return false;
  }
}
