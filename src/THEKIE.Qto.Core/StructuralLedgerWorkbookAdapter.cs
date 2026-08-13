using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;

namespace THEKIE.Qto.Core
{
    // Content-schema importer for the original member-level ledgers.  It intentionally
    // stops at preserving the signed raw rows: no allowance, raw-to-official conversion,
    // or rebar mass calculation is implied by this class.
    public sealed class StructuralLedgerWorkbookImportResult
    {
        private readonly List<StructuralLedgerRow> rows;
        private readonly List<StructuralQuantityFinding> findings;

        internal StructuralLedgerWorkbookImportResult(string schemaId, string sourceSha256,
            StructuralQuantityStatus status, IEnumerable<StructuralLedgerRow> rows,
            IEnumerable<StructuralQuantityFinding> findings, string message)
        {
            SchemaId = schemaId;
            SourceSha256 = sourceSha256;
            Status = status;
            this.rows = (rows ?? Enumerable.Empty<StructuralLedgerRow>()).ToList();
            this.findings = (findings ?? Enumerable.Empty<StructuralQuantityFinding>()).ToList();
            Message = message;
        }

        public string SchemaId { get; private set; }
        public string SourceSha256 { get; private set; }
        public StructuralQuantityStatus Status { get; private set; }
        public IReadOnlyList<StructuralLedgerRow> Rows { get { return rows.AsReadOnly(); } }
        public IReadOnlyList<StructuralQuantityFinding> Findings { get { return findings.AsReadOnly(); } }
        public string Message { get; private set; }
    }

    public static class StructuralLedgerWorkbookAdapter
    {
        public const string Zg04ASchemaId = "ZG04A_LEDGER_V1";
        public const string Zj02SchemaId = "ZJ02_LEDGER_V1";

        public static StructuralLedgerWorkbookImportResult Import(string path, decimal tolerance = 0.001m)
        {
            EnsureTolerance(tolerance);
            string sha256;
            List<string> names;
            Dictionary<string, List<XlsxCellData[]>> sheets;
            string error;
            if (!TryOpen(path, out sha256, out names, out sheets, out error))
                return Failed("UNRECOGNIZED_LEDGER", sha256, error);

            if (SameNames(names, new[] { "FT", "01", "P1" }))
                return ImportZg04A(sheets, sha256, tolerance);
            if (SameNames(names, new[] { "FT", "B1", "01", "P1" }))
                return ImportZj02(sheets, sha256, tolerance);
            return Failed("UNRECOGNIZED_LEDGER", sha256,
                "ZG04A(FT/01/P1) 또는 ZJ02(FT/B1/01/P1) 원시 ledger 시트 구성을 식별할 수 없습니다.");
        }

        public static StructuralLedgerWorkbookImportResult ImportZg04A(string path, decimal tolerance = 0.001m)
        {
            return ImportExpected(path, Zg04ASchemaId, new[] { "FT", "01", "P1" }, ImportZg04A, tolerance);
        }

        public static StructuralLedgerWorkbookImportResult ImportZj02(string path, decimal tolerance = 0.001m)
        {
            return ImportExpected(path, Zj02SchemaId, new[] { "FT", "B1", "01", "P1" }, ImportZj02, tolerance);
        }

        // These aliases make the source role explicit at call sites without changing the
        // schema result or trying to discover a file from its extension.
        public static StructuralLedgerWorkbookImportResult ImportZg04ALedger(string path, decimal tolerance = 0.001m)
        {
            return ImportZg04A(path, tolerance);
        }

        public static StructuralLedgerWorkbookImportResult ImportZj02Ledger(string path, decimal tolerance = 0.001m)
        {
            return ImportZj02(path, tolerance);
        }

