import { strToU8, zipSync } from "fflate";

import type { VerifiedBoqResult } from "./verified-boq.server.ts";

export type VerifiedBoqWorkbookInput = {
  result: VerifiedBoqResult;
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
};

const xml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

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
              `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
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
    ...input.mappings.map((row) => [
      row.itemCode,
      row.sourceFilename,
      row.sourceSha256,
      row.subjectKey,
      row.sourceQuantity,
      row.factor,
      row.unit,
      row.elementIds.join("|"),
      "포함",
      "",
    ]),
    ...(input.exclusions ?? []).map((row) => [
      "",
      row.sourceFilename,
      row.sourceSha256,
      row.subjectKey,
      row.sourceQuantity,
      "",
      row.unit,
      row.elementIds.join("|"),
      "제외",
      row.reason,
    ]),
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
  return zipSync(files, { level: 6 });
}
