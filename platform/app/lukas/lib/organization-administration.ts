import { z } from "zod";

const uuid = z.string().uuid();

export type OrganizationAdminPageCursors = Partial<
  Record<
    "memberAfter" | "invitationAfter" | "projectAfter" | "destinationAfter",
    string | null
  >
>;

export function organizationAdminPageHref(
  organizationId: string,
  current: OrganizationAdminPageCursors,
  update: OrganizationAdminPageCursors = {},
) {
  const query = new URLSearchParams();
  const cursors = { ...current, ...update };
  for (const name of [
    "memberAfter",
    "invitationAfter",
    "projectAfter",
    "destinationAfter",
  ] as const) {
    const value = cursors[name];
    if (value) query.set(name, uuid.parse(value));
  }
  const search = query.toString();
  return `/organizations/${uuid.parse(organizationId)}/settings${search ? `?${search}` : ""}`;
}
