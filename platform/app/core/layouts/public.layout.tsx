import type { Route } from "./+types/public.layout";

import { Outlet, data, redirect } from "react-router";

import makeServerClient from "~/core/lib/supa-client.server";

export async function loader({ request }: Route.LoaderArgs) {
  const [client, headers] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (user && !user.is_anonymous) {
    throw redirect("/workspace", { headers });
  }

  // Return an empty object to avoid the "Cannot read properties of undefined" error
  return data({}, { headers });
}

export default function PublicLayout() {
  return <Outlet />;
}
