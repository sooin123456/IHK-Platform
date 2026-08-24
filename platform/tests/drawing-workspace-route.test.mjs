import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import routes from "../app/routes.ts";

function flatten(routesToFlatten) {
  return routesToFlatten.flatMap((route) => [
    route,
    ...flatten(route.children ?? []),
  ]);
}

test("workspace route is additive and keeps the collaboration room", () => {
  const registered = flatten(routes).filter((route) =>
    route.path?.startsWith("/projects/:projectId/drawings/:fileId"),
  );
  assert.deepEqual(
    registered.map((route) => [route.path, route.file]),
    [
      [
        "/projects/:projectId/drawings/:fileId",
        "lukas/screens/drawing-room.tsx",
      ],
      [
        "/projects/:projectId/drawings/:fileId/workspace",
        "lukas/screens/drawing-workspace.tsx",
      ],
    ],
  );
});

test("collaboration room exposes an accessible link to the additive workspace", async () => {
  const source = await readFile(
    new URL("../app/lukas/screens/drawing-room.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /to=\{`\/projects\/\$\{project\.id\}\/drawings\/\$\{room\.file\.id\}\/workspace`\}/,
  );
  assert.match(source, />\s*도면 편집 작업실\s*</);
});

test("workspace screen offers blank and PDF-background creation without replacing the room", async () => {
  const source = await readFile(
    new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /빈 도면/);
  assert.match(source, /PDF 배경 사용/);
  assert.match(source, /document_mode/);
  assert.match(source, /actionData\?\.error/);
});

test("workspace document renders the accessible editor shell", async () => {
  const [screen, shell] = await Promise.all([
    readFile(
      new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-workspace.client.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(screen, /DrawingWorkspaceClient/);
  assert.match(screen, /협업 도면실/);
  assert.match(shell, /도면 작업실/);
  assert.match(shell, /저장됨/);
  assert.match(shell, /aria-label="저장"/);
  assert.match(shell, /aria-label="실행 취소"/);
  assert.match(shell, /aria-label="다시 실행"/);
  assert.match(shell, /aria-label="레이어 패널"/);
  assert.match(shell, /aria-label="도면 캔버스"/);
  assert.match(shell, /aria-label="속성 검사기"/);
});
