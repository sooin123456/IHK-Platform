import { strToU8, zipSync } from "fflate";

import type { VerifiedBoqResult } from "./verified-boq.server.ts";
import type { VerifiedBoqV1_1Result } from "./verified-boq-v1-1.server.ts";
import type { VerifiedBoqWorkbookDrawingEvidence } from "./verified-boq-approved-export.server.ts";

export type VerifiedBoqWorkbookInput = {
  result: VerifiedBoqResult | VerifiedBoqV1_1Result;
  resources: Array<{
    code: string;
    type: string;
    name: string;
    specification: string;
    unit: string;
    unitPriceKrw: string;
  }>;
  mappings: Array<{
    itemCode: string;
    sourceFilename: string;
    sourceSha256: string;
    subjectKey: string;
    sourceQuantity: string;
    factor: string;
    unit: string;
    elementIds: string[];
  }>;
  exclusions?: Array<{
    sourceFilename: string;
    sourceSha256: string;
    subjectKey: string;
    sourceQuantity: string;
    unit: string;
    elementIds: string[];
    reason: string;
  }>;
  structures: Array<{
    itemCode: string;
    cbsCode: string;
    cbsName: string;
    wbsCode: string;
    wbsName: string;
    allocationPercent: string;
  }>;
  review: {
    projectName: string;
    versionLabel: string;
    status: string;
    makerId: string;
    approvals: Array<{
      decision: string;
      note: string;
      decidedBy: string;
      createdAt: string;
    }>;
  };
  drawingEvidence?: VerifiedBoqWorkbookDrawingEvidence[];
  approvedManifest?: {
    resultSha256: string;
    manifestSha256: string;
    handoffSha256: string;
    versionId: string;
    decidedBy: string;
    decidedAt: string;
    note: string;
    canonicalJson: string;
  };
};

function xmlText(value: string) {
  let valid = "";
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (
      code === 0x9 ||
      code === 0xa ||
      code === 0xd ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff)
    )
      valid += character;
  }
  return valid
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function excelTextChunks(value: string) {
  const chunks: string[] = [];
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + 32_767, value.length);
    if (
      end < value.length &&
      /[\uD800-\uDBFF]/.test(value[end - 1]) &&
      /[\uDC00-\uDFFF]/.test(value[end])
    )
      end -= 1;
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks.length ? chunks : [""];
}