        private static StructuralLedgerWorkbookImportResult ImportExpected(string path, string schemaId,
            string[] expectedSheets, Func<Dictionary<string, List<XlsxCellData[]>>, string, decimal, StructuralLedgerWorkbookImportResult> importer,
            decimal tolerance)
        {
            EnsureTolerance(tolerance);
            string sha256;
            List<string> names;
            Dictionary<string, List<XlsxCellData[]>> sheets;
            string error;
            if (!TryOpen(path, out sha256, out names, out sheets, out error)) return Failed(schemaId, sha256, error);
            if (!SameNames(names, expectedSheets))
                return Failed(schemaId, sha256, "원시 ledger 시트 구성이 스키마와 다릅니다. expected=" + string.Join("/", expectedSheets) + ".");
            return importer(sheets, sha256, tolerance);
        }

        private static StructuralLedgerWorkbookImportResult ImportZg04A(Dictionary<string, List<XlsxCellData[]>> sheets, string sha256, decimal tolerance)
        {
            return ImportRows(Zg04ASchemaId, "ZG04A", sha256, sheets, new[] { "FT", "01", "P1" },
                3, new[] { "도형", "부호", "재료", "규격", "단위", "수식", "결과" }, 6, false, tolerance);
        }

        private static StructuralLedgerWorkbookImportResult ImportZj02(Dictionary<string, List<XlsxCellData[]>> sheets, string sha256, decimal tolerance)
        {
            return ImportRows(Zj02SchemaId, "ZJ02", sha256, sheets, new[] { "FT", "B1", "01", "P1" },
                2, new[] { "부재", "부호", "개소", "재료", "규격", "단위", "수식", "결과", "비고", "위치" }, 7, true, tolerance);
        }

