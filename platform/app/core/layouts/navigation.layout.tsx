import type { Route } from "./+types/navigation.layout";

import { Suspense } from "react";
import { Await, Outlet, useLocation } from "react-router";

import Footer from "../components/footer";
import { NavigationBar } from "../components/navigation-bar";
import makeServerClient from "../lib/supa-client.server";

export async function loader({ request }: Route.LoaderArgs) {
  const [client] = makeServerClient(request);
  const userPromise = client.auth.getUser().then(({ data, error }) => ({
    user: error ? null : data.user,
  }));
  return { userPromise };
}

export default function NavigationLayout({ loaderData }: Route.ComponentProps) {
  const { userPromise } = loaderData;
  const location = useLocation();

  // The authenticated project home is a full-screen creation workspace. The
  // public marketing header/footer would duplicate its own navigation shell.
  if (location.pathname === "/workspace") {
    return <Outlet />;
  }

  return (
    <div className="flex min-h-screen flex-col justify-between">
      <Suspense fallback={<NavigationBar loading={true} />}>
        <Await resolve={userPromise}>
          {({ user }) =>
            user === null || user.is_anonymous ? (
              <NavigationBar loading={false} />
            ) : (
              <NavigationBar email={user.email} loading={false} />
            )
          }
        </Await>
      </Suspense>
      <div className="w-full">
        <Outlet />
      </div>
      <Footer />
    </div>
  );
}
