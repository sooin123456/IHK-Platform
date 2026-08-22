using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Lukas.Qto.Core
{
    public sealed class StructuralWorkbookCellEvidence
    {
        public string SourceSha256 { get; internal set; }
        public string Sheet { get; internal set; }
        public string Cell { get; internal set; }
        public string RawValue { get; internal set; }
        public string ValueType { get; internal set; }
        public string Formula { get; internal set; }
        public string ExpectedFormula { get; internal set; }
        public decimal? RecalculatedValue { get; internal set; }
        public bool HasCachedValue { get; internal set; }
    }

    public sealed class StructuralWorkbookValue
    {
        public decimal? Quantity { get; internal set; }
        public bool FormulaValid { get; internal set; }
        public StructuralWorkbookCellEvidence Evidence { get; internal set; }
    }

    public sealed class StructuralWorkbookAnchorCheck
    {
        private readonly List<StructuralWorkbookValue> values;

        internal StructuralWorkbookAnchorCheck(string anchorId, StructuralQuantityBucket bucket, string unit,
            StructuralQuantityStatus status, decimal tolerance, IEnumerable<StructuralWorkbookValue> values, string message)
        {
            AnchorId = anchorId;
            Bucket = bucket;
            Unit = unit;
            Status = status;
            Tolerance = tolerance;
            this.values = values.ToList();
            Message = message;
        }

        public string AnchorId { get; private set; }
        public StructuralQuantityBucket Bucket { get; private set; }
        public string Unit { get; private set; }
        public StructuralQuantityStatus Status { get; private set; }
        public decimal Tolerance { get; private set; }
        public IReadOnlyList<StructuralWorkbookValue> Values { get { return values.AsReadOnly(); } }
        public string Message { get; private set; }
    }

    public sealed class StructuralWorkbookImportResult
    {
        private readonly List<StructuralWorkbookAnchorCheck> anchors;

        internal StructuralWorkbookImportResult(string schemaId, StructuralQuantityStatus status,
            IEnumerable<StructuralWorkbookAnchorCheck> anchors, string message)
        {
            SchemaId = schemaId;
            Status = status;
            this.anchors = anchors.ToList();
            Message = message;
        }

        public string SchemaId { get; private set; }
        public StructuralQuantityStatus Status { get; private set; }
        public IReadOnlyList<StructuralWorkbookAnchorCheck> Anchors { get { return anchors.AsReadOnly(); } }
        public StructuralQuantityStatus RawLedgerStatus { get { return StructuralQuantityStatus.NOT_EVALUATED; } }
        public StructuralQuantityStatus RawToOfficialStatus { get { return StructuralQuantityStatus.REVIEW; } }
        public string Message { get; private set; }
    }

    // Reads only independently reported official totals. It deliberately does not infer
    // raw-ledger rules, rebar unit mass, allowance, truncation, or rounding.
    public static class StructuralWorkbookAdapter
    {
        public static StructuralWorkbookImportResult ImportZgAnchors(string firstPath, string secondPath, decimal tolerance = 0m)
        {
            EnsureTolerance(tolerance);
            Workbook first;
            Workbook second;
            string error;
            if (!TryOpen(firstPath, out first, out error)) return Failed("ZG_ANCHOR_V1", error);
            if (!TryOpen(secondPath, out second, out error)) return Failed("ZG_ANCHOR_V1", error);

            Workbook byLevel = IsZgByLevel(first) ? first : IsZgByLevel(second) ? second : null;
            Workbook bySpecification = IsZgBySpecification(first) ? first : IsZgBySpecification(second) ? second : null;
            if (byLevel == null || bySpecification == null || ReferenceEquals(byLevel, bySpecification))
                return Failed("ZG_ANCHOR_V1", "ZG 공식 집계 스키마를 식별할 수 없습니다. 동별 층별 재료별 집계와 재료별 규격별 집계가 각각 하나씩 필요합니다.");

            var checks = new List<StructuralWorkbookAnchorCheck> {
                Check("ZG-CONCRETE-FAMILY", StructuralQuantityBucket.ConcreteAggregate, "m3", tolerance,
                    Read(byLevel, "동별 층별 재료별 집계", "C4", "SUM(D4:F4)", "D4", "E4", "F4"),
                    Read(bySpecification, "재료별 규격별 집계", "E8", "SUM(E5:E7)", "E5", "E6", "E7")),
                Check("ZG-FORMWORK-PACKAGE", StructuralQuantityBucket.FormworkPackage, "m2", tolerance,
                    Read(byLevel, "동별 층별 재료별 집계", "G4", "SUM(H4:N4)", "H4", "I4", "J4", "K4", "L4", "M4", "N4"),
                    Read(bySpecification, "재료별 규격별 집계", "E18", "SUM(E11:E17)", "E11", "E12", "E13", "E14", "E15", "E16", "E17")),
                Check("ZG-REBAR-MASS", StructuralQuantityBucket.RebarMass, "kg", tolerance,
                    Read(byLevel, "동별 층별 재료별 집계", "O4", "SUM(P4:S4)", "P4", "Q4", "R4", "S4"),
                    Read(bySpecification, "재료별 규격별 집계", "E25", "SUM(E21:E24)", "E21", "E22", "E23", "E24"))
            };
            return Completed("ZG_ANCHOR_V1", checks);
        }

        public static StructuralWorkbookImportResult ImportZjAnchors(string path, decimal tolerance = 0m)
        {
            EnsureTolerance(tolerance);
            Workbook workbook;
            string error;
            if (!TryOpen(path, out workbook, out error)) return Failed("ZJ_ANCHOR_V1", error);
            if (!IsZjExecutionSummary(workbook))
                return Failed("ZJ_ANCHOR_V1", "ZJ 공식 집계 스키마를 식별할 수 없습니다. 동별 집계와 동별 규격별 집계 시트의 필수 표제가 필요합니다.");

            var checks = new List<StructuralWorkbookAnchorCheck> {
                Check("ZJ-CONCRETE-FAMILY", StructuralQuantityBucket.ConcreteAggregate, "m3", tolerance,
                    Read(workbook, "동별 집계", "D3", null), Read(workbook, "동별 집계", "D6", "D4", "D4"),
                    Read(workbook, "동별 규격별 집계", "C7", "SUM(C4:C6)", "C4", "C5", "C6")),
                Check("ZJ-FORMWORK-PACKAGE", StructuralQuantityBucket.FormworkPackage, "m2", tolerance,
                    Read(workbook, "동별 집계", "E3", null), Read(workbook, "동별 집계", "E6", "E4", "E4"),
                    Read(workbook, "동별 규격별 집계", "C17", "SUM(C10:C16)", "C10", "C11", "C12", "C13", "C14", "C15", "C16")),
                Check("ZJ-REBAR-MASS", StructuralQuantityBucket.RebarMass, "kg", tolerance,
                    Read(workbook, "동별 집계", "F3", null), Read(workbook, "동별 집계", "F6", "F4", "F4"),
                    Read(workbook, "동별 규격별 집계", "C24", "SUM(C20:C23)", "C20", "C21", "C22", "C23"))
            };
            return Completed("ZJ_ANCHOR_V1", checks);
        }

        private static StructuralWorkbookImportResult Completed(string schemaId, List<StructuralWorkbookAnchorCheck> checks)
        {
            StructuralQuantityStatus status = checks.Any(x => x.Status == StructuralQuantityStatus.FAIL)
                ? StructuralQuantityStatus.FAIL : checks.Any(x => x.Status == StructuralQuantityStatus.REVIEW)
                    ? StructuralQuantityStatus.REVIEW : StructuralQuantityStatus.PASS;
            string message = status == StructuralQuantityStatus.PASS
                ? "공식 집계 anchor가 서로 일치합니다. raw ledger와 raw→official 변환은 평가하지 않았습니다."
                : status == StructuralQuantityStatus.REVIEW
                    ? "공식 집계 anchor 차이가 요청 허용오차 안이지만 정확히 같지 않아 REVIEW입니다."
                    : "공식 집계 anchor에 누락·숫자·수식 오류 또는 불일치가 있습니다.";
            return new StructuralWorkbookImportResult(schemaId, status, checks, message);
        }

        private static StructuralWorkbookImportResult Failed(string schemaId, string message)
        {
            return new StructuralWorkbookImportResult(schemaId, StructuralQuantityStatus.FAIL,
                new StructuralWorkbookAnchorCheck[0], message);
        }

        private static StructuralWorkbookAnchorCheck Check(string id, StructuralQuantityBucket bucket, string unit,
            decimal tolerance, params StructuralWorkbookValue[] values)
        {
            if (values.Any(x => !x.FormulaValid))
                return new StructuralWorkbookAnchorCheck(id, bucket, unit, StructuralQuantityStatus.FAIL, tolerance, values,
                    "anchor 셀 수식이 승인된 집계 스키마와 다르거나 저장 계산값이 없습니다.");
            if (values.Any(x => !x.Quantity.HasValue))
                return new StructuralWorkbookAnchorCheck(id, bucket, unit, StructuralQuantityStatus.FAIL, tolerance, values,
                    "필수 anchor 셀이 없거나 숫자 형식·정밀도가 안전하지 않습니다.");
            if (values.Any(x => x.Quantity.Value < 0m))
                return new StructuralWorkbookAnchorCheck(id, bucket, unit, StructuralQuantityStatus.FAIL, tolerance, values,
                    "공식 구조 수량 anchor는 음수일 수 없습니다.");
            decimal minimum = values.Min(x => x.Quantity.Value);
            decimal maximum = values.Max(x => x.Quantity.Value);
            decimal difference = maximum - minimum;
            StructuralQuantityStatus status = difference == 0m ? StructuralQuantityStatus.PASS
                : difference <= tolerance ? StructuralQuantityStatus.REVIEW : StructuralQuantityStatus.FAIL;
            return new StructuralWorkbookAnchorCheck(id, bucket, unit,
                status, tolerance, values,
                status == StructuralQuantityStatus.PASS ? "독립 공식 집계 저장값이 정확히 일치합니다."
                    : status == StructuralQuantityStatus.REVIEW ? "집계값 차이가 요청 허용오차 안이지만 승인 규칙이 없어 REVIEW입니다."
                    : "독립 공식 집계값이 불일치합니다.");
        }

        private static bool IsZgByLevel(Workbook workbook)
        {
            const string sheet = "동별 층별 재료별 집계";
            return workbook.HasSheet(sheet) &&
                Has(workbook, sheet, "A1", sheet) && Has(workbook, sheet, "A3", "동") && Has(workbook, sheet, "B3", "층") &&
                Has(workbook, sheet, "D3", "막자갈깔기") && Has(workbook, sheet, "P3", "H10") && Has(workbook, sheet, "S3", "H19") &&
                Has(workbook, sheet, "A4", "어린이집");
        }

        private static bool IsZgBySpecification(Workbook workbook)
        {
            const string sheet = "재료별 규격별 집계";
            return workbook.HasSheet(sheet) &&
                Has(workbook, sheet, "A1", sheet) && Has(workbook, sheet, "A3", "재료") && Has(workbook, sheet, "C3", "규격") &&
                Has(workbook, sheet, "D3", "단위") && Has(workbook, sheet, "E3", "합계") &&
                Has(workbook, sheet, "A5", "* 콘크리트") && Has(workbook, sheet, "B8", "소계") &&
                Has(workbook, sheet, "A11", "* 형틀") && Has(workbook, sheet, "B18", "소계") &&
                Has(workbook, sheet, "A21", "* 철근") && Has(workbook, sheet, "B25", "소계") &&
                Has(workbook, sheet, "D21", "kg") && Has(workbook, sheet, "D22", "kg") &&
                Has(workbook, sheet, "D23", "kg") && Has(workbook, sheet, "D24", "kg");
        }

        private static bool IsZjExecutionSummary(Workbook workbook)
        {
            const string byBuilding = "동별 집계";
            const string bySpecification = "동별 규격별 집계";
            return workbook.HasSheet(byBuilding) && workbook.HasSheet(bySpecification) &&
                Has(workbook, byBuilding, "A2", "구분") && Has(workbook, byBuilding, "B2", "동명") &&
                Has(workbook, byBuilding, "D2", "Conc") && Has(workbook, byBuilding, "E2", "형틀") &&
                Has(workbook, byBuilding, "F2", "철근") && Has(workbook, byBuilding, "B6", "합계") &&
                Has(workbook, bySpecification, "A2", "구분") && Has(workbook, bySpecification, "B2", "규격") &&
                Has(workbook, bySpecification, "A4", "콘크리트") && Has(workbook, bySpecification, "B7", "소계") &&
                Has(workbook, bySpecification, "A10", "형틀") && Has(workbook, bySpecification, "B17", "소계") &&
                Has(workbook, bySpecification, "A20", "철근") && Has(workbook, bySpecification, "B24", "소계");
        }

        private static bool Has(Workbook workbook, string sheet, string cell, string expected)
        {
            return string.Equals(Cell(workbook.Sheets[sheet], cell), expected, StringComparison.Ordinal);
        }

        private static StructuralWorkbookValue Read(Workbook workbook, string sheet, string cell, string expectedFormula,
            params string[] dependencyCells)
        {
            XlsxCellData data = CellData(workbook.Sheets[sheet], cell);
            string raw = data == null ? "" : data.Value ?? "";
            decimal quantity = 0m;
            bool numeric = data != null && data.HasCachedValue && string.Equals(data.ValueType, "n", StringComparison.Ordinal) && TryExcelDecimal(raw, out quantity);
            decimal recalculated = 0m;
            bool recalculatedValid = string.IsNullOrWhiteSpace(expectedFormula) ||
                TryRecalculateCell(workbook.Sheets[sheet], cell, false, new HashSet<string>(StringComparer.OrdinalIgnoreCase), out recalculated);
            bool formulaValid = data != null && data.HasCachedValue && string.IsNullOrWhiteSpace(data.FormulaType) &&
                FormulaEquals(data.Formula, expectedFormula) && numeric && recalculatedValid &&
                (string.IsNullOrWhiteSpace(expectedFormula) || recalculated == quantity);
            return new StructuralWorkbookValue {
                Quantity = numeric ? (decimal?)quantity : null,
                FormulaValid = formulaValid,
                Evidence = new StructuralWorkbookCellEvidence {
                    SourceSha256 = workbook.Sha256,
                    Sheet = sheet,
                    Cell = cell,
                    RawValue = raw,
                    ValueType = data == null ? null : data.ValueType,
                    Formula = data == null ? null : data.Formula,
                    ExpectedFormula = expectedFormula,
                    RecalculatedValue = !string.IsNullOrWhiteSpace(expectedFormula) && recalculatedValid ? (decimal?)recalculated : null,
                    HasCachedValue = data != null && data.HasCachedValue
                }
            };
        }

        private static bool TryRecalculateCell(List<XlsxCellData[]> rows, string reference, bool allowBlank,
            HashSet<string> visiting, out decimal value)
        {
            value = 0m;
            string canonical = reference.ToUpperInvariant();
            if (!visiting.Add(canonical)) return false;
            try
            {
                XlsxCellData data = CellData(rows, canonical);
                decimal cached;
                if (data == null)
                {
                    if (allowBlank) { value = 0m; return true; }
                    return false;
                }
                if (!data.HasCachedValue)
                {
                    if (allowBlank && string.IsNullOrWhiteSpace(data.Formula)) { value = 0m; return true; }
                    return false;
                }
                if (!string.Equals(data.ValueType, "n", StringComparison.Ordinal) || !TryExcelDecimal(data.Value, out cached)) return false;
                if (string.IsNullOrWhiteSpace(data.Formula)) { value = cached; return true; }
                if (!string.IsNullOrWhiteSpace(data.FormulaType)) return false;

                string formula = NormalizeFormula(data.Formula);
                Match direct = Regex.Match(formula, @"^[A-Z]{1,3}[1-9][0-9]*$", RegexOptions.CultureInvariant);
                if (direct.Success)
                {
                    decimal dependency;
                    if (!TryRecalculateCell(rows, direct.Value, false, visiting, out dependency) || dependency != cached) return false;
                    value = dependency;
                    return true;
                }

                Match sum = Regex.Match(formula, @"^SUM\(([A-Z]{1,3}[1-9][0-9]*):([A-Z]{1,3}[1-9][0-9]*)\)$", RegexOptions.CultureInvariant);
                if (!sum.Success) return false;
                int firstColumn, firstRow, lastColumn, lastRow;
                if (!TryCoordinate(sum.Groups[1].Value, out firstColumn, out firstRow) ||
                    !TryCoordinate(sum.Groups[2].Value, out lastColumn, out lastRow) ||
                    firstColumn > lastColumn || firstRow > lastRow) return false;
                decimal total = 0m;
                for (int row = firstRow; row <= lastRow; row++)
                    for (int column = firstColumn; column <= lastColumn; column++)
                    {
                        decimal dependency;
                        if (!TryRecalculateCell(rows, Address(column, row), true, visiting, out dependency)) return false;
                        try { total = checked(total + dependency); }
                        catch (OverflowException) { return false; }
                    }
                if (total != cached) return false;
                value = total;
                return true;
            }
            finally { visiting.Remove(canonical); }
        }

        private static string NormalizeFormula(string formula)
        {
            return new string((formula ?? "").Where(character => !char.IsWhiteSpace(character)).ToArray()).ToUpperInvariant();
        }

        private static bool TryCoordinate(string reference, out int column, out int row)
        {
            column = 0;
            row = 0;
            int split = 0;
            while (split < reference.Length && reference[split] >= 'A' && reference[split] <= 'Z')
            {
                try { column = checked(column * 26 + reference[split] - 'A' + 1); }
                catch (OverflowException) { return false; }
                split++;
            }
            column--;
            return split > 0 && split < reference.Length && column >= 0 &&
                int.TryParse(reference.Substring(split), NumberStyles.None, CultureInfo.InvariantCulture, out row) && row > 0;
        }

        private static string Address(int zeroBasedColumn, int row)
        {
            int column = zeroBasedColumn + 1;
            string letters = "";
            while (column > 0)
            {
                column--;
                letters = (char)('A' + column % 26) + letters;
                column /= 26;
            }
            return letters + row.ToString(CultureInfo.InvariantCulture);
        }

        private static string Cell(List<XlsxCellData[]> rows, string reference)
        {
            XlsxCellData data = CellData(rows, reference);
            return data == null ? "" : data.Value ?? "";
        }

        private static XlsxCellData CellData(List<XlsxCellData[]> rows, string reference)
        {
            int split = 0;
            while (split < reference.Length && char.IsLetter(reference[split])) split++;
            int row;
            if (split == 0 || split == reference.Length ||
                !int.TryParse(reference.Substring(split), NumberStyles.None, CultureInfo.InvariantCulture, out row) || row < 1)
                throw new ArgumentException("셀 참조가 올바르지 않습니다: " + reference, "reference");
            int column = 0;
            for (int index = 0; index < split; index++)
                column = checked(column * 26 + char.ToUpperInvariant(reference[index]) - 'A' + 1);
            column--;
            if (row > rows.Count || column < 0 || column >= rows[row - 1].Length) return null;
            return rows[row - 1][column];
        }

        private static bool FormulaEquals(string actual, string expected)
        {
            string left = string.IsNullOrWhiteSpace(actual) ? null : new string(actual.Where(character => !char.IsWhiteSpace(character)).ToArray()).ToUpperInvariant();
            string right = string.IsNullOrWhiteSpace(expected) ? null : new string(expected.Where(character => !char.IsWhiteSpace(character)).ToArray()).ToUpperInvariant();
            return string.Equals(left, right, StringComparison.Ordinal);
        }

        private static bool TryExcelDecimal(string raw, out decimal value)
        {
            value = 0m;
            decimal parsed;
            if (!decimal.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out parsed) ||
                parsed < -9007199254740991m || parsed > 9007199254740991m)
                return false;
            string normalized = parsed.ToString("G15", CultureInfo.InvariantCulture);
            return decimal.TryParse(normalized, NumberStyles.Float, CultureInfo.InvariantCulture, out value);
        }

        private static bool TryOpen(string path, out Workbook workbook, out string error)
        {
            workbook = null;
            error = null;
            if (string.IsNullOrWhiteSpace(path)) { error = "입력 경로가 비어 있습니다."; return false; }
            if (!File.Exists(path)) { error = "입력 파일이 없습니다."; return false; }
            try
            {
                string hash = Hash(path);
                var sheets = new Dictionary<string, List<XlsxCellData[]>>(StringComparer.Ordinal);
                foreach (string name in Xlsx.SheetNames(path)) sheets.Add(name, Xlsx.ReadSheetData(path, name));
                workbook = new Workbook(hash, sheets);
                return true;
            }
            catch (Exception exception) when (exception is IOException || exception is UnauthorizedAccessException ||
                                              exception is InvalidDataException || exception is FormatException ||
                                              exception is ArgumentException)
            {
                error = "OOXML 통합문서를 읽을 수 없습니다: " + exception.Message;
                return false;
            }
        }

        private static string Hash(string path)
        {
            using (var stream = File.OpenRead(path))
            using (var sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "");
        }

        private static void EnsureTolerance(decimal tolerance)
        {
            if (tolerance < 0m) throw new ArgumentOutOfRangeException("tolerance", "허용오차는 0 이상이어야 합니다.");
        }

        private sealed class Workbook
        {
            public Workbook(string sha256, Dictionary<string, List<XlsxCellData[]>> sheets)
            {
                Sha256 = sha256;
                Sheets = sheets;
            }

            public string Sha256 { get; private set; }
            public Dictionary<string, List<XlsxCellData[]>> Sheets { get; private set; }
            public bool HasSheet(string name) { return Sheets.ContainsKey(name); }
        }
    }
}
