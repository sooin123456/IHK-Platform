import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  IFC_DERIVATIVE_REFRESH_LIMIT,
  ifcDerivativeRefreshDelay,
  ifcDerivativeStatusPresentation,
} from "../app/lukas/lib/drawing-ifc-derivative-status.ts";

test("IFC derivative states explain real queue progress without fake pending", () => {
  const cases = [
    ["not_queued", false, /등록되지/],
    ["queued", true, /대기/],
    ["processing", true, /생성 중/],
    ["retry_wait", true, /재시도/],
    ["completed", true, /완료/],
    ["pending", true, /생성 중/],
    ["failed", false, /만들지 못/],
  ];
  for (const [status, waiting, message] of cases) {
    const presentation = ifcDerivativeStatusPresentation(status);
    assert.equal(presentation.waiting, waiting, status);
    assert.match(presentation.message, message, status);
  }
});

test("queue refresh uses bounded backoff and stops on terminal states", () => {
  for (const status of [
    "queued",
    "processing",
    "retry_wait",
    "completed",
    "pending",
  ]) {
    const first = ifcDerivativeRefreshDelay(status, 0);
    const later = ifcDerivativeRefreshDelay(status, 5);
    assert.equal(typeof first, "number", status);
    assert.ok(first > 0, status);
    assert.ok(later >= first, status);
    assert.equal(
      ifcDerivativeRefreshDelay(status, IFC_DERIVATIVE_REFRESH_LIMIT),
      null,
      status,
    );
  }
  for (const status of ["not_queued", "failed", "ready", "not_applicable"])
    assert.equal(ifcDerivativeRefreshDelay(status, 0), null, status);
});

test("all authenticated IFC surfaces wire bounded revalidation to the viewer", async () => {
  const [browser, workspace, room, standalone] = await Promise.all([
    readFile(
      new URL(
        "../app/lukas/components/ifc-property-browser.client.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-room.client.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../app/lukas/screens/ifc-browser.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(browser, /ifcDerivativeRefreshDelay\(/);
  assert.match(browser, /document\.visibilityState === "hidden"/);
  assert.match(browser, /onDerivativeRefreshRef/);
  assert.match(browser, /window\.clearTimeout/);
  assert.match(workspace, /derivative=\{selectedIfc\.derivative\}/);
  assert.match(workspace, /onDerivativeRefresh=\{revalidator\.revalidate\}/);
  assert.match(room, /onDerivativeRefresh=\{revalidator\.revalidate\}/);
  assert.match(standalone, /const revalidator = useRevalidator\(\)/);
  assert.match(standalone, /onDerivativeRefresh=\{revalidator\.revalidate\}/);
});
