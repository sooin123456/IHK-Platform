import type { Route } from "./+types/inquiry";

import { Building2, CheckCircle2, Mail, Phone } from "lucide-react";
import { Form, Link, data } from "react-router";
import { z } from "zod";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import makeServerClient from "~/core/lib/supa-client.server";

const inquirySchema = z.object({
  name: z.string().trim().min(1, "이름을 입력하세요.").max(80),
  email: z.string().trim().email("이메일 주소를 확인하세요.").max(254),
  phone: z.string().trim().max(40),
  company: z.string().trim().max(120),
  projectName: z.string().trim().min(1, "프로젝트명을 입력하세요.").max(160),
  message: z
    .string()
    .trim()
    .min(10, "검토할 내용과 원하는 결과를 10자 이상 적어주세요.")
    .max(4000),
  consent: z.literal("on", {
    errorMap: () => ({ message: "개인정보 수집에 동의해 주세요." }),
  }),
  website: z.string().max(0),
});

export const meta: Route.MetaFunction = () => [
  { title: "프로젝트 문의 | 한길시스템" },
];

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const parsed = inquirySchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone") ?? "",
    company: formData.get("company") ?? "",
    projectName: formData.get("project_name"),
    message: formData.get("message"),
    consent: formData.get("consent"),
    website: formData.get("website") ?? "",
  });
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  if (!parsed.success)
    return data(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
      },
      { status: 400, headers },
    );

  const [client, authHeaders] = makeServerClient(request);
  authHeaders.forEach((value, key) => headers.append(key, value));
  const { error } = await client.from("hangil_project_inquiries").insert({
    name: parsed.data.name,
    email: parsed.data.email,
    phone: parsed.data.phone,
    company: parsed.data.company,
    project_name: parsed.data.projectName,
    message: parsed.data.message,
    consent: true,
    status: "new",
  });
  if (error)
    return data(
      {
        ok: false,
        error:
          "문의 저장에 실패했습니다. 잠시 후 다시 시도하거나 063-227-1841로 연락해 주세요.",
      },
      { status: 500, headers },
    );
  return data({ ok: true, error: "" }, { headers });
}

export default function Inquiry({ actionData }: Route.ComponentProps) {
  return (
    <main className="bg-[#f7f8fb] px-5 py-16 sm:px-8 lg:py-24">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[.8fr_1.2fr]">
        <section className="rounded-[2rem] bg-[#3024d8] p-8 text-white sm:p-10">
          <p className="text-sm font-bold tracking-[.18em] text-indigo-200">
            PROJECT INQUIRY
          </p>
          <h1 className="mt-5 text-4xl font-black tracking-[-.04em]">
            도면과 원하는 결과부터 알려주세요.
          </h1>
          <p className="mt-5 leading-7 text-indigo-100">
            모델이 없어도 상담할 수 있습니다. 범위 확인 후 수동 견적을 안내하고,
            작업 확정 뒤 이메일 로그인으로 사용하는 비공개 프로젝트 공간을
            엽니다.
          </p>
          <div className="mt-10 grid gap-3 text-sm">
            <a
              className="flex items-center gap-3 rounded-2xl bg-white/10 p-4"
              href="tel:0632271841"
            >
              <Phone className="size-5" /> 063-227-1841
            </a>
            <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-4">
              <Building2 className="size-5" /> 전주시 완산구 중화산로 56
            </div>
          </div>
          <div className="mt-8 rounded-2xl bg-white/10 p-5 text-sm leading-6 text-indigo-100">
            접수 → 범위·견적 확인 → 프로젝트 개설 → 원본 업로드 → 물량·검산 근거
            검토 → 납품 순서로 진행합니다.
          </div>
        </section>

        <section className="rounded-[2rem] border bg-white p-8 shadow-sm sm:p-10">
          {actionData?.ok ? (
            <div className="grid min-h-[28rem] place-items-center text-center">
              <div>
                <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
                <h2 className="mt-5 text-2xl font-bold">
                  문의가 접수되었습니다.
                </h2>
                <p className="mt-3 text-muted-foreground">
                  범위를 확인한 뒤 남겨주신 연락처로 안내하겠습니다.
                </p>
                <Button asChild className="mt-7" variant="outline">
                  <Link to="/">홈으로 돌아가기</Link>
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <p className="text-sm font-bold text-[#3024d8]">
                  무료 상담 접수
                </p>
                <h2 className="mt-2 text-2xl font-bold">
                  필요한 자료와 결과를 적어주세요.
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  결제는 아직 받지 않습니다. 상담과 프로그램 다운로드는
                  무료입니다.
                </p>
              </div>
              <Form className="mt-7 grid gap-5 sm:grid-cols-2" method="post">
                <div className="hidden" aria-hidden="true">
                  <Label htmlFor="website">웹사이트</Label>
                  <Input
                    autoComplete="off"
                    id="website"
                    name="website"
                    tabIndex={-1}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="name">이름 *</Label>
                  <Input id="name" maxLength={80} name="name" required />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email">이메일 *</Label>
                  <Input
                    id="email"
                    maxLength={254}
                    name="email"
                    required
                    type="email"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="phone">연락처</Label>
                  <Input id="phone" maxLength={40} name="phone" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="company">회사명</Label>
                  <Input id="company" maxLength={120} name="company" />
                </div>
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="project_name">프로젝트명 *</Label>
                  <Input
                    id="project_name"
                    maxLength={160}
                    name="project_name"
                    placeholder="예: 근린생활시설 물량산출"
                    required
                  />
                </div>
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="message">검토 범위와 원하는 결과 *</Label>
                  <textarea
                    className="min-h-36 rounded-md border bg-background p-3 text-sm"
                    id="message"
                    maxLength={4000}
                    name="message"
                    placeholder="보유한 파일, 산출 공종, 희망 일정 등을 적어주세요."
                    required
                  />
                </div>
                <label className="flex items-start gap-3 text-sm text-muted-foreground sm:col-span-2">
                  <input
                    className="mt-1"
                    name="consent"
                    required
                    type="checkbox"
                  />
                  <span>
                    상담 연락과 프로젝트 접수를 위한 개인정보 수집·이용에
                    동의합니다. 자세한 내용은{" "}
                    <Link
                      className="underline underline-offset-4"
                      to="/privacy"
                    >
                      개인정보 처리 안내
                    </Link>
                    에서 확인할 수 있습니다.
                  </span>
                </label>
                {actionData?.error ? (
                  <p
                    aria-live="assertive"
                    className="text-sm text-destructive sm:col-span-2"
                    role="alert"
                  >
                    {actionData.error}
                  </p>
                ) : null}
                <Button className="sm:col-span-2 sm:w-fit" type="submit">
                  무료 상담 접수
                </Button>
              </Form>
              <div className="mt-8 rounded-2xl bg-[#f3f4f8] p-5">
                <p className="font-semibold">이미 프로젝트가 있나요?</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  비밀번호 없이 이메일 링크로 안전하게 접속합니다.
                </p>
                <Link
                  className="mt-4 inline-flex items-center gap-2 font-bold text-[#3024d8]"
                  to="/auth/magic-link"
                >
                  <Mail className="size-4" /> 고객 로그인
                </Link>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
