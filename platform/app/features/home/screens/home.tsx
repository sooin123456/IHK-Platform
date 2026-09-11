import type { Route } from "./+types/home";

import {
  ArrowRight,
  Box,
  Calculator,
  FileCheck2,
  FileSpreadsheet,
  Fingerprint,
  Layers3,
  LineChart,
  Newspaper,
  Ruler,
} from "lucide-react";
import { Link } from "react-router";

export const meta: Route.MetaFunction = () => [
  { title: "한길시스템 | 도면 작성·검토·수량 작업실" },
  {
    name: "description",
    content:
      "도면 작성, 변경 검토, 수량·견적을 한 작업실에서 연결하고 필요하면 한길시스템 전문가에게 별도로 의뢰합니다.",
  },
];

const workspaceTasks = [
  {
    icon: Ruler,
    title: "작성",
    body: "프로젝트 안에서 빈 도면이나 템플릿으로 시작하고 필요한 도형과 정보를 정리합니다.",
  },
  {
    icon: FileCheck2,
    title: "검토",
    body: "도면의 변경 내용과 의견, 결정 근거를 같은 개정 흐름에서 확인합니다.",
  },
  {
    icon: Calculator,
    title: "수량·견적",
    body: "도면과 연결된 수량·금액 근거를 살펴보고 담당자가 확인해 결과를 정리합니다.",
  },
];

const services = [
  {
    number: "01",
    icon: Box,
    title: "BIM 모델링",
    body: "도면의 설계 정보를 Revit 모델로 구조화하고, 적산에 필요한 객체·속성·공종 기준을 정리합니다.",
    outputs: "Revit 모델 · 객체 속성",
  },
  {
    number: "02",
    icon: Calculator,
    title: "물량산출",
    body: "BIM 객체와 산출 수량을 연결해 부위·공종별 물량과 원본 요소의 추적 근거를 제공합니다.",
    outputs: "IFC · QTO · 요소 원장",
  },
  {
    number: "03",
    icon: FileSpreadsheet,
    title: "내역서·공사비",
    body: "검토된 물량을 품목·규격·단가 체계와 연결해 의사결정에 사용할 수 있는 자료로 정리합니다.",
    outputs: "내역서 · 공사비 검토",
  },
];

const deliverables = [
  {
    icon: Layers3,
    title: "모델과 IFC",
    body: "설계 정보와 교환 가능한 모델 원본",
  },
  { icon: Ruler, title: "QTO 물량표", body: "분류·패밀리·타입·레벨별 수량" },
  {
    icon: Fingerprint,
    title: "요소 원장",
    body: "Element ID까지 이어지는 역추적 근거",
  },
  {
    icon: FileCheck2,
    title: "검토 기록",
    body: "원본 파일 확인번호와 변경 전후 비교 결과",
  },
];

const principles = [
  ["모델로 검증", "수량만 전달하지 않고 BIM 객체와 산출 근거를 연결합니다."],
  [
    "변경에 대응",
    "설계 개정 전후의 물량 차이와 작업 상태를 같은 흐름에서 확인합니다.",
  ],
  [
    "전문가가 판단",
    "프로그램은 근거를 정리하고, 적산 기준과 최종 판단은 실무자가 검토합니다.",
  ],
];

const process = [
  "문의·도면 접수",
  "범위·견적 확정",
  "BIM 모델링",
  "물량산출",
  "전문가 검토",
  "납품·개정관리",
];

