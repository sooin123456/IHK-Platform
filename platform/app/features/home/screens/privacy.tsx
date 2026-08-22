import type { Route } from "./+types/privacy";

export const meta: Route.MetaFunction = () => [
  { title: "개인정보 처리 안내 | 한길시스템" },
];

const rows = [
  ["수집 항목", "이름, 이메일, 연락처, 회사명, 프로젝트명, 상담 내용"],
  [
    "이용 목적",
    "프로젝트 상담, 범위·견적 안내, 고객 프로젝트 공간 운영과 문의 응대",
  ],
  [
    "보유 기간",
    "상담 종료 후 관계 법령상 보존 의무가 없는 경우 지체 없이 파기",
  ],
  ["처리 시스템", "웹 서비스와 Supabase 기반 비공개 데이터 저장소"],
];

export default function Privacy() {
  return (
    <main className="bg-[#f7f8fb] px-5 py-16 sm:px-8 lg:py-24">
      <article className="mx-auto max-w-4xl rounded-[2rem] border bg-white p-8 shadow-sm sm:p-12">
        <p className="text-sm font-bold text-[#3024d8]">PRIVACY</p>
        <h1 className="mt-3 text-4xl font-black tracking-[-.04em]">
          개인정보 처리 안내
        </h1>
        <p className="mt-5 leading-7 text-muted-foreground">
          한길시스템은 상담과 프로젝트 운영에 필요한 최소한의 정보만 수집하며,
          물량산출 원본과 고객 파일은 공개하지 않습니다.
        </p>
        <dl className="mt-10 divide-y rounded-2xl border">
          {rows.map(([term, description]) => (
            <div className="grid gap-2 p-5 sm:grid-cols-[150px_1fr]" key={term}>
              <dt className="font-bold">{term}</dt>
              <dd className="leading-7 text-muted-foreground">{description}</dd>
            </div>
          ))}
        </dl>
        <section className="mt-10 space-y-4 leading-7 text-muted-foreground">
          <h2 className="text-xl font-bold text-foreground">고객의 권리</h2>
          <p>
            본인 정보의 열람·정정·삭제 또는 처리 중지를 요청할 수 있습니다.
            문의는 063-227-1841로 접수해 주세요.
          </p>
          <h2 className="pt-4 text-xl font-bold text-foreground">
            파일과 공유 링크
          </h2>
          <p>
            프로젝트 파일은 비공개 저장소에 보관합니다. 공개 검토 링크를 별도로
            생성한 경우에도 원본 다운로드 권한은 제공하지 않으며, 링크를 가진
            사람에게 표시되는 범위를 화면에서 안내합니다.
          </p>
          <p className="pt-4 text-sm">시행일: 2026년 8월 15일</p>
        </section>
      </article>
    </main>
  );
}
