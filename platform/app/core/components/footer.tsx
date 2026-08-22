import { Link } from "react-router";

export default function Footer() {
  return (
    <footer className="mt-auto bg-[#07152d] px-5 py-10 text-sm text-slate-400 md:px-10">
      <div className="mx-auto grid max-w-[1320px] gap-8 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <div className="flex items-center gap-3 text-white">
            <span className="grid size-10 place-items-center rounded-xl bg-[#5266f2] font-black">
              H
            </span>
            <div>
              <strong className="block text-base">한길시스템</strong>
              <span className="text-xs text-slate-400">
                BIM 건축 적산·물량산출 전문
              </span>
            </div>
          </div>
          <p className="mt-6">
            © {new Date().getFullYear()} 한길시스템 · SINCE 1995
          </p>
        </div>
        <div className="space-y-2 md:text-right">
          <p className="text-slate-300">
            063-227-1841 · 전북특별자치도 전주시 완산구 중화산로 56
          </p>
          <div className="flex flex-wrap gap-4 md:justify-end">
            <Link to="/news">회사 소식</Link>
            <Link to="/inquiry">문의하기</Link>
            <Link to="/privacy">개인정보 처리 안내</Link>
            <Link to="/download">무료 다운로드</Link>
            <Link to="/auth/magic-link">고객 로그인</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
