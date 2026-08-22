import type { Route } from "./+types/policy";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Link, data } from "react-router";

import { Button } from "~/core/components/ui/button";

const legalDocuments = {
  "privacy-policy": "privacy-policy.mdx",
  "terms-of-service": "terms-of-service.mdx",
} as const;

type LegalSlug = keyof typeof legalDocuments;
type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "unordered-list"; items: string[] }
  | { kind: "ordered-list"; items: string[] };

function isLegalSlug(value: string | undefined): value is LegalSlug {
  return value !== undefined && value in legalDocuments;
}

function parseDocument(source: string) {
  const frontmatterEnd = source.startsWith("---\n")
    ? source.indexOf("\n---\n", 4)
    : -1;
  if (frontmatterEnd < 0) throw new Error("Legal document frontmatter is missing");

  const frontmatter = Object.fromEntries(
    source
      .slice(4, frontmatterEnd)
      .split("\n")
      .map((line) => line.split(/:(.*)/s).slice(0, 2).map((value) => value.trim()))
      .filter(([key, value]) => key && value),
  );
  if (!frontmatter.title || !frontmatter.description) {
    throw new Error("Legal document title or description is missing");
  }

  const blocks: Block[] = [];
  const lines = source.slice(frontmatterEnd + 5).split(/\r?\n/);
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (paragraph.length) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
    if (list) {
      blocks.push({
        kind: list.ordered ? "ordered-list" : "unordered-list",
        items: list.items,
      });
      list = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4,
        text: heading[2],
      });
      continue;
    }
    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    const unordered = /^-\s+(.+)$/.exec(line);
    if (ordered || unordered) {
      const isOrdered = Boolean(ordered);
      if (list && list.ordered !== isOrdered) flush();
      list ??= { ordered: isOrdered, items: [] };
      list.items.push((ordered ?? unordered)![1]);
      continue;
    }
    if (list) flush();
    paragraph.push(line);
  }
  flush();
  return { frontmatter, blocks };
}

export const meta: Route.MetaFunction = ({ data: loaderData }) =>
  loaderData
    ? [
        { title: `${loaderData.frontmatter.title} | ${import.meta.env.VITE_APP_NAME}` },
        { name: "description", content: loaderData.frontmatter.description },
      ]
    : [{ title: `404 | ${import.meta.env.VITE_APP_NAME}` }];

export async function loader({ params }: Route.LoaderArgs) {
  if (!isLegalSlug(params.slug)) throw data(null, { status: 404 });
  const filePath = path.join(
    process.cwd(),
    "app/features/legal/docs",
    legalDocuments[params.slug],
  );
  try {
    return parseDocument(await readFile(filePath, "utf8"));
  } catch (error) {
    console.error("Failed to load legal document", error);
    throw data(null, { status: 500 });
  }
}

export default function Policy({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-10 px-5 py-10 md:px-10 md:py-20">
      <Button variant="outline" asChild>
        <Link to="/" viewTransition>
          &larr; 홈으로
        </Link>
      </Button>
      <article className="space-y-5">
        {loaderData.blocks.map((block, index) => {
          if (block.kind === "heading") {
            const Heading = `h${block.level}` as "h1" | "h2" | "h3" | "h4";
            return (
              <Heading
                key={index}
                className={
                  block.level === 1
                    ? "text-4xl font-bold tracking-tight"
                    : "mt-8 text-2xl font-semibold tracking-tight"
                }
              >
                {block.text}
              </Heading>
            );
          }
          if (block.kind === "paragraph") {
            return (
              <p key={index} className="leading-7 text-slate-700">
                {block.text}
              </p>
            );
          }
          const List = block.kind === "ordered-list" ? "ol" : "ul";
          return (
            <List
              key={index}
              className={`ml-6 space-y-2 ${block.kind === "ordered-list" ? "list-decimal" : "list-disc"}`}
            >
              {block.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </List>
          );
        })}
      </article>
    </main>
  );
}
