import type { Route } from "./+types/private.layout";

import { Outlet, data, redirect } from "react-router";

import makeServerClient from "~/core/lib/supa-client.server";
import { authLoginPath } from "~/features/auth/lib/auth-link.server";

export async function loader({ request }: Route.LoaderArgs) {
  const [client, headers] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous) {
    throw redirect(authLoginPath(request.url), { headers });
  }

  // Return an empty object to avoid the "Cannot read properties of undefined" error
  return data({}, { headers });
}

export default function PrivateLayout() {
  return <Outlet />;
}