export default function Home() {
  return (
    <main className="overflow-hidden bg-[#f4f6f8] text-[#10141d]">
      <section className="relative min-h-[780px] overflow-hidden bg-[#06142c] text-white lg:min-h-[850px]">
        <img
          alt="완성 건축물과 BIM 와이어프레임을 결합한 한길시스템 이미지"
          className="absolute inset-0 h-full w-full object-cover object-[63%_center]"
          src="/images/hangil-bim-hero.png"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,12,29,.98)_0%,rgba(3,12,29,.9)_34%,rgba(3,12,29,.24)_72%,rgba(3,12,29,.08)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-52 bg-[linear-gradient(0deg,rgba(3,12,29,.92),transparent)]" />

        <div className="relative mx-auto flex min-h-[780px] max-w-[1440px] flex-col justify-center px-5 pb-36 pt-24 sm:px-8 lg:min-h-[850px] lg:px-14">
          <div className="max-w-3xl">
            <p className="flex items-center gap-3 text-xs font-bold tracking-[.22em] text-[#9db8ff] sm:text-sm">
              <span className="h-px w-9 bg-[#5f7cff]" /> SINCE 1995 · BIM COST
              CONSULTING
            </p>
            <h1 className="mt-7 text-[clamp(3rem,7vw,6.8rem)] font-black leading-[.98] tracking-[-.06em]">
              도면 업무를,
              <br />
              <span className="text-[#b9c8ff]">한 작업실에서.</span>
            </h1>
            <p className="mt-8 max-w-2xl text-lg leading-8 text-slate-200 sm:text-xl">
              빈 도면이나 템플릿에서 시작해 작성·검토·수량·견적을 같은
              프로젝트에서 이어갑니다. 전문 인력이 필요한 일은 한길시스템의 30년
              건축 적산 경험으로 별도 수행합니다.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link
                className="inline-flex h-14 items-center gap-2 rounded-full bg-[#5b6cff] px-7 font-bold text-white transition hover:-translate-y-0.5 hover:bg-[#7080ff]"
                to="/workspace"
              >
                직접 작업하기 <ArrowRight className="size-4" />
              </Link>
              <Link
                className="inline-flex h-14 items-center rounded-full border border-white/30 bg-white/10 px-7 font-bold backdrop-blur-xl transition hover:bg-white/15"
                to="/inquiry"
              >
                전문가에게 의뢰하기
              </Link>
              <Link
                className="inline-flex h-14 items-center rounded-full border border-white/30 bg-white/10 px-7 font-bold backdrop-blur-xl transition hover:bg-white/15"
                to="/download"
              >
                무료 베타 다운로드
              </Link>
            </div>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 border-t border-white/15 bg-[#07152d]/82 backdrop-blur-xl">
          <div className="mx-auto grid max-w-[1320px] grid-cols-2 divide-x divide-white/10 px-5 sm:px-8 lg:grid-cols-4 lg:px-0">
            {[
              ["30+", "건축 적산 실무"],
              ["BIM", "객체 기반 물량"],
              ["변경 확인", "원본 파일 확인번호"],
              ["Revit 2025", "현장 베타 운영"],
            ].map(([value, label]) => (
              <div className="px-4 py-5 lg:px-8 lg:py-7" key={label}>
                <strong className="block text-xl font-black tracking-tight sm:text-2xl">
                  {value}
                </strong>
                <span className="mt-1 block text-xs text-slate-400 sm:text-sm">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white px-5 py-20 sm:px-8 lg:py-28" id="workspace">
        <div className="mx-auto max-w-[1320px]">
          <div className="grid gap-8 lg:grid-cols-[.9fr_1.1fr] lg:items-end">
            <div>
              <p className="text-sm font-bold tracking-[.2em] text-[#4258e8]">
                ONE WORKSPACE
              </p>
              <h2 className="mt-5 text-4xl font-black leading-tight tracking-[-.045em] sm:text-5xl">
                작성부터 수량 검토까지
                <br />
                하나의 작업실에서
              </h2>
            </div>
            <div className="max-w-2xl space-y-3 text-lg leading-8 text-[#5b6270] lg:justify-self-end">
              <p>
                한길시스템 작업실에서 직접 도면을 작성하고 검토하며, 연결된
                수량·견적의 근거를 확인할 수 있습니다.
              </p>
              <p className="text-base leading-7">
                프로그램 이용과 전문 서비스는 별개입니다. 의뢰하면 전문가가 별도
                범위로 모델링과 수량 업무를 수행하며, 작업실 이용에 상담이 먼저
                필요하지 않습니다.
              </p>
            </div>
          </div>

          <div className="mt-12 grid overflow-hidden rounded-[2rem] border border-[#dce1e8] bg-[#f4f6f8] md:grid-cols-3">
            {workspaceTasks.map(({ icon: Icon, title, body }, index) => (
              <article
                className={`p-7 sm:p-9 ${index > 0 ? "border-t border-[#dce1e8] md:border-l md:border-t-0" : ""}`}
                key={title}
              >
                <Icon className="size-7 text-[#4258e8]" strokeWidth={1.6} />
                <h3 className="mt-8 text-2xl font-black">{title}</h3>
                <p className="mt-3 leading-7 text-[#626a78]">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-8 lg:py-32" id="services">
        <div className="mx-auto max-w-[1320px]">
          <div className="grid gap-8 lg:grid-cols-[.8fr_1.2fr] lg:items-end">
            <div>
              <p className="text-sm font-bold tracking-[.2em] text-[#4258e8]">
                PROFESSIONAL SERVICE
              </p>
              <h2 className="mt-5 text-4xl font-black leading-tight tracking-[-.045em] sm:text-5xl">
                맡겨야 하는 전문 업무는
                <br />
                별도 범위로 수행합니다.
              </h2>
            </div>
            <p className="max-w-2xl text-lg leading-8 text-[#5b6270] lg:justify-self-end">
              BIM 모델링과 물량·내역 검토를 의뢰하면 범위와 납품물을 먼저
              확인합니다. 자동화가 숫자를 결정하는 것이 아니라, 산출 근거를
              정리하고 전문가가 판단합니다.
            </p>
          </div>

          <div className="mt-14 grid border-y border-[#dce1e8] lg:grid-cols-3">
            {services.map(
              ({ number, icon: Icon, title, body, outputs }, index) => (
                <article
                  className={`group py-9 lg:px-8 lg:py-12 ${index > 0 ? "border-t border-[#dce1e8] lg:border-l lg:border-t-0" : ""}`}
                  key={number}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-black text-[#4258e8]">
                      {number}
                    </span>
                    <Icon className="size-7 text-[#4258e8]" strokeWidth={1.6} />
                  </div>
                  <h3 className="mt-12 text-3xl font-bold tracking-[-.035em]">
                    {title}
                  </h3>
                  <p className="mt-5 min-h-24 leading-7 text-[#626a78]">
                    {body}
                  </p>
                  <p className="mt-6 border-t border-[#e4e7ec] pt-5 text-sm font-bold text-[#252b37]">
                    {outputs}
                  </p>
                </article>
              ),
            )}
          </div>
        </div>
      </section>

      <section
        className="bg-[#0a1933] px-5 py-20 text-white sm:px-8 lg:py-32"
        id="deliverables"
      >
        <div className="mx-auto max-w-[1320px]">
          <div className="grid gap-12 lg:grid-cols-[.85fr_1.15fr]">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <p className="text-sm font-bold tracking-[.2em] text-[#93a8ff]">
                WHAT YOU RECEIVE
              </p>
              <h2 className="mt-5 text-4xl font-black leading-tight tracking-[-.045em] sm:text-5xl">
                결과 숫자만이 아니라
                <br />
                확인할 근거까지.
              </h2>
              <p className="mt-6 max-w-lg leading-7 text-slate-400">
                검토자가 어느 모델의 어떤 객체에서 수량이 나왔는지 다시 찾을 수
                있도록 원본과 결과를 함께 묶습니다.
              </p>
              <Link
                className="mt-8 inline-flex items-center gap-2 font-bold text-[#aebdff]"
                to="/download"
              >
                Revit 2025 베타 보기 <ArrowRight className="size-4" />
              </Link>
            </div>

            <div className="grid gap-px overflow-hidden rounded-[2rem] border border-white/10 bg-white/10 sm:grid-cols-2">
              {deliverables.map(({ icon: Icon, title, body }, index) => (
                <article
                  className="min-h-60 bg-[#0d1d3a] p-7 sm:p-9"
                  key={title}
                >
                  <div className="flex items-center justify-between">
                    <Icon className="size-7 text-[#8ea4ff]" strokeWidth={1.6} />
                    <span className="text-xs font-bold text-slate-500">
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="mt-16 text-2xl font-bold">{title}</h3>
                  <p className="mt-3 leading-7 text-slate-400">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-8 lg:py-32" id="approach">
        <div className="mx-auto max-w-[1320px]">
          <div className="grid gap-14 lg:grid-cols-[1.05fr_.95fr] lg:items-start">
            <div>
              <p className="text-sm font-bold tracking-[.2em] text-[#4258e8]">
                WHY HANGIL
              </p>
              <h2 className="mt-5 text-4xl font-black leading-tight tracking-[-.045em] sm:text-5xl">
                비용의 확실성은
                <br />
                추적 가능한 정보에서 시작합니다.
              </h2>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-[#606876]">
                해외 적산 컨설턴트가 강조하는 독립성·데이터·생애주기 관점을 국내
                실무 파일과 BIM 객체 수준의 근거로 구체화합니다.
              </p>
            </div>
            <div className="divide-y divide-[#d8dde5] border-y border-[#d8dde5]">
              {principles.map(([title, body], index) => (
                <article
                  className="grid grid-cols-[3rem_1fr] gap-4 py-7"
                  key={title}
                >
                  <span className="pt-1 text-sm font-black text-[#4258e8]">
                    0{index + 1}
                  </span>
                  <div>
                    <h3 className="text-xl font-bold">{title}</h3>
                    <p className="mt-2 leading-7 text-[#626a78]">{body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="mt-20 rounded-[2rem] bg-white p-7 shadow-[0_24px_80px_rgba(20,31,55,.08)] sm:p-10 lg:p-14">
            <div className="flex flex-col justify-between gap-5 border-b border-[#dfe3e9] pb-8 lg:flex-row lg:items-end">
              <div>
                <p className="text-sm font-bold tracking-[.2em] text-[#4258e8]">
                  PROJECT FLOW
                </p>
                <h3 className="mt-4 text-3xl font-black tracking-[-.035em] sm:text-4xl">
                  문의부터 개정 납품까지 한 흐름으로
                </h3>
              </div>
              <p className="max-w-md leading-7 text-[#626a78]">
                고객은 진행 상태와 파일을 확인하고, 실무자는 검토 이력을
                남깁니다.
              </p>
            </div>
            <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              {process.map((step, index) => (
                <li
                  className="relative rounded-2xl bg-[#f2f4f8] p-5"
                  key={step}
                >
                  <span className="text-xs font-black text-[#4258e8]">
                    0{index + 1}
                  </span>
                  <strong className="mt-8 block leading-6">{step}</strong>
                  {index < process.length - 1 ? (
                    <ArrowRight className="absolute -right-2 top-1/2 z-10 hidden size-4 text-[#778294] lg:block" />
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="bg-[#f4f6f8] px-5 py-20 sm:px-8 lg:py-28">
        <div className="mx-auto max-w-[1320px]">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="flex items-center gap-2 text-sm font-bold tracking-[.2em] text-[#4258e8]">
                <Newspaper className="size-4" /> NEWSROOM
              </p>
              <h2 className="mt-4 text-4xl font-black tracking-[-.045em] sm:text-5xl">
                현장 검증과 제품 소식
              </h2>
            </div>
            <Link
              className="inline-flex items-center gap-2 font-bold text-[#4258e8]"
              to="/news"
            >
              모든 소식 보기 <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              [
                "제품 소식",
                "Revit 2025 현장 베타를 무료로 공개합니다",
                "revit-2025-field-beta",
              ],
              [
                "기술 이야기",
                "물량 숫자보다 먼저 근거를 연결합니다",
                "evidence-based-takeoff",
              ],
              [
                "현장 검증",
                "실제 프로젝트 파일로 추출 결과를 검증했습니다",
                "field-file-validation",
              ],
            ].map(([category, title, slug]) => (
              <Link
                className="group rounded-[1.75rem] border border-[#dfe3e9] bg-white p-7 transition hover:-translate-y-1 hover:shadow-xl"
                key={slug}
                to={`/news/${slug}`}
              >
                <span className="text-sm font-bold text-[#4258e8]">
                  {category}
                </span>
                <h3 className="mt-8 text-2xl font-black leading-tight tracking-[-.035em]">
                  {title}
                </h3>
                <span className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#596172]">
                  읽어보기{" "}
                  <ArrowRight className="size-4 transition group-hover:translate-x-1" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white px-5 py-16 sm:px-8 lg:py-24">
        <div className="mx-auto grid max-w-[1320px] gap-8 rounded-[2rem] bg-[#5266f2] p-8 text-white sm:p-12 lg:grid-cols-[1fr_auto] lg:items-center lg:p-16">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-[#d9dfff]">
              <LineChart className="size-4" /> PROJECT COST CLARITY
            </p>
            <h2 className="mt-4 text-3xl font-black tracking-[-.04em] sm:text-5xl">
              도면과 필요한 결과를 알려주세요.
            </h2>
            <p className="mt-4 max-w-2xl leading-7 text-[#e4e8ff]">
              완성된 BIM이 없어도 상담할 수 있습니다. 범위와 납품 형식을 확인한
              뒤 견적을 안내합니다.
            </p>
          </div>
          <Link
            className="inline-flex h-14 w-fit items-center gap-2 rounded-full bg-white px-7 font-bold text-[#3449d8] transition hover:-translate-y-0.5"
            to="/inquiry"
          >
            프로젝트 문의하기 <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>
    </main>
  );
}
