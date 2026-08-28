import type { Route } from "./+types/organization-invitation-accept";

import { Form, data, redirect } from "react-router";

import { Button } from "~/core/components/ui/button";
import makeServerClient from "~/core/lib/supa-client.server";

export const meta: Route.MetaFunction = () => [
  { title: "회사 초대 수락 | 1HK Platform" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const [client] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous) throw redirect("/login");
  return { requestId: crypto.randomUUID() };
}

export async function action({ request, params }: Route.ActionArgs) {
  const [client, headers] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous) throw redirect("/login");
  const form = await request.formData();
  const requestId = String(form.get("request_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(requestId))
    return data(
      { error: "초대 요청 식별자가 올바르지 않습니다." },
      { status: 400, headers },
    );
  const { data: membership, error } = await client.rpc(
    "lukas_qto_accept_organization_invitation" as any,
    { p_invitation_id: params.invitationId!, p_request_id: requestId } as any,
  );
  if (error || !membership)
    return data(
      { error: error?.message ?? "초대를 수락하지 못했습니다." },
      { status: 409, headers },
    );
  return redirect(
    `/organizations/${(membership as any).organization_id}/settings`,
    { headers },
  );
}

export default function OrganizationInvitationAccept({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-3xl font-semibold">회사 초대 수락</h1>
      <p className="mt-3 text-muted-foreground">
        로그인한 이메일과 정확히 일치하고 초대가 유효한 경우에만 회사에
        참여합니다.
      </p>
      {actionData?.error ? (
        <p className="mt-5 rounded-lg bg-destructive/10 p-3 text-destructive">
          {actionData.error}
        </p>
      ) : null}
      <Form className="mt-6" method="post">
        <Hidden name="request_id" value={loaderData.requestId} />
        <Button type="submit">초대 수락</Button>
      </Form>
    </main>
  );
}

function Hidden({ name, value }: { name: string; value: string }) {
  return <input name={name} type="hidden" value={value} />;
}