function columnName(index: number) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function sheet(rows: string[][]) {
  const body = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map(
            (value, columnIndex) =>
              `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function buildEvidenceRows(
  rows: VerifiedBoqWorkbookInput["mappings"],
  decision: "포함",
): string[][];
function buildEvidenceRows(
  rows: NonNullable<VerifiedBoqWorkbookInput["exclusions"]>,
  decision: "제외",
): string[][];
function buildEvidenceRows(
  rows:
    | VerifiedBoqWorkbookInput["mappings"]
    | NonNullable<VerifiedBoqWorkbookInput["exclusions"]>,
  decision: "포함" | "제외",
) {
  return rows.flatMap((row) => {
    const chunks = excelTextChunks(row.elementIds.join("|"));
    return chunks.map((chunk, index) => [
      "itemCode" in row ? row.itemCode : "",
      row.sourceFilename,
      row.sourceSha256,
      row.subjectKey,
      row.sourceQuantity,
      "factor" in row ? row.factor : "",
      row.unit,
      chunk,
      chunks.length === 1
        ? decision
        : `${decision} (요소 ID ${index + 1}/${chunks.length})`,
      "reason" in row ? row.reason : "",
    ]);
  });
}

export function buildVerifiedBoqXlsx(input: VerifiedBoqWorkbookInput) {
  const boqRows = [
    [
      "공종",
      "품목코드",
      "품목명",
      "규격",
      "단위",
      "원수량",
      "보정수량",
      "최종수량",
      "재료단가",
      "노무단가",
      "경비단가",
      "합계단가",
      "금액",
      "계산식",
      "상태",
    ],
    ...input.result.lines.map((line) => [
      line.sectionCode,
      line.itemCode,
      line.itemName,
      line.specification,
      line.unit,
      line.rawQuantity ?? "",
      line.adjustment,
      line.finalQuantity ?? "",
      line.materialUnitPriceKrw ?? "",
      line.laborUnitPriceKrw ?? "",
      line.expenseUnitPriceKrw ?? "",
      line.totalUnitPriceKrw ?? "",
      line.amountKrw ?? "",
      line.formula,
      line.status,
    ]),
    [
      "",
      "",
      "직접공사비",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      input.result.directCostKrw,
      "",
      input.result.status,
    ],
  ];
  const resourceRows = [
    ["자원코드", "구분", "자원명", "규격", "단위", "단가(원)"],
    ...input.resources.map((row) => [
      row.code,
      row.type,
      row.name,
      row.specification,
      row.unit,
      row.unitPriceKrw,
    ]),
  ];
  const evidenceRows = [
    [
      "품목코드",
      "원본파일",
      "원본 파일 확인번호",
      "원수량 묶음",
      "원수량",
      "계수",
      "단위",
      "Revit Element ID",
      "결정",
      "사유",
    ],
    ...buildEvidenceRows(input.mappings, "포함"),
    ...buildEvidenceRows(input.exclusions ?? [], "제외"),
  ];
  const reviewRows = [
    ["항목", "값"],
    ["프로젝트", input.review.projectName],
    ["내역 버전", input.review.versionLabel],
    ["상태", input.review.status],
    ["계산 엔진", input.result.engineVersion],
    ["결과 확인번호", input.result.canonicalSha256],
    ["작성자 ID", input.review.makerId],
    ...input.review.approvals.flatMap((approval, index) => [
      [`결정 ${index + 1}`, approval.decision],
      [`결정자 ${index + 1}`, approval.decidedBy],
      [`메모 ${index + 1}`, approval.note],
      [`결정시각 ${index + 1}`, approval.createdAt],
    ]),
  ];
  const structureRows = [
    [
      "품목코드",
      "CBS 코드",
      "CBS 공종",
      "WBS 코드",
      "WBS 작업 위치",
      "배분율(%)",
    ],
    ...input.structures.map((row) => [
      row.itemCode,
      row.cbsCode,
      row.cbsName,
      row.wbsCode,
      row.wbsName,
      row.allocationPercent,
    ]),
  ];
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet5.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="공종별내역서" sheetId="1" r:id="rId1"/><sheet name="자원단가" sheetId="2" r:id="rId2"/><sheet name="매핑근거" sheetId="3" r:id="rId3"/><sheet name="검토정보" sheetId="4" r:id="rId4"/><sheet name="WBS-CBS" sheetId="5" r:id="rId5"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet5.xml"/></Relationships>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(sheet(boqRows)),
    "xl/worksheets/sheet2.xml": strToU8(sheet(resourceRows)),
    "xl/worksheets/sheet3.xml": strToU8(sheet(evidenceRows)),
    "xl/worksheets/sheet4.xml": strToU8(sheet(reviewRows)),
    "xl/worksheets/sheet5.xml": strToU8(sheet(structureRows)),
  };
  const drawingEvidence = input.drawingEvidence;
  const approvedManifest = input.approvedManifest;
  if (drawingEvidence && approvedManifest) {
    const drawingRows = [
      [
        "품목코드",
        "수량 연결 ID",
        "도면 개정 ID",
        "개정 버전",
        "스냅샷 확인번호",
        "객체 ID",
        "계보 ID",
        "객체 버전",
        "객체 지문",
        "측정 종류",
        "단위",
        "원수량",
        "배분 계수",
        "측정 규칙",
        "원본 anchor ID",
        "원본 파일 확인번호",
        "이슈 ID",
        "결과 확인번호",
        "계산 manifest 확인번호",
        "인계 확인번호",
      ],
      ...drawingEvidence.map((row) => [
        row.itemCode,
        row.quantityLinkId,
        row.revisionId,
        String(row.revisionVersion),
        row.snapshotSha256,
        row.objectId,
        row.lineageId,
        String(row.objectVersion),
        row.objectFingerprint,
        row.measurementKind,
        row.unit,
        row.rawQuantity,
        row.allocationFactor,
        row.measurementRuleVersion,
        row.sourceAnchorIds.join("|"),
        row.sourceFileSha256.join("|"),
        row.issueIds.join("|"),
        approvedManifest.resultSha256,
        approvedManifest.manifestSha256,
        approvedManifest.handoffSha256,
      ]),
    ];
    const manifestRows = [
      ["항목", "값"],
      ["내역 버전 ID", approvedManifest.versionId],
      ["결과 확인번호", approvedManifest.resultSha256],
      ["계산 manifest 확인번호", approvedManifest.manifestSha256],
      ["인계 확인번호", approvedManifest.handoffSha256],
      ["승인자 ID", approvedManifest.decidedBy],
      ["승인시각", approvedManifest.decidedAt],
      ["승인 메모", approvedManifest.note],
      ...excelTextChunks(approvedManifest.canonicalJson).map((value, index) => [
        `정규 manifest JSON ${index + 1}`,
        value,
      ]),
    ];
    files["[Content_Types].xml"] = strToU8(
      new TextDecoder()
        .decode(files["[Content_Types].xml"])
        .replace(
          "</Types>",
          '<Override PartName="/xl/worksheets/sheet6.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet7.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        ),
    );
    files["xl/workbook.xml"] = strToU8(
      new TextDecoder()
        .decode(files["xl/workbook.xml"])
        .replace(
          "</sheets>",
          '<sheet name="도면근거" sheetId="6" r:id="rId6"/><sheet name="승인·매니페스트" sheetId="7" r:id="rId7"/></sheets>',
        ),
    );
    files["xl/_rels/workbook.xml.rels"] = strToU8(
      new TextDecoder()
        .decode(files["xl/_rels/workbook.xml.rels"])
        .replace(
          "</Relationships>",
          '<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet6.xml"/><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet7.xml"/></Relationships>',
        ),
    );
    files["xl/worksheets/sheet6.xml"] = strToU8(sheet(drawingRows));
    files["xl/worksheets/sheet7.xml"] = strToU8(sheet(manifestRows));
  }
  return zipSync(files, { level: 6 });
}
