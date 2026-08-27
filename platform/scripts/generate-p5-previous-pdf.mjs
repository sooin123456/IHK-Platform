import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PDFDocument, rgb } from "pdf-lib";

const source = fileURLToPath(
  new URL(
    "../../.superpowers/sdd/2026-08-25-drawing-workspace-p2/task-10-artifacts/representative-drawing.pdf",
    import.meta.url,
  ),
);
const target = fileURLToPath(
  new URL("../tests/fixtures/p5-previous-revision.pdf", import.meta.url),
);
const document = await PDFDocument.load(await readFile(source));
const fixedDate = new Date("2026-01-01T00:00:00.000Z");
document.setCreationDate(fixedDate);
document.setModificationDate(fixedDate);
document.setTitle("1HK P5 synthetic prior revision");
const page = document.getPage(0);
page.drawRectangle({
  x: 36,
  y: page.getHeight() - 84,
  width: 144,
  height: 36,
  color: rgb(0.75, 0.08, 0.08),
  borderColor: rgb(0.4, 0, 0),
  borderWidth: 2,
});
await writeFile(target, await document.save({ useObjectStreams: false }));
