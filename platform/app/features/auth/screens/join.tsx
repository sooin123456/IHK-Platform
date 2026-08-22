import type { Route } from "./+types/join";

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

const schema = z.object({
  email: z.string().trim().email("이메일 주소를 확인하세요."),
});

export const meta: Route.MetaFunction = () => [
  { title: "시작하기 | 한길시스템" },
];

export async function action({ request }: Route.ActionArgs) {
  const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success)
    return data(
      { fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );

  const origin = process.env.APP_URL || new URL(request.url).origin;
  const { error } = await sendCrossBrowserMagicLink({
    email: parsed.data.email,
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

export default function Join({ actionData }: Route.ComponentProps) {
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
          <CardTitle className="text-2xl">이메일로 시작하기</CardTitle>
          <CardDescription>
            비밀번호를 만들지 않습니다. 받은 편지함의 로그인 링크를 누르면 바로
            작업공간으로 이동합니다.
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
              {actionData &&
              "fieldErrors" in actionData &&
              actionData.fieldErrors.email ? (
                <FormErrors errors={actionData.fieldErrors.email} />
              ) : null}
            </div>
            {actionData && "error" in actionData ? (
              <FormErrors errors={[actionData.error]} />
            ) : null}
            {actionData && "success" in actionData ? (
              <FormSuccess message="로그인 링크를 보냈습니다. 메일을 확인해 주세요." />
            ) : null}
            <FormButton
              className="w-full"
              label="로그인 링크 받기"
              type="submit"
            />
          </Form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            이미 등록했나요?{" "}
            <Link
              className="underline underline-offset-4"
              to="/auth/magic-link"
            >
              로그인 링크 다시 받기
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
