import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import React, { createElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { ThemeProvider } from "remix-themes";
import { createServer } from "vite";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});

const [
  { default: Home },
  { default: NavigationLayout },
  { NavigationBar, NavigationMenuLinks },
  { Sheet },
] = await Promise.all([
  vite.ssrLoadModule("/app/features/home/screens/home.tsx"),
  vite.ssrLoadModule("/app/core/layouts/navigation.layout.tsx"),
  vite.ssrLoadModule("/app/core/components/navigation-bar.tsx"),
  vite.ssrLoadModule("/app/core/components/ui/sheet.tsx"),
]);

test.after(() => vite.close());

function renderInRouter(Component, props = {}) {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { specifiedTheme: "light", themeAction: "/theme" },
      createElement(
        MemoryRouter,
        { initialEntries: ["/"] },
        createElement(Component, props),
      ),
    ),
  );
}

function countMatches(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

test("home offers software use as the primary path and commissioned work as a separate service", () => {
  const html = renderInRouter(Home);

  assert.match(html, /href="\/workspace"[^>]*>직접 작업하기/);
  assert.match(html, /작업실에서 직접 도면을 작성하고 검토/);
  assert.match(html, /href="\/inquiry"[^>]*>전문가에게 의뢰하기/);
  assert.match(html, /전문가가 별도 범위로 모델링과 수량 업무를 수행/);
});

test("home explains that authoring, review, and quantity work share one workspace without overstating automation", () => {
  const html = renderInRouter(Home);

  for (const task of ["작성", "검토", "수량·견적"]) {
    assert.match(html, new RegExp(`>${task}<`));
  }
  assert.match(html, /하나의 작업실/);
  assert.match(html, /빈 도면이나 템플릿/);
  assert.match(html, /담당자가 확인/);
  assert.doesNotMatch(html, /자동으로 (?:최종 )?(?:수량|견적).*확정/);
  assert.doesNotMatch(html, /DWG (?:완벽|완전|네이티브) 지원/);
});

test("the actual public navigation bar exposes one product and one professional-service entry", () => {
  const html = renderInRouter(NavigationBar, { loading: false });

  assert.equal(countMatches(html, /href="\/workspace"[^>]*>직접 작업하기/g), 1);
  assert.equal(
    countMatches(html, /href="\/inquiry"[^>]*>전문가에게 의뢰하기/g),
    1,
  );
  assert.match(html, /href="\/news"[^>]*>소식/);
  assert.match(html, /href="\/download"[^>]*>무료 다운로드/);
  assert.match(html, /href="\/auth\/magic-link"[^>]*>고객 로그인/);
});

test("the actual authenticated navigation bar keeps product and service entry alongside account controls", () => {
  const html = renderInRouter(NavigationBar, {
    email: "architect@example.com",
    loading: false,
  });

  assert.equal(countMatches(html, /href="\/workspace"[^>]*>직접 작업하기/g), 1);
  assert.equal(
    countMatches(html, /href="\/inquiry"[^>]*>전문가에게 의뢰하기/g),
    1,
  );
  assert.match(html, />architect@example\.com</);
  assert.match(html, /href="\/notifications"[^>]*>알림/);
  assert.match(html, /href="\/logout"[^>]*>로그아웃/);
  assert.doesNotMatch(html, /href="\/workspace"[^>]*>프로젝트/);
});

test("the rendered authenticated mobile menu uses the same unique product and service entries", () => {
  function AuthenticatedMobileMenu() {
    return createElement(
      Sheet,
      null,
      createElement(NavigationMenuLinks, {
        email: "architect@example.com",
        mobile: true,
      }),
    );
  }
  const html = renderInRouter(AuthenticatedMobileMenu);

  assert.equal(countMatches(html, /href="\/workspace"[^>]*>직접 작업하기/g), 1);
  assert.equal(
    countMatches(html, /href="\/inquiry"[^>]*>전문가에게 의뢰하기/g),
    1,
  );
  assert.match(html, /href="\/notifications"[^>]*>알림/);
  assert.match(html, /href="\/logout"[^>]*>로그아웃/);
});

test("the public layout does not add a separate product-service navigation landmark", async () => {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: createElement(NavigationLayout, {
          loaderData: { userPromise: Promise.resolve({ user: null }) },
        }),
        children: [{ index: true, element: createElement(Home) }],
      },
    ],
    { initialEntries: ["/"] },
  );
  const stream = await renderToReadableStream(
    createElement(
      ThemeProvider,
      { specifiedTheme: "light", themeAction: "/theme" },
      createElement(RouterProvider, { router }),
    ),
  );
  await stream.allReady;
  const html = await new Response(stream).text();

  assert.doesNotMatch(html, /aria-label="제품과 전문 서비스"/);
});

test("product-first home keeps Revit free-beta and company-news paths accessible", () => {
  const html = renderInRouter(Home);

  assert.match(html, /href="\/download"[^>]*>무료 베타 다운로드/);
  assert.match(html, /href="\/download"[^>]*>Revit 2025 베타 보기/);
  assert.match(html, /href="\/news"[^>]*>모든 소식 보기/);
});