        private static StructuralLedgerWorkbookImportResult ImportRows(string schemaId, string sourceId, string sha256,
            Dictionary<string, List<XlsxCellData[]>> sheets, string[] sheetOrder, int headerRow, string[] headers,
            int resultColumn, bool hasCount, decimal tolerance)
        {
            var rows = new List<StructuralLedgerRow>();
            var findings = new List<StructuralQuantityFinding>();
            foreach (string sheetName in sheetOrder)
            {
                List<XlsxCellData[]> sheet;
                if (!sheets.TryGetValue(sheetName, out sheet))
                    return Failed(schemaId, sha256, "필수 시트가 없습니다: " + sheetName);
                if (!HeaderMatches(sheet, headerRow, headers))
                    return Failed(schemaId, sha256, sheetName + "!" + headerRow.ToString(CultureInfo.InvariantCulture) + " 행의 표제가 스키마와 다릅니다.");

                for (int rowNumber = headerRow + 1; rowNumber <= sheet.Count; rowNumber++)
                {
                    XlsxCellData[] cells = sheet[rowNumber - 1] ?? new XlsxCellData[0];
                    if (!IsDataCandidate(cells, hasCount ? 3 : 2, resultColumn)) continue;
                    string material = Value(cells, hasCount ? 3 : 2);
                    string spec = Value(cells, hasCount ? 4 : 3);
                    string unit = Value(cells, hasCount ? 5 : 4);
                    string expression = Value(cells, hasCount ? 6 : 5);
                    string resultText = Value(cells, resultColumn);
                    if (string.IsNullOrWhiteSpace(material) || string.IsNullOrWhiteSpace(unit) ||
                        string.IsNullOrWhiteSpace(expression) || string.IsNullOrWhiteSpace(resultText))
                        return Failed(schemaId, sha256, sheetName + "!" + rowNumber.ToString(CultureInfo.InvariantCulture) +
                            "의 data 행에 재료·단위·수식·결과가 모두 필요합니다. material=" + material + ";spec=" + spec +
                            ";unit=" + unit + ";expression=" + expression + ";result=" + resultText);

                    decimal quantity;
                    XlsxCellData resultCell = Cell(cells, resultColumn);
                    if (!Numeric(resultCell, out quantity))
                        return Failed(schemaId, sha256, sheetName + "!" + Address(resultColumn, rowNumber) +
                            "의 결과는 저장값이 있는 Excel 숫자 셀이어야 합니다: " + resultText);

                    decimal? count = null;
                    if (hasCount && !string.IsNullOrWhiteSpace(Value(cells, 2)))
                    {
                        decimal parsedCount;
                        if (!Numeric(Cell(cells, 2), out parsedCount))
                            return Failed(schemaId, sha256, sheetName + "!" + Address(2, rowNumber) +
                                "의 개소는 저장값이 있는 Excel 숫자 셀이어야 합니다.");
                        count = parsedCount;
                    }

                    StructuralLedgerRow row = new StructuralLedgerRow {
                        LedgerId = sha256.ToLowerInvariant() + "/" + sheetName + "/" + rowNumber.ToString(CultureInfo.InvariantCulture),
                        Bucket = Bucket(material, spec, unit),
                        Floor = sheetName,
                        MemberType = Value(cells, 0),
                        MemberMark = Value(cells, 1),
                        InstanceCount = count,
                        Operation = Operation(material, quantity),
                        Material = material,
                        Spec = spec,
                        SignedQuantity = quantity,
                        Unit = unit,
                        ExpressionText = expression,
                        Note = hasCount ? Value(cells, 8) : null,
                        Location = hasCount ? Value(cells, 9) : null,
                        RoundingMode = StructuralRoundingMode.None,
                        Source = new StructuralSourceEvidence {
                            SourceId = sourceId,
                            Sha256 = sha256,
                            Revision = "UNAPPROVED",
                            Sheet = sheetName,
                            Cell = Address(resultColumn, rowNumber),
                            Row = rowNumber
                        }
                    };
                    rows.Add(row);
                    findings.Add(ExpressionFinding(row, tolerance));
                }
            }

            string duplicate = rows.GroupBy(row => row.LedgerId, StringComparer.Ordinal).Where(group => group.Count() != 1).Select(group => group.Key).FirstOrDefault();
            if (duplicate == null)
                duplicate = rows.GroupBy(row => row.Source.Key(), StringComparer.Ordinal).Where(group => group.Count() != 1).Select(group => group.Key).FirstOrDefault();
            if (duplicate != null) return Failed(schemaId, sha256, "ledger ID 또는 원본 결과 셀이 중복됩니다: " + duplicate);

            findings.Add(new StructuralQuantityFinding {
                Rule = "RAW_TO_OFFICIAL",
                Status = StructuralQuantityStatus.REVIEW,
                SubjectId = sourceId,
                Evidence = sha256,
                Message = "승인된 raw→official 변환, 철근 kg, 할증·공제·반올림 규칙이 없어 공식 수량 재산출을 하지 않았습니다."
            });
            StructuralQuantityStatus status = findings.Any(finding => finding.Status == StructuralQuantityStatus.FAIL)
                ? StructuralQuantityStatus.FAIL : StructuralQuantityStatus.REVIEW;
            return new StructuralLedgerWorkbookImportResult(schemaId, sha256, status, rows, findings,
                status == StructuralQuantityStatus.FAIL
                    ? "원시 ledger 산식 또는 필수 근거가 불일치합니다. 공식 수량 변환 전에 입력을 수정해야 합니다."
                    : "원시 signed ledger를 보존했습니다. 입력은 유효하지만 revision·registry·변환 규칙이 UNAPPROVED이므로 REVIEW입니다.");
        }

        private static StructuralQuantityFinding ExpressionFinding(StructuralLedgerRow row, decimal tolerance)
        {
            if (row.Bucket == StructuralQuantityBucket.Unknown)
            {
                decimal expected;
                string reason;
                if (!StructuralQuantityValidator.TryEvaluateExpression(row.ExpressionText, out expected, out reason))
                    return Finding(row, StructuralQuantityStatus.REVIEW,
                        "Unknown 버킷을 보존했고 지원하지 않는 산식이어서 수동 검토가 필요합니다: " + reason, tolerance);

                decimal? delta;
                bool withinTolerance = DifferenceWithinTolerance(row.SignedQuantity, expected, tolerance, out delta);
                return new StructuralQuantityFinding {
                    Rule = "SQ001",
                    Status = withinTolerance ? StructuralQuantityStatus.REVIEW : StructuralQuantityStatus.FAIL,
                    SubjectId = row.LedgerId,
                    Bucket = row.Bucket,
                    Unit = row.Unit,
                    Expected = expected,
                    Actual = row.SignedQuantity,
                    Delta = delta,
                    Tolerance = tolerance,
                    Evidence = row.Source.ToString(),
                    Message = withinTolerance
                        ? "산식 결과는 일치하지만 명시된 버킷 규격에 해당하지 않아 Unknown으로 보존했습니다."
                        : "Unknown 버킷 행의 산식 결과와 원시 수량이 허용범위를 벗어났습니다."
                };
            }
            return StructuralQuantityValidator.ValidateExpression(row, tolerance);
        }

