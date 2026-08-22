import type { Route } from "./+types/download";

import {
  ArrowRight,
  CheckCircle2,
  Download,
  FileCheck2,
  FileWarning,
  MonitorCheck,
  ShieldCheck,
} from "lucide-react";
import { Link } from "react-router";

import { readPublicReleaseConfig } from "../lib/release-config";

export const meta: Route.MetaFunction = () => [
  { title: "Lukas QTO 무료 다운로드 | 한길시스템" },
  {
    name: "description",
    content:
      "Revit 2025용 Lukas QTO 개발자 현장 검증 키트를 결제정보 없이 무료로 다운로드합니다.",
  },
];

const included = [
  "Revit 객체 Properties 원장 추출",
  "IFC · QTO · Element ID 증거 패키지",
  "선택 요소 · 활성 뷰 · 전체 호스트 모델 범위",
  "파일 확인번호와 진단 파일을 이용한 설치 검증",
];

const steps = [
  "Revit을 완전히 종료합니다.",
  "검증 ZIP을 풀고 1-BUILD-INSTALL-2025.bat을 실행합니다.",
  "Revit을 다시 열어 ‘한길시스템’ 또는 ‘Lukas QTO’ 탭을 확인합니다.",
];

export default function DownloadBeta() {
  const release = readPublicReleaseConfig({
    url: import.meta.env.VITE_REVIT_2025_BETA_URL as string | undefined,
    sha256: import.meta.env.VITE_REVIT_2025_BETA_SHA256 as string | undefined,
    version: import.meta.env.VITE_REVIT_2025_BETA_VERSION as string | undefined,
  });

  return (
    <main className="overflow-hidden bg-[#f4f6f8] text-[#10141d]">
      <section className="relative bg-[#07152d] px-5 py-16 text-white sm:px-8 lg:py-24">
        <div className="absolute inset-0 opacity-25 [background-image:radial-gradient(circle_at_75%_20%,#5266f2,transparent_38%)]" />
        <div className="relative mx-auto grid max-w-[1200px] gap-12 lg:grid-cols-[1.1fr_.9fr] lg:items-center">
          <div>
            <p className="text-sm font-bold tracking-[.2em] text-[#9fb0ff]">
              LUKAS QTO · REVIT 2025
            </p>
            <h1 className="mt-5 text-5xl font-black leading-[1.02] tracking-[-.055em] sm:text-7xl">
              먼저 무료로
              <br />
              현장 파일에서 확인하세요.
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300">
              지금은 가격도 결제정보도 필요 없습니다. Revit 객체의 이름과 기본
              물량이 정확히 추출되는지 검증하는 현장 베타입니다.
            </p>
            <div className="mt-9 flex flex-wrap gap-3 text-sm">
              <span className="rounded-full border border-white/15 bg-white/10 px-4 py-2">
                Windows · Revit 2025
              </span>
              <span className="rounded-full border border-white/15 bg-white/10 px-4 py-2">
                사용자별 설치
              </span>
              <span className="rounded-full border border-white/15 bg-white/10 px-4 py-2">
                관리자 권한 불필요
              </span>
            </div>
          </div>

          <aside className="rounded-[2rem] border border-white/15 bg-white p-7 text-[#10141d] shadow-2xl sm:p-9">
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="text-sm font-bold text-[#596172]">
                  {release.version}
                </p>
                <h2 className="mt-2 text-2xl font-black">
                  Lukas QTO 개발자 검증 키트
                </h2>
              </div>
              <span className="rounded-full bg-[#e9edff] px-4 py-2 text-sm font-black text-[#3449d8]">
                BETA
              </span>
            </div>
            <div className="mt-7 border-y border-[#e0e4ea] py-6">
              <span className="text-sm text-[#6a7280]">현재 이용 가격</span>
              <div className="mt-1 flex items-end gap-2">
                <strong className="text-5xl font-black tracking-[-.05em]">
                  0원
                </strong>
                <span className="pb-1 text-sm text-[#6a7280]">
                  결제정보 불필요
                </span>
              </div>
            </div>

            {release.ready ? (
              <a
                className="mt-7 inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#4258e8] px-7 font-bold text-white transition hover:-translate-y-0.5 hover:bg-[#3449d8]"
                href="/download/revit-2025"
              >
                <Download className="size-5" /> 현장 검증 ZIP 다운로드
              </a>
            ) : (
              <div className="mt-7 flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                <FileWarning className="size-5 shrink-0" />
                <p>
                  현재 릴리스 파일을 최종 검증 중입니다. 다운로드 주소와 파일
                  확인번호가 함께 등록되기 전에는 잘못된 설치 파일을 공개하지
                  않습니다.
                </p>
              </div>
            )}
            <p className="mt-4 text-center text-xs leading-5 text-[#727986]">
              .NET 8 SDK로 빌드하는 개발자·현장 검증용 파일입니다. 적산 결과의
              최종 판단은 실무자가 확인해야 합니다.
            </p>
          </aside>
        </div>
      </section>

      <section className="px-5 py-16 sm:px-8 lg:py-24">
        <div className="mx-auto grid max-w-[1200px] gap-10 lg:grid-cols-[.9fr_1.1fr]">
          <div>
            <p className="text-sm font-bold tracking-[.2em] text-[#4258e8]">
              WHAT IS INCLUDED
            </p>
            <h2 className="mt-4 text-4xl font-black tracking-[-.045em]">
              무료 베타에 포함된 기능
            </h2>
            <p className="mt-5 leading-7 text-[#626a78]">
              복잡한 자동 적산보다 먼저, 모델에서 기본 Properties와 물량이
              정확히 나오는지 확인하는 데 집중합니다.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {included.map((item) => (
              <li
                className="flex min-h-32 items-start gap-3 rounded-2xl border border-[#dfe3e9] bg-white p-5"
                key={item}
              >
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[#4258e8]" />
                <span className="font-bold leading-6">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-white px-5 py-16 sm:px-8 lg:py-24">
        <div className="mx-auto max-w-[1200px]">
          <div className="grid gap-8 lg:grid-cols-3">
            {[
              {
                icon: MonitorCheck,
                title: "1. 설치",
                body: "ZIP에 동봉된 Revit 2025 빌드·설치 스크립트를 실행합니다.",
              },
              {
                icon: FileCheck2,
                title: "2. 추출",
                body: "Properties 또는 IFC·QTO 패키지를 실제 프로젝트에서 내보냅니다.",
              },
              {
                icon: ShieldCheck,
                title: "3. 검증",
                body: "파일 확인번호와 진단 파일로 처음 검증한 설치본과 같은 파일인지 확인합니다.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <article
                className="rounded-[1.75rem] bg-[#f4f6f8] p-7"
                key={title}
              >
                <Icon className="size-7 text-[#4258e8]" />
                <h3 className="mt-8 text-xl font-black">{title}</h3>
                <p className="mt-3 leading-7 text-[#626a78]">{body}</p>
              </article>
            ))}
          </div>

          <ol className="mt-12 grid gap-3 sm:grid-cols-3">
            {steps.map((step, index) => (
              <li
                className="rounded-2xl border border-[#dfe3e9] p-5"
                key={step}
              >
                <strong className="text-sm text-[#4258e8]">
                  STEP {index + 1}
                </strong>
                <p className="mt-3 text-sm leading-6 text-[#596172]">{step}</p>
              </li>
            ))}
          </ol>

          {release.sha256 ? (
            <div className="mt-8 rounded-2xl border border-[#dfe3e9] bg-[#f8f9fb] p-5">
              <p className="text-xs font-bold text-[#596172]">
                공식 ZIP 파일 확인번호 (SHA-256)
              </p>
              <code className="mt-2 block overflow-x-auto text-xs">
                {release.sha256}
              </code>
            </div>
          ) : null}
        </div>
      </section>

      <section className="px-5 py-16 sm:px-8 lg:py-24">
        <div className="mx-auto grid max-w-[1200px] gap-6 rounded-[2rem] bg-[#5266f2] p-8 text-white sm:p-12 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h2 className="text-3xl font-black tracking-[-.04em]">
              설치가 안 되거나 결과가 이상한가요?
            </h2>
            <p className="mt-3 leading-7 text-[#e2e6ff]">
              Revit 버전, 진단 JSON과 화면을 보내주시면 설치와 추출을 구분해
              확인합니다.
            </p>
          </div>
          <Link
            className="inline-flex h-13 items-center gap-2 rounded-full bg-white px-6 font-bold text-[#3449d8]"
            to="/inquiry"
          >
            검증 문의하기 <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>
    </main>
  );
}
