import type { Route } from "./+types/login-redirect";

import { redirect } from "react-router";

import { safeAuthNextPath } from "~/features/auth/lib/auth-link.server";

export function loader({ request }: Route.LoaderArgs) {
  const next = safeAuthNextPath(new URL(request.url).searchParams.get("next"));
  throw redirect(
    next
      ? `/auth/magic-link?next=${encodeURIComponent(next)}`
      : "/auth/magic-link",
  );
}

export default function LoginRedirect() {
  return null;
}
