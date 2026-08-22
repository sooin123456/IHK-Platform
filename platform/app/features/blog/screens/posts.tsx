import type { Route } from "./+types/posts";

import { ArrowRight, Newspaper, Rss } from "lucide-react";
import { Link } from "react-router";

import { Badge } from "../../../core/components/ui/badge";
import { getNewsPosts } from "../news.server";

export const meta: Route.MetaFunction = () => [
  { title: "회사 소식 | 한길시스템" },
  {
    name: "description",
    content:
      "한길시스템의 BIM 적산 연구, Lukas QTO 개발과 현장 검증 소식입니다.",
  },
];

export async function loader() {
  return { posts: await getNewsPosts() };
}

export default function Posts({ loaderData: { posts } }: Route.ComponentProps) {
  return (
    <main className="bg-[#f4f6f8] px-5 py-16 text-[#10141d] sm:px-8 lg:py-24">
      <div className="mx-auto max-w-[1320px]">
        <header className="grid gap-8 border-b border-[#d9dee7] pb-12 lg:grid-cols-[.8fr_1.2fr] lg:items-end">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold tracking-[.2em] text-[#4258e8]">
              <Newspaper className="size-4" /> NEWSROOM
            </p>
            <h1 className="mt-5 text-4xl font-black tracking-[-.05em] sm:text-6xl">
              한길시스템 소식
            </h1>
          </div>
          <div className="lg:justify-self-end">
            <p className="max-w-2xl text-lg leading-8 text-[#5f6674]">
              30년 적산 실무와 BIM 기술을 연결하며 확인한 현장 경험, 제품
              업데이트와 검증 결과를 투명하게 전합니다.
            </p>
            <a
              className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-[#4258e8]"
              href="/news.xml"
            >
              <Rss className="size-4" /> RSS로 구독
            </a>
          </div>
        </header>

        <section className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post, index) => (
            <article
              className={`group overflow-hidden rounded-[2rem] border border-[#dfe3e9] bg-white shadow-[0_16px_50px_rgba(23,32,53,.06)] ${index === 0 ? "md:col-span-2 lg:col-span-2" : ""}`}
              key={post.slug}
            >
              <Link
                className="block h-full"
                to={`/news/${post.slug}`}
                viewTransition
              >
                <div
                  className={`overflow-hidden bg-[#0a1933] ${index === 0 ? "aspect-[16/8]" : "aspect-[16/10]"}`}
                >
                  <img
                    alt=""
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]"
                    src={post.image}
                  />
                </div>
                <div className="p-7 sm:p-8">
                  <div className="flex items-center justify-between gap-3">
                    <Badge variant="secondary">{post.category}</Badge>
                    <time
                      className="text-sm text-[#7a8291]"
                      dateTime={post.date}
                    >
                      {new Date(post.date).toLocaleDateString("ko-KR")}
                    </time>
                  </div>
                  <h2
                    className={`mt-6 font-black tracking-[-.035em] ${index === 0 ? "text-3xl sm:text-4xl" : "text-2xl"}`}
                  >
                    {post.title}
                  </h2>
                  <p className="mt-4 leading-7 text-[#626a78]">
                    {post.description}
                  </p>
                  <span className="mt-7 inline-flex items-center gap-2 font-bold text-[#4258e8]">
                    자세히 보기 <ArrowRight className="size-4" />
                  </span>
                </div>
              </Link>
            </article>
          ))}
        </section>

        <aside className="mt-16 grid gap-6 rounded-[2rem] bg-[#0a1933] p-8 text-white sm:p-12 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-sm font-bold tracking-[.18em] text-[#9fb0ff]">
              FIELD BETA
            </p>
            <h2 className="mt-3 text-3xl font-black tracking-[-.04em]">
              새 버전은 검증을 마친 뒤 공개합니다.
            </h2>
            <p className="mt-3 max-w-2xl leading-7 text-slate-300">
              설치 방법, 지원 Revit 버전과 파일 확인번호를 함께 제공해 같은
              파일인지 확인할 수 있습니다.
            </p>
          </div>
          <Link
            className="inline-flex h-13 items-center gap-2 rounded-full bg-white px-6 font-bold text-[#2438c4]"
            to="/download"
          >
            무료 버전 확인 <ArrowRight className="size-4" />
          </Link>
        </aside>
      </div>
    </main>
  );
}