        private static bool DifferenceWithinTolerance(decimal actual, decimal expected, decimal tolerance, out decimal? delta)
        {
            try
            {
                decimal difference = actual - expected;
                delta = difference;
                return difference >= -tolerance && difference <= tolerance;
            }
            catch (OverflowException)
            {
                delta = null;
                return false;
            }
        }

        private static StructuralQuantityFinding Finding(StructuralLedgerRow row, StructuralQuantityStatus status, string message, decimal tolerance)
        {
            return new StructuralQuantityFinding {
                Rule = "SQ001",
                Status = status,
                SubjectId = row.LedgerId,
                Bucket = row.Bucket,
                Unit = row.Unit,
                Actual = row.SignedQuantity,
                Tolerance = tolerance,
                Evidence = row.Source.ToString(),
                Message = message
            };
        }

        private static StructuralQuantityBucket Bucket(string material, string spec, string unit)
        {
            string normalizedUnit = (unit ?? "").Trim();
            string normalizedSpec = (spec ?? "").Trim();
            string normalizedMaterial = (material ?? "").Trim();
            if (string.Equals(normalizedUnit, "m3", StringComparison.OrdinalIgnoreCase))
            {
                if (normalizedMaterial.StartsWith("막자갈", StringComparison.Ordinal) || normalizedSpec.StartsWith("막자갈", StringComparison.Ordinal))
                    return StructuralQuantityBucket.ConcreteBedding;
                if (string.Equals(normalizedSpec, "25-180-8", StringComparison.Ordinal)) return StructuralQuantityBucket.ConcretePlain;
                if (string.Equals(normalizedSpec, "25-270-15", StringComparison.Ordinal)) return StructuralQuantityBucket.ConcreteReinforced;
            }
            if (string.Equals(normalizedUnit, "m2", StringComparison.OrdinalIgnoreCase))
            {
                if (Starts(normalizedSpec, "합판 보측면") || Starts(normalizedSpec, "합판 슬라브") ||
                    Starts(normalizedSpec, "합판(보측면)") || Starts(normalizedSpec, "합판(슬라브)") ||
                    Starts(normalizedSpec, "내부옹벽/기둥") || Starts(normalizedSpec, "기초")) return StructuralQuantityBucket.PureFormwork;
                if (Starts(normalizedSpec, "0.03*2") || Starts(normalizedSpec, "비드 T125") ||
                    Starts(normalizedSpec, "PF T140")) return StructuralQuantityBucket.FormworkAccessory;
            }
            if (string.Equals(normalizedUnit, "m", StringComparison.OrdinalIgnoreCase) &&
                (string.Equals(normalizedSpec, "H10", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(normalizedSpec, "H13", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(normalizedSpec, "H16", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(normalizedSpec, "H19", StringComparison.OrdinalIgnoreCase))) return StructuralQuantityBucket.RebarLength;
            return StructuralQuantityBucket.Unknown;
        }

        private static bool Starts(string value, string prefix)
        {
            return value.StartsWith(prefix, StringComparison.Ordinal);
        }

        private static StructuralQuantityOperation Operation(string material, decimal quantity)
        {
            if (quantity < 0m || (material ?? "").IndexOf("공제", StringComparison.Ordinal) >= 0) return StructuralQuantityOperation.Deduction;
            if ((material ?? "").IndexOf("보강", StringComparison.Ordinal) >= 0) return StructuralQuantityOperation.Reinforcement;
            return StructuralQuantityOperation.Normal;
        }

        private static bool HeaderMatches(List<XlsxCellData[]> sheet, int rowNumber, string[] expected)
        {
            if (sheet == null || sheet.Count < rowNumber) return false;
            for (int index = 0; index < expected.Length; index++)
                if (!string.Equals(Value(sheet[rowNumber - 1], index), expected[index], StringComparison.Ordinal)) return false;
            return true;
        }

        private static bool IsDataCandidate(XlsxCellData[] cells, int materialColumn, int resultColumn)
        {
            for (int column = materialColumn; column <= resultColumn; column++)
                if (!string.IsNullOrWhiteSpace(Value(cells, column))) return true;
            return false;
        }

        private static XlsxCellData Cell(XlsxCellData[] row, int column)
        {
            return row != null && column >= 0 && column < row.Length ? row[column] : null;
        }

        private static string Value(XlsxCellData[] row, int column)
        {
            XlsxCellData cell = Cell(row, column);
            return cell == null ? "" : cell.Value ?? "";
        }

        private static bool Numeric(XlsxCellData cell, out decimal value)
        {
            value = 0m;
            return cell != null && cell.HasCachedValue && string.Equals(cell.ValueType, "n", StringComparison.Ordinal) &&
                string.IsNullOrWhiteSpace(cell.Formula) && string.IsNullOrWhiteSpace(cell.FormulaType) &&
                TryExcelDecimal(cell.Value, out value);
        }

        private static bool TryExcelDecimal(string raw, out decimal value)
        {
            value = 0m;
            decimal parsed;
            if (!decimal.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out parsed) ||
                parsed < -9007199254740991m || parsed > 9007199254740991m)
                return false;
            return decimal.TryParse(parsed.ToString("G15", CultureInfo.InvariantCulture), NumberStyles.Float,
                CultureInfo.InvariantCulture, out value);
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

        private static bool SameNames(List<string> actual, string[] expected)
        {
            return actual != null && actual.Count == expected.Length && actual.Distinct(StringComparer.Ordinal).Count() == actual.Count &&
                expected.All(name => actual.Contains(name, StringComparer.Ordinal));
        }

        private static bool TryOpen(string path, out string sha256, out List<string> names,
            out Dictionary<string, List<XlsxCellData[]>> sheets, out string error)
        {
            sha256 = null;
            names = null;
            sheets = null;
            error = null;
            if (string.IsNullOrWhiteSpace(path)) { error = "입력 경로가 비어 있습니다."; return false; }
            if (!File.Exists(path)) { error = "입력 파일이 없습니다."; return false; }
            try
            {
                sha256 = Hash(path);
                names = Xlsx.SheetNames(path);
                if (names.Distinct(StringComparer.Ordinal).Count() != names.Count)
                {
                    error = "OOXML 통합문서에 중복 시트명이 있습니다.";
                    return false;
                }
                sheets = new Dictionary<string, List<XlsxCellData[]>>(StringComparer.Ordinal);
                foreach (string name in names) sheets.Add(name, Xlsx.ReadSheetData(path, name));
                return true;
            }
            catch (Exception exception) when (exception is IOException || exception is UnauthorizedAccessException ||
                                              exception is InvalidDataException || exception is FormatException ||
                                              exception is ArgumentException || exception is NotSupportedException)
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

        private static StructuralLedgerWorkbookImportResult Failed(string schemaId, string sha256, string message)
        {
            return new StructuralLedgerWorkbookImportResult(schemaId, sha256, StructuralQuantityStatus.FAIL,
                new StructuralLedgerRow[0], new[] { new StructuralQuantityFinding {
                    Rule = "IMPORT", Status = StructuralQuantityStatus.FAIL, Evidence = sha256, Message = message
                } }, message);
        }

        private static void EnsureTolerance(decimal tolerance)
        {
            if (tolerance < 0m) throw new ArgumentOutOfRangeException("tolerance", "허용오차는 0 이상이어야 합니다.");
        }
    }
}
