import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Self-authored vector data only. Preserve the public predecessor's page sizes.
// Run: node scripts/generate-p5-current-pdf.mjs
const sizes = [
  [3370.393700787402, 2383.9370078740158],
  [3370.393700787402, 2383.9370078740158],
  [2383.9370078740158, 1683.7795275590552],
];
const target = new URL(
  "../tests/fixtures/p5-current-revision.pdf",
  import.meta.url,
);
const document = await PDFDocument.create();
const fixedDate = new Date("2026-01-01T00:00:00.000Z");
document.setCreationDate(fixedDate);
document.setModificationDate(fixedDate);
document.setTitle("1HK synthetic current revision - NOT FOR CONSTRUCTION");
document.setAuthor("1HK synthetic fixture generator");
document.setCreator("1HK public PDF fixture");
document.setProducer("1HK public PDF fixture / pdf-lib 1.17.1");
document.setSubject("Self-authored technical vectors for local preview tests");
const regular = await document.embedFont(StandardFonts.Helvetica);
const bold = await document.embedFont(StandardFonts.HelveticaBold);
const ink = rgb(0.12, 0.19, 0.26);
const accent = rgb(0.05, 0.4, 0.47);
const pale = rgb(0.9, 0.95, 0.96);
const grid = rgb(0.83, 0.87, 0.89);
const titles = [
  "A-101 / SYNTHETIC PLAN",
  "A-201 / SYNTHETIC SECTION",
  "D-301 / SYNTHETIC DETAIL",
];

for (const [index, size] of sizes.entries()) {
  const page = document.addPage(size);
  const scale = Math.min(size[0] / 1000, size[1] / 710);
  const text = (value, x, y, fontSize = 13, strong = false, color = ink) =>
    page.drawText(value, {
      x: x * scale,
      y: y * scale,
      size: fontSize * scale,
      font: strong ? bold : regular,
      color,
    });
  const line = (x1, y1, x2, y2, width = 1, color = ink) =>
    page.drawLine({
      start: { x: x1 * scale, y: y1 * scale },
      end: { x: x2 * scale, y: y2 * scale },
      thickness: width * scale,
      color,
    });
  const box = (
    x,
    y,
    width,
    height,
    fill = pale,
    border = ink,
    borderWidth = 2,
  ) =>
    page.drawRectangle({
      x: x * scale,
      y: y * scale,
      width: width * scale,
      height: height * scale,
      color: fill,
      borderColor: border,
      borderWidth: borderWidth * scale,
    });

  box(24, 24, 952, 662, rgb(1, 1, 1), grid, 1);
  text("1HK / PUBLIC WORKSPACE FIXTURE", 44, 655, 13, true, accent);
  text(titles[index], 44, 622, 25, true);
  text("SYNTHETIC - NOT FOR CONSTRUCTION", 44, 589, 17, true, accent);
  text(
    "No real site or design. Diagram coordinates are uncalibrated fixture units.",
    44,
    566,
    12,
  );
  line(44, 550, 956, 550, 1, grid);

  if (index === 0) {
    for (const x of [120, 360, 600, 840]) line(x, 135, x, 510, 0.7, grid);
    for (const y of [170, 330, 490]) line(90, y, 885, y, 0.7, grid);
    box(120, 170, 720, 320, pale, ink, 5);
    line(360, 170, 360, 490, 4);
    line(600, 170, 600, 490, 4);
    line(120, 330, 600, 330, 4);
    for (const [label, x, y] of [
      ["ROOM A", 175, 405],
      ["ROOM B", 415, 405],
      ["ROOM C", 175, 245],
      ["ROOM D", 415, 245],
      ["HALL", 670, 325],
    ]) {
      text(label, x, y, 17, true);
      text("TEST GEOMETRY", x, y - 24, 10, false, accent);
    }
    for (const x of [195, 435, 675])
      box(x, 482, 80, 16, rgb(1, 1, 1), accent, 2);
    line(120, 125, 840, 125, 1, accent);
    line(120, 115, 120, 140, 1, accent);
    line(840, 115, 840, 140, 1, accent);
    text(
      "720 FIXTURE UNITS / NOT A MEASURED DISTANCE",
      295,
      98,
      12,
      true,
      accent,
    );
  } else if (index === 1) {
    for (const y of [180, 320, 460]) {
      box(135, y, 690, 14, pale, ink, 3);
      line(95, y, 880, y, 0.6, grid);
    }
    for (const x of [155, 465, 785]) box(x, 194, 20, 266, pale, ink, 3);
    line(120, 180, 850, 180, 4, accent);
    for (const [y, name] of [
      [230, "TEST LEVEL 01"],
      [370, "TEST LEVEL 02"],
    ]) {
      text(name, 245, y, 18, true);
      text("VOID / SYNTHETIC SECTION", 515, y, 13, false, accent);
    }
    text("SECTION A-A / UNCALIBRATED", 335, 125, 14, true, accent);
  } else {
    box(165, 180, 160, 310, pale, ink, 4);
    box(325, 285, 435, 55, pale, ink, 4);
    for (let y = 190; y < 480; y += 22) line(174, y, 312, y + 10, 0.8, grid);
    for (let x = 335; x < 750; x += 22) line(x, 292, x + 10, 331, 0.8, grid);
    line(245, 440, 480, 485, 1, accent);
    text("01 / SYNTHETIC VERTICAL MEMBER", 485, 482, 13, true, accent);
    line(575, 312, 680, 410, 1, accent);
    text("02 / TEST JOINT", 685, 411, 13, true, accent);
    text("DETAIL 01 / VECTOR RENDERING SAMPLE", 225, 125, 14, true, accent);
  }

  line(44, 78, 956, 78, 1, grid);
  text(
    "SELF-AUTHORED TEST DATA / NO SITE, DESIGN OR CALIBRATED DIMENSIONS",
    44,
    56,
    11,
    true,
  );
  text(
    `FIXTURE REVISION 02 / PAGE ${index + 1} OF 3`,
    695,
    36,
    11,
    false,
    accent,
  );
}

const bytes = await document.save({ useObjectStreams: false });
await writeFile(target, bytes);
console.log(
  JSON.stringify({
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }),
);
