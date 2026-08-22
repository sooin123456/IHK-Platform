import type { Route } from "./+types/login-redirect";

import { redirect } from "react-router";

export function loader(_: Route.LoaderArgs) {
  throw redirect("/auth/magic-link");
}

export default function LoginRedirect() {
  return null;
}
