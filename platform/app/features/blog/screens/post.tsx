import type { Route } from "./+types/post";

import { Fragment } from "react";
import { ArrowLeft } from "lucide-react";
import { data, Link } from "react-router";

import { Badge } from "../../../core/components/ui/badge";
import { getNewsPost } from "../news.server";

function InlineNewsText({ text }: { text: string }) {
  return text
    .split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g)
    .filter(Boolean)
    .map((part, index) => {
      const strong = part.match(/^\*\*([^*]+)\*\*$/);
      if (strong) return <strong key={index}>{strong[1]}</strong>;
      const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link)
        return (
          <Link
            className="font-bold text-[#4258e8] underline"
            key={index}
            to={link[2]}
          >
            {link[1]}
          </Link>
        );
      return <Fragment key={index}>{part}</Fragment>;
    });
}

function NewsBody({ body }: { body: string }) {
  return body.split(/\n{2,}/).map((block, index) => {
    if (block.startsWith("## "))
      return (
        <h2 className="mb-4 mt-10 text-2xl font-bold first:mt-0" key={index}>
          {block.slice(3)}
        </h2>
      );
    const lines = block.split("\n");
    if (lines.every((line) => /^\d+\. /.test(line)))
      return (
        <ol className="mb-6 ml-6 list-decimal space-y-2 leading-7" key={index}>
          {lines.map((line) => (
            <li key={line}>
              <InlineNewsText text={line.replace(/^\d+\. /, "")} />
            </li>
          ))}
        </ol>
      );
    if (lines.every((line) => line.startsWith("- ")))
      return (
        <ul className="mb-6 ml-6 list-disc space-y-2 leading-7" key={index}>
          {lines.map((line) => (
            <li key={line}>
              <InlineNewsText text={line.slice(2)} />
            </li>
          ))}
        </ul>
      );
    return (
      <p className="mb-6 leading-8 text-[#3f4754]" key={index}>
        <InlineNewsText text={lines.join(" ")} />
      </p>
    );
  });
}

export const meta: Route.MetaFunction = ({ data: loaderData }) => {
  if (!loaderData) return [{ title: "소식을 찾을 수 없습니다 | 한길시스템" }];
  const image = new URL(
    loaderData.frontmatter.image,
    loaderData.siteUrl,
  ).toString();
  return [
    { title: `${loaderData.frontmatter.title} | 한길시스템` },
    { name: "description", content: loaderData.frontmatter.description },
    { property: "og:title", content: loaderData.frontmatter.title },
    { property: "og:description", content: loaderData.frontmatter.description },
    { property: "og:image", content: image },
    { property: "og:type", content: "article" },
  ];
};

export async function loader({ params }: Route.LoaderArgs) {
  if (!params.slug) {
    throw data(null, { status: 404 });
  }
  try {
    const { body, frontmatter } = await getNewsPost(params.slug);
    return {
      frontmatter,
      body,
      siteUrl: process.env.SITE_URL || "http://localhost:3000",
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw data(null, { status: 404 });
    }
    throw data(null, { status: 500 });
  }
}

export default function Post({
  loaderData: { frontmatter, body },
}: Route.ComponentProps) {
  return (
    <main className="bg-[#f4f6f8] px-5 py-12 text-[#10141d] sm:px-8 lg:py-20">
      <article className="mx-auto max-w-4xl">
        <Link
          className="inline-flex items-center gap-2 text-sm font-bold text-[#4258e8]"
          to="/news"
        >
          <ArrowLeft className="size-4" /> 회사 소식으로 돌아가기
        </Link>
        <header className="mt-10">
          <Badge variant="secondary">{frontmatter.category}</Badge>
          <h1 className="mt-5 text-4xl font-black leading-[1.08] tracking-[-.05em] sm:text-6xl">
            {frontmatter.title}
          </h1>
          <p className="mt-6 text-xl leading-8 text-[#5f6674]">
            {frontmatter.description}
          </p>
          <div className="mt-6 flex flex-wrap gap-x-3 text-sm text-[#7a8291]">
            <span>{frontmatter.author}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={frontmatter.date}>
              {new Date(frontmatter.date).toLocaleDateString("ko-KR")}
            </time>
          </div>
        </header>
        <img
          alt=""
          className="mt-10 aspect-[16/9] w-full rounded-[2rem] object-cover"
          src={frontmatter.image}
        />
        <div className="mt-12 rounded-[2rem] bg-white p-7 shadow-[0_16px_60px_rgba(23,32,53,.06)] sm:p-12">
          <NewsBody body={body} />
        </div>
      </article>
    </main>
  );
}
