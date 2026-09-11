import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

const preview =
  "/workspace-preview/drawing-workspace?p5BaselineTest=1&view=split";

async function responseDigest(
  page: import("@playwright/test").Page,
  path: string,
) {
  return page.evaluate(async (url) => {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return {
      bytes: bytes.byteLength,
      sha256: [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join(""),
    };
  }, path);
}

test.describe.configure({ mode: "serial", timeout: 120_000 });

test("P6 preview smoke keeps exact 10k/2k immutable evidence and split focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(preview, { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  const sourceBefore = await responseDigest(page, "/__p5-current.pdf");
  expect(sourceBefore).toEqual({
    bytes: 8_289,
    sha256: "298cdc57f86b73f96ad6c743e20d9fb76e08d9f8dc7b827b6558ff068f95c8db",
  });
  const surface = page.getByLabel(/도면 화면/);
  await expect(surface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "10000",
    { timeout: 60_000 },
  );
  await expect(page.getByLabel("P5 baseline object count")).toHaveText("10000");
  await expect(page.getByLabel("P5 baseline source link count")).toHaveText(
    "2000",
  );
  await expect(page.getByRole("button", { name: "분할 보기" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("3D 요소 115개를 표시했습니다.")).toBeVisible({
    timeout: 60_000,
  });
  await page.getByLabel("IFC 요소 검색").fill("2863");
  await page
    .getByRole("button", {
      name: /NZ-PFC Channels beam:300PFC40\.1:691733 #2863/,
    })
    .click();
  await expect(page.getByText("선택한 요소: #2863 IfcBeam")).toBeVisible();
  expect(await responseDigest(page, "/__p5-current.pdf")).toEqual(sourceBefore);
});

test("two preview contexts preserve fixture state across reload", async ({
  browser,
}) => {
  const first = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const second = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const firstPage = await first.newPage();
  const secondPage = await second.newPage();
  try {
    for (const page of [firstPage, secondPage]) {
      await page.goto(
        "/workspace-preview/drawing-workspace?verticalTest=1&realtimeTest=1",
        { waitUntil: "domcontentloaded" },
      );
      await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText(
        "준비됨",
      );
      await expect(
        page.getByRole("region", { name: "도면 캔버스" }),
      ).toBeVisible();
      await expect(
        page.getByText("빈 도면 배경을 표시하고 있습니다."),
      ).toBeVisible();
    }
    const digest = createHash("sha256")
      .update(
        await firstPage.getByLabel("P4 mounted workspace snapshot").innerText(),
      )
      .digest("hex");
    await firstPage.reload({ waitUntil: "domcontentloaded" });
    await expect(firstPage.getByLabel("미리보기 hydration 상태")).toHaveText(
      "준비됨",
    );
    expect(
      createHash("sha256")
        .update(
          await firstPage
            .getByLabel("P4 mounted workspace snapshot")
            .innerText(),
        )
        .digest("hex"),
    ).toBe(digest);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

const localAuthorityNames = [
  "P6_LOCAL_SUPABASE_URL",
  "P6_LOCAL_SUPABASE_ANON_KEY",
  "P6_LOCAL_SUPABASE_SERVICE_ROLE_KEY",
  "P6_REAL_POSTGRES_DATABASE_URL",
  "P6_LOCAL_MAKER_EMAIL",
  "P6_LOCAL_APPROVER_EMAIL",
  "P6_LOCAL_ATTACKER_EMAIL",
  "P6_LOCAL_VIEWER_EMAIL",
  "P6_LOCAL_PROJECT_ID",
  "P6_LOCAL_DRAWING_REVISION_ID",
  "P6_LOCAL_BOQ_VERSION_ID",
  "P6_LOCAL_MATERIAL_PLAN_ID",
  "P6_LOCAL_RESULT_SHA256",
  "P6_LOCAL_MANIFEST_SHA256",
];

if (localAuthorityNames.every((name) => process.env[name]?.trim())) {
  process.env.P6_E2E_PHASE = "local";
  await import("./drawing-workspace-p6-production.spec");
} else {
  test("local mounted server-action authority is configured", () => {
    throw new Error(
      `P6 local mounted server-action gate is UNEXECUTED: ${localAuthorityNames.join(", ")} are required`,
    );
  });
}
