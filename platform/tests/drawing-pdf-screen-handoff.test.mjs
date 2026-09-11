import assert from "node:assert/strict";
import test from "node:test";
import * as handoff from "../app/lukas/lib/drawing-pdf-screen-handoff.ts";

test("PDF recovery compares bytes, not filenames, and never accepts missing identity", async () => {
  assert.equal(typeof handoff.localPdfFingerprint,"function");
  const hash=await handoff.localPdfFingerprint(new File(["abc"],"original.pdf"));
  assert.equal(hash,"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(await handoff.isSameLocalPdf(new File(["abc"],"renamed.pdf"),hash),true);
  assert.equal(await handoff.isSameLocalPdf(new File(["abd"],"original.pdf"),hash),false);
  assert.equal(await handoff.isSameLocalPdf(new File(["abc"],"original.pdf"),null),false);
});

import {
  localPdfSelectionError,
  peekLocalPdf,
  releaseLocalPdf,
  stageLocalPdf,
} from "../app/lukas/lib/drawing-pdf-screen-handoff.ts";

const MAX_LOCAL_PDF_BYTES = 50 * 1024 * 1024;

function pdf(name = "drawing.pdf", bytes = new Uint8Array([0x25])) {
  return new File([bytes], name, { type: "application/pdf" });
}

test("PDF selection validation accepts the case-insensitive 50 MiB boundary", () => {
  assert.equal(localPdfSelectionError(pdf("drawing.PDF")), null);
  assert.equal(
    localPdfSelectionError(
      pdf("boundary.pdf", Buffer.alloc(MAX_LOCAL_PDF_BYTES)),
    ),
    null,
  );
  assert.equal(
    localPdfSelectionError(new File(["x"], "drawing.txt")),
    "화면 미리보기에서는 PDF 파일을 열어 주세요.",
  );
  assert.equal(
    localPdfSelectionError(pdf("empty.pdf", new Uint8Array())),
    "내용이 없는 파일입니다. 다른 PDF를 선택해 주세요.",
  );
  assert.equal(
    localPdfSelectionError(
      pdf("oversize.pdf", Buffer.alloc(MAX_LOCAL_PDF_BYTES + 1)),
    ),
    "화면 미리보기는 50MB 이하의 PDF를 지원합니다.",
  );
});

test("staging returns a UUID token that peeks the same native File", () => {
  const file = pdf();
  const token = stageLocalPdf(file);

  assert.match(
    token,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.strictEqual(peekLocalPdf(token), file);

  releaseLocalPdf(token);
});

test("peek is nonconsuming for StrictMode double initialization", () => {
  const file = pdf("strict-mode.pdf");
  const token = stageLocalPdf(file);

  assert.strictEqual(peekLocalPdf(token), file);
  assert.strictEqual(peekLocalPdf(token), file);

  releaseLocalPdf(token);
});

test("only a matching token releases the pending File", () => {
  const file = pdf("release.pdf");
  const token = stageLocalPdf(file);

  releaseLocalPdf(crypto.randomUUID());
  assert.strictEqual(peekLocalPdf(token), file);

  releaseLocalPdf(token);
  assert.equal(peekLocalPdf(token), null);
});

test("a newer stage replaces the old slot and ignores stale release", () => {
  const first = pdf("first.pdf");
  const second = pdf("second.pdf");
  const firstToken = stageLocalPdf(first);
  const secondToken = stageLocalPdf(second);

  assert.equal(peekLocalPdf(firstToken), null);
  assert.strictEqual(peekLocalPdf(secondToken), second);

  releaseLocalPdf(firstToken);
  assert.strictEqual(peekLocalPdf(secondToken), second);

  releaseLocalPdf(secondToken);
});

test("an invalid candidate does not erase the valid pending File", () => {
  const valid = pdf("valid.pdf");
  const token = stageLocalPdf(valid);

  assert.throws(
    () => stageLocalPdf(new File(["not pdf"], "invalid.txt")),
    new Error("화면 미리보기에서는 PDF 파일을 열어 주세요."),
  );
  assert.strictEqual(peekLocalPdf(token), valid);

  releaseLocalPdf(token);
});
