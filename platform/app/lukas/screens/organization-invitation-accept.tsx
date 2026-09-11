import type { Route } from "./+types/organization-invitation-accept";

import { Form, data, redirect } from "react-router";

import { Button } from "~/core/components/ui/button";
import makeServerClient from "~/core/lib/supa-client.server";
import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import { authLoginPath } from "~/features/auth/lib/auth-link.server";

export const meta: Route.MetaFunction = () => [
  { title: "회사 초대 수락 | 1HK Platform" },
];

function acceptancePath(invitationId: string | undefined) {
  if (
    !invitationId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      invitationId,
    )
  )
    throw new Response("초대를 찾을 수 없습니다.", { status: 404 });
  return `/organization-invitations/${invitationId}/accept`;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const [client, headers] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous)
    throw redirect(authLoginPath(request.url), { headers });
  try {
    acceptancePath(params.invitationId);
    return data({ requestId: crypto.randomUUID() }, { headers });
  } catch (error) {
    if (error instanceof Response) throw mergeResponseHeaders(error, headers);
    throw error;
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const [client, headers] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous)
    throw redirect(authLoginPath(request.url), { headers });
  try {
    acceptancePath(params.invitationId);
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
  } catch (error) {
    if (error instanceof Response) throw mergeResponseHeaders(error, headers);
    throw error;
  }
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
