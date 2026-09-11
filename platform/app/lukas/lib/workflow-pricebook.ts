import { z } from "zod";
export const priceBookEntrySchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  unit: z.enum(["m", "m²", "m³", "개"]),
  rate: z.number().finite().min(0).max(1e9),
  source: z.string().trim().min(1).max(500),
  version: z.number().int().positive(),
});
export type PriceBookEntry = z.infer<typeof priceBookEntrySchema>;
export function parsePriceBookCsvRows(text:string):{rows:string[][];errors:string[]} {
 if(text.length>100000)return {rows:[],errors:['입력은 100,000자 이하여야 합니다.']};
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  const input = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else field += char;
    } else if (char === "," || char === "\n") {
      row.push(field);
      field = "";
      closed = false;
      if (char === "\n") {
        rows.push(row);
        row = [];
      }
    } else if (char === '"' && !field && !closed) quoted = true;
    else if (char === '"' || closed)
      return { rows:[], errors: ["CSV 따옴표 형식이 잘못되었습니다."] };
    else field += char;
  }
  if (quoted) return { rows:[], errors: ["CSV 따옴표가 닫히지 않았습니다."] };
  if (field || row.length || closed) {
    row.push(field);
    rows.push(row);
  }

 return {rows,errors:[]};
}
export function mapPriceBookCsv(text:string,mapping:number[]){
 const parsed=parsePriceBookCsvRows(text);if(parsed.errors.length)return {csv:'',errors:parsed.errors};
 const width=parsed.rows[0]?.length??0;
 if(mapping.length!==5||new Set(mapping).size!==5||mapping.some(index=>!Number.isInteger(index)||index<0||index>=width))return {csv:'',errors:['다섯 필수 항목에 서로 다른 열을 연결하세요.']};
 if(parsed.rows.slice(1).some(row=>row.some(cell=>cell.trim())&&row.length!==width))return {csv:'',errors:['데이터 행의 열 개수가 제목 행과 다릅니다.']};
 const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
 return {csv:'코드,품목명,단위,단가,출처\n'+parsed.rows.slice(1).filter(row=>row.some(cell=>cell.trim())).map(row=>mapping.map(index=>quote(row[index]??'')).join(',')).join('\n'),errors:[]};
}
export function previewPriceBookCsv(text: string, existing: PriceBookEntry[]) {
 const entries:PriceBookEntry[]=[],errors:string[]=[];
 const parsedRows=parsePriceBookCsvRows(text);
 if(parsedRows.errors.length)return {entries,errors:parsedRows.errors};
 const rows=parsedRows.rows;
  if (
    rows[0]?.map((value) => value.trim()).join(",") !==
    "코드,품목명,단위,단가,출처"
  )
    return {
      entries,
      errors: ["첫 행은 코드,품목명,단위,단가,출처 순서여야 합니다."],
    };
  const seen = new Set<string>();
  rows.slice(1).forEach((cells, index) => {
    if (cells.every((cell) => !cell.trim())) return;
    const [rawCode, name, unit, rawRate, source] = cells;
    const code = rawCode?.trim().toUpperCase();
    const version =
      1 +
      Math.max(
        0,
        ...existing
          .filter((entry) => entry.code === code)
          .map((entry) => entry.version),
      );
    const parsed = priceBookEntrySchema.safeParse({
      code,
      name,
      unit: unit?.trim(),
      rate: Number(rawRate),
      source,
      version,
    });
    if (
      cells.length !== 5 ||
      !rawRate?.trim() ||
      !/^\d+(\.\d+)?$/.test(rawRate.trim()) ||
      !parsed.success
    ) {
      errors.push(
        `${index + 2}행: 코드·품목·단위·0 이상 금액·출처를 확인하세요.`,
      );
      return;
    }
    if (seen.has(code)) {
      errors.push(`${index + 2}행: 코드 ${code}가 입력 안에서 중복됩니다.`);
      return;
    }
    seen.add(code);
    entries.push(parsed.data);
  });
  if (!entries.length && !errors.length)
    errors.push("가져올 단가 행이 없습니다.");
  if (existing.length + entries.length > 200)
    errors.push("기존 버전을 포함한 보관 한도 200건을 초과합니다.");
  return { entries, errors };
}
export function appendPriceBook(
  entries: PriceBookEntry[],
  input: Omit<PriceBookEntry, "version">,
) {
  if (entries.length >= 200) return null;
  const code = input.code.trim().toUpperCase();
  const version =
    1 +
    Math.max(
      0,
      ...entries
        .filter((entry) => entry.code === code)
        .map((entry) => entry.version),
    );
  const parsed = priceBookEntrySchema.safeParse({ ...input, code, version });
  return parsed.success ? [...entries, parsed.data] : null;
}
