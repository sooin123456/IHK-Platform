import type { Route } from "./+types/magic-link";

import { useEffect, useRef } from "react";
import { Form, Link, data } from "react-router";
import { z } from "zod";

import FormButton from "~/core/components/form-button";
import FormErrors from "~/core/components/form-error";
import FormSuccess from "~/core/components/form-success";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/core/components/ui/card";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import { sendCrossBrowserMagicLink } from "~/features/auth/lib/auth-link.server";

const magicLinkSchema = z.object({
  email: z.string().trim().email("이메일 주소를 확인하세요."),
});

export const meta: Route.MetaFunction = () => [
  { title: "로그인 | 한길시스템" },
];

export async function action({ request }: Route.ActionArgs) {
  const { success, data: validData } = magicLinkSchema.safeParse(
    Object.fromEntries(await request.formData()),
  );
  if (!success)
    return data({ error: "이메일 주소를 확인하세요." }, { status: 400 });

  const origin = process.env.APP_URL || new URL(request.url).origin;
  const { error } = await sendCrossBrowserMagicLink({
    email: validData.email,
    origin,
    shouldCreateUser: true,
  });
  if (error) {
    const message =
      error.code === "over_email_send_rate_limit" || error.status === 429
        ? "이메일 발송 한도에 도달했습니다. 기존 메일함을 확인하거나 약 30분 후 다시 시도해 주세요."
        : error.message;
    return data({ error: message }, { status: error.status ?? 400 });
  }
  return data({ success: true });
}

export default function MagicLink({ actionData }: Route.ComponentProps) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success)
      formRef.current?.reset();
  }, [actionData]);

  return (
    <div className="mx-auto flex w-full max-w-md justify-center">
      <Card className="w-full border shadow-sm">
        <CardHeader>
          <p className="text-sm font-semibold text-[#3024d8]">
            한길시스템 고객공간
          </p>
          <CardTitle className="text-2xl font-semibold">
            로그인 링크 받기
          </CardTitle>
          <CardDescription className="text-base">
            비밀번호 없이 이메일 링크로 작업공간에 안전하게 접속합니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form className="grid gap-5" method="post" ref={formRef}>
            <div className="grid gap-2">
              <Label htmlFor="email">업무용 이메일</Label>
              <Input
                autoComplete="email"
                id="email"
                name="email"
                placeholder="name@company.com"
                required
                type="email"
              />
            </div>
            <FormButton className="w-full" label="로그인 링크 보내기" />
            {actionData && "error" in actionData && actionData.error ? (
              <FormErrors errors={[actionData.error]} />
            ) : null}
            {actionData && "success" in actionData && actionData.success ? (
              <FormSuccess message="로그인 링크를 보냈습니다. 이메일을 열어 작업공간으로 이동해 주세요." />
            ) : null}
          </Form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            처음이어도 같은 링크로 시작할 수 있습니다.{" "}
            <Link className="underline underline-offset-4" to="/join">
              자세한 안내 보기
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
