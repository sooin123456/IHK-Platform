import { createHash } from "node:crypto";

import { parseCsv } from "./element-ledger-suggestions.server.ts";

const header = "element_id,category,family,type,element_name,level,volume_state,volume_m3,volume_source_parameter,length_state,length_m,length_source_parameter,height_state,height_m,height_source_parameter".split(",");
const globalIdPattern = /^[0-9A-Za-z_$]{22}$/;

export function verifyElementIdentityPair(
  ledgerBytes: Uint8Array,
  ifcBytes: Uint8Array,
  revitElementId: string,
  ifcGlobalId: string,
) {
  if (!/^[1-9][0-9]{0,18}$/.test(revitElementId))
    throw new Error("Revit Element ID는 64비트 범위의 양의 정수여야 합니다.");
  if (!globalIdPattern.test(ifcGlobalId))
    throw new Error("IFC GlobalId는 22자리 압축 GUID여야 합니다.");
  const ledger = parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(ledgerBytes));
  if (
    ledger.length < 2 ||
    ledger[0].length !== header.length ||
    !header.every((name, index) => ledger[0][index] === name)
  )
    throw new Error("element-ledger.csv 계약이 올바르지 않습니다.");
  const matches = ledger.slice(1).filter((row) => row[0] === revitElementId);
  if (matches.length !== 1)
    throw new Error("선택한 Revit Element ID가 원장에 정확히 한 번 존재해야 합니다.");
  const ifc = new TextDecoder("utf-8", { fatal: true }).decode(ifcBytes);
  const escaped = ifcGlobalId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const entity = new RegExp(
    `#[1-9][0-9]*\\s*=\\s*IFC[A-Z0-9_]+\\s*\\(\\s*'${escaped}'(?:\\s*,|\\s*\\))`,
    "i",
  );
  if (!entity.test(ifc))
    throw new Error("선택한 IFC GlobalId가 IFC 엔터티의 첫 식별자로 존재하지 않습니다.");
  return {
    revitElementId,
    ifcGlobalId,
    ledgerSha256: createHash("sha256").update(ledgerBytes).digest("hex"),
    ifcSha256: createHash("sha256").update(ifcBytes).digest("hex"),
    category: matches[0][1],
    family: matches[0][2],
    type: matches[0][3],
    elementName: matches[0][4],
    level: matches[0][5],
  };
}
