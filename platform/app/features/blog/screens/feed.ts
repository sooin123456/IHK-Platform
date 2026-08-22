import type { Route } from "./+types/feed";

import { getNewsPosts } from "../news.server";

function xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function loader({ request }: Route.LoaderArgs) {
  const configured = process.env.SITE_URL;
  const origin = configured
    ? new URL(configured).origin
    : new URL(request.url).origin;
  const posts = await getNewsPosts();
  const items = posts
    .map((post) => {
      const url = `${origin}/news/${post.slug}`;
      return `<item>
  <title>${xml(post.title)}</title>
  <link>${xml(url)}</link>
  <guid isPermaLink="true">${xml(url)}</guid>
  <pubDate>${new Date(post.date).toUTCString()}</pubDate>
  <category>${xml(post.category)}</category>
  <description>${xml(post.description)}</description>
</item>`;
    })
    .join("\n");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>한길시스템 소식</title>
  <link>${xml(`${origin}/news`)}</link>
  <description>한길시스템의 BIM 적산 연구, Lukas QTO 개발과 현장 검증 소식</description>
  <language>ko-KR</language>
  ${items}
</channel>
</rss>`,
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=3600",
        "Content-Type": "application/rss+xml; charset=utf-8",
      },
    },
  );
}
