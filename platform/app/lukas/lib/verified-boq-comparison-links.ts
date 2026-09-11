export function verifiedBoqComparisonRowId(itemCode: string) {
  const encoded = Array.from(new TextEncoder().encode(itemCode), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `verified-boq-comparison-row-${encoded}`;
}

export function verifiedBoqComparisonRowHash(itemCode: string) {
  return `#${verifiedBoqComparisonRowId(itemCode)}`;
}
