using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Lukas.Qto.Core
{
    public static class Input
    {
        private static readonly HashSet<string> SummaryCodes = new HashSet<string>(new[] { "AS", "B2", "BS", "C4", "C5", "C6", "C7", "CA", "CB", "CG", "CH", "CS", "S1", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "DB", "DH", "DK", "DL", "DM", "S2" }, StringComparer.OrdinalIgnoreCase);

        public static List<QtoRecord> ReadQto(string path)
        {
            var table = Table(path);
            RequireHeaders(table, "검산키|QTO_ID", "분류|Category", "패밀리|Family", "타입|Type", "레벨|Level", "수량|Count", "체적_m3|VolumeM3", "면적_m2|AreaM2", "길이_m|LengthM", "요소ID|ElementIds");
            var result = new List<QtoRecord>();
            var auditKeys = new HashSet<string>(StringComparer.Ordinal);
            var allElementIds = new HashSet<long>();
            foreach (var data in table.Rows)
            {
                var row = data.Values;
                var qto = new QtoRecord
                {
                    Id = Required(row, data.Number, "검산키", "QTO_ID"), SourceRow = data.Number,
                    Category = Required(row, data.Number, "분류", "Category"), Family = Required(row, data.Number, "패밀리", "Family"), Type = Required(row, data.Number, "타입", "Type"), Level = Required(row, data.Number, "레벨", "Level"),
                    Count = Number(row, data.Number, "수량", "Count"), VolumeM3 = Number(row, data.Number, "체적_m3", "VolumeM3"),
                    AreaM2 = Number(row, data.Number, "면적_m2", "AreaM2"), LengthM = Number(row, data.Number, "길이_m", "LengthM")
                };
                string expectedAuditKey = ComputeQtoAuditKey(qto.Category, qto.Family, qto.Type, qto.Level);
                if (!string.Equals(qto.Id, expectedAuditKey, StringComparison.OrdinalIgnoreCase))
                    throw new FormatException(data.Number + "행: 검산키가 분류·패밀리·타입·레벨 SHA-256과 일치하지 않습니다. expected=" + expectedAuditKey);
                qto.Id = expectedAuditKey;
                if (!auditKeys.Add(qto.Id)) throw new FormatException(data.Number + "행: 같은 검산키의 QTO 집계행이 중복됩니다: " + qto.Id);
                string ids = Value(row, "요소ID", "ElementIds");
                if (!string.IsNullOrWhiteSpace(ids))
                {
                    string[] tokens = ids.Split(new[] { '|' }, StringSplitOptions.None);
                    var unique = new HashSet<long>();
                    foreach (string token in tokens)
                    {
                        string normalized = token.Trim();
                        long elementId;
                        if (normalized.Length == 0 || !long.TryParse(normalized, NumberStyles.None, CultureInfo.InvariantCulture, out elementId) || elementId <= 0)
                            throw new FormatException(data.Number + "행: 요소ID는 |로 구분한 양의 정수여야 합니다: " + ids);
                        if (!unique.Add(elementId)) throw new FormatException(data.Number + "행: 요소ID가 중복됩니다: " + normalized);
                        if (!allElementIds.Add(elementId)) throw new FormatException(data.Number + "행: 서로 다른 QTO 행에 같은 요소ID가 중복됩니다: " + elementId.ToString(CultureInfo.InvariantCulture));
                        qto.ElementIds.Add(elementId.ToString(CultureInfo.InvariantCulture));
                    }
                }
                if (qto.Count <= 0m || qto.Count != decimal.Truncate(qto.Count) || qto.Count != qto.ElementIds.Count)
                    throw new FormatException(data.Number + "행: QTO 수량은 요소ID 개수와 같은 1 이상의 정수여야 합니다. 수량=" +
                        qto.Count.ToString(CultureInfo.InvariantCulture) + ", 요소ID수=" + qto.ElementIds.Count.ToString(CultureInfo.InvariantCulture));
                result.Add(qto);
            }
            return result;
        }

        public static List<EstimateLine> ReadEstimate(string path)
        {
            if (string.Equals(System.IO.Path.GetExtension(path), ".xlsx", StringComparison.OrdinalIgnoreCase))
            {
                if (Xlsx.HasSheet(path, "공종별내역서")) return ReadEmsEstimate(path);
                return ReadGenericXlsxEstimate(path);
            }
            var table = Table(path);
            RequireHeaders(table, "내역ID|ID", "품명|Description", "단위|Unit", "수량|Quantity", "단가|UnitPriceKrw", "금액|AmountKrw");
            var result = new List<EstimateLine>();
            foreach (var data in table.Rows)
            {
                var row = data.Values;
                result.Add(new EstimateLine
                {
                    Id = RequiredIdentifier(row, data.Number, "내역ID", "ID"), Description = Value(row, "품명", "Description"), Unit = NormalizeUnit(Required(row, data.Number, "단위", "Unit")),
                    Quantity = OptionalNumber(row, data.Number, "수량", "Quantity"), UnitPriceKrw = OptionalNumber(row, data.Number, "단가", "UnitPriceKrw"),
                    AmountKrw = OptionalNumber(row, data.Number, "금액", "AmountKrw"), SourceRow = data.Number
                });
            }
            if (result.Count == 0) throw new FormatException("내역 파일에 검산할 항목이 없습니다.");
            return result;
        }

        private static List<EstimateLine> ReadGenericXlsxEstimate(string path)
        {
            var rows = Xlsx.ReadSheetData(path, null);
            if (rows.Count == 0) throw new FormatException("입력 파일이 비어 있습니다: " + path);
            var headers = XlsxHeaders(rows[0]);
            int idColumn = RequiredXlsxHeader(headers, "내역ID", "ID");
            int descriptionColumn = RequiredXlsxHeader(headers, "품명", "Description");
            int unitColumn = RequiredXlsxHeader(headers, "단위", "Unit");
            int quantityColumn = RequiredXlsxHeader(headers, "수량", "Quantity");
            int unitPriceColumn = RequiredXlsxHeader(headers, "단가", "UnitPriceKrw");
            int amountColumn = RequiredXlsxHeader(headers, "금액", "AmountKrw");
            var result = new List<EstimateLine>();
            for (int index = 1; index < rows.Count; index++)
            {
                XlsxCellData[] row = rows[index];
                if (row == null || row.All(TrulyBlank)) continue;
                string id = XlsxTextIdentifier(CellData(row, idColumn), index + 1, "내역ID");
                RejectSpreadsheetFormulaIdentifier(id, index + 1, "내역ID");
                string unit = Cell(row, unitColumn);
                if (string.IsNullOrWhiteSpace(unit)) throw new FormatException((index + 1) + "행: 단위 값이 없습니다.");
                result.Add(new EstimateLine
                {
                    Id = id, Description = Cell(row, descriptionColumn), Unit = NormalizeUnit(unit), SourceRow = index + 1,
                    Quantity = XlsxNumber(CellData(row, quantityColumn), index + 1, "수량"),
                    UnitPriceKrw = XlsxNumber(CellData(row, unitPriceColumn), index + 1, "단가"),
                    AmountKrw = XlsxNumber(CellData(row, amountColumn), index + 1, "금액")
                });
            }
            if (result.Count == 0) throw new FormatException("내역 파일에 검산할 항목이 없습니다.");
            return result;
        }

        private static List<EstimateLine> ReadEmsEstimate(string path)
        {
            var rows = Xlsx.ReadSheetData(path, "공종별내역서");
            var result = new List<EstimateLine>();
            for (int index = 0; index < rows.Count; index++)
            {
                var row = rows[index];
                string id = Cell(row, 13);
                string unit = NormalizeUnit(Cell(row, 2));
                if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(unit)) continue;
                if (string.Equals(id, "품목코드", StringComparison.OrdinalIgnoreCase) && string.Equals(unit, "단위", StringComparison.OrdinalIgnoreCase)) continue;
                RejectSpreadsheetFormulaIdentifier(id, index + 1, "내역ID");
                XlsxCellData[] moneyCells = new[] { CellData(row, 4), CellData(row, 5), CellData(row, 6), CellData(row, 7), CellData(row, 8), CellData(row, 9), CellData(row, 10), CellData(row, 11) };
                if (moneyCells.All(TrulyBlank)) continue;
                decimal? quantity = EmsCellNumber(CellData(row, 3), index + 1, "D", true);
                decimal? material = EmsCellNumber(moneyCells[0], index + 1, "E", true);
                decimal? materialAmount = EmsCellNumber(moneyCells[1], index + 1, "F", true);
                decimal? labor = EmsCellNumber(moneyCells[2], index + 1, "G", true);
                decimal? laborAmount = EmsCellNumber(moneyCells[3], index + 1, "H", true);
                decimal? expense = EmsCellNumber(moneyCells[4], index + 1, "I", true);
                decimal? expenseAmount = EmsCellNumber(moneyCells[5], index + 1, "J", true);
                decimal? unitPrice = EmsCellNumber(moneyCells[6], index + 1, "K", true);
                decimal? amount = EmsCellNumber(moneyCells[7], index + 1, "L", true);
                result.Add(new EstimateLine
                {
                    Id = id + ":" + (index + 1), Description = Cell(row, 0) + " " + Cell(row, 1), Unit = unit, Quantity = quantity,
                    MaterialUnitPriceKrw = material, LaborUnitPriceKrw = labor, ExpenseUnitPriceKrw = expense,
                    MaterialAmountKrw = materialAmount, LaborAmountKrw = laborAmount, ExpenseAmountKrw = expenseAmount,
                    UnitPriceKrw = unitPrice, AmountKrw = amount, UseComponentTruncation = true,
                    IsAdjustment = quantity.HasValue && amount.HasValue && quantity.Value < 0 && amount.Value < 0, IsEmsSource = true, SourceRow = index + 1
                });
            }
            if (result.Count == 0) throw new FormatException("EMS 공종별내역서에서 검산 가능한 품목을 찾지 못했습니다.");
            return result;
        }

        public static List<Mapping> ReadMappings(string path)
        {
            if (string.Equals(System.IO.Path.GetExtension(path), ".xlsx", StringComparison.OrdinalIgnoreCase)) return ReadXlsxMappings(path);
            var table = Table(path);
            RequireHeaders(table, "내역ID|EstimateLineId", "검산키|QtoId", "단위|Unit", "계수|Multiplier");
            bool requiresApproval = table.HasHeader("승인");
            var result = new List<Mapping>();
            foreach (var data in table.Rows)
            {
                var row = data.Values;
                if (requiresApproval && !string.Equals(Value(row, "승인"), "Y", StringComparison.OrdinalIgnoreCase)) continue;
                result.Add(new Mapping
                {
                    EstimateLineId = RequiredIdentifier(row, data.Number, "내역ID", "EstimateLineId"), QtoId = CanonicalQtoAuditKey(Required(row, data.Number, "검산키", "QtoId")),
                    Unit = NormalizeUnit(Required(row, data.Number, "단위", "Unit")), Multiplier = Number(row, data.Number, "계수", "Multiplier"), SourceRow = data.Number
                });
            }
            return result;
        }

        private static List<Mapping> ReadXlsxMappings(string path)
        {
            var rows = Xlsx.ReadSheetData(path, null);
            if (rows.Count == 0) throw new FormatException("입력 파일이 비어 있습니다: " + path);
            var headers = XlsxHeaders(rows[0]);
            int estimateIdColumn = RequiredXlsxHeader(headers, "내역ID", "EstimateLineId");
            int qtoIdColumn = RequiredXlsxHeader(headers, "검산키", "QtoId");
            int unitColumn = RequiredXlsxHeader(headers, "단위", "Unit");
            int multiplierColumn = RequiredXlsxHeader(headers, "계수", "Multiplier");
            int approvalColumn;
            bool requiresApproval = headers.TryGetValue("승인", out approvalColumn);
            var result = new List<Mapping>();
            for (int index = 1; index < rows.Count; index++)
            {
                XlsxCellData[] row = rows[index];
                if (row == null || row.All(TrulyBlank)) continue;
                if (requiresApproval && !string.Equals(Cell(row, approvalColumn), "Y", StringComparison.OrdinalIgnoreCase)) continue;
                string estimateId = XlsxTextIdentifier(CellData(row, estimateIdColumn), index + 1, "내역ID");
                RejectSpreadsheetFormulaIdentifier(estimateId, index + 1, "내역ID");
                string qtoId = XlsxTextIdentifier(CellData(row, qtoIdColumn), index + 1, "검산키");
                string unit = Cell(row, unitColumn);
                if (string.IsNullOrWhiteSpace(unit)) throw new FormatException((index + 1) + "행: 단위 값이 없습니다.");
                result.Add(new Mapping
                {
                    EstimateLineId = estimateId, QtoId = CanonicalQtoAuditKey(qtoId), Unit = NormalizeUnit(unit),
                    Multiplier = XlsxRequiredNumber(CellData(row, multiplierColumn), index + 1, "계수"), SourceRow = index + 1
                });
            }
            return result;
        }

        public static EstimateSummary ReadEstimateSummary(string path)
        {
            if (!string.Equals(System.IO.Path.GetExtension(path), ".xlsx", StringComparison.OrdinalIgnoreCase) || !Xlsx.HasSheet(path, "원가계산서")) return null;
            var rows = Xlsx.ReadSheetData(path, "원가계산서");
            var values = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
            var sourceRows = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            for (int index = 0; index < rows.Count; index++)
            {
                string code = Cell(rows[index], 0);
                if (!SummaryCodes.Contains(code)) continue;
                if (sourceRows.ContainsKey(code)) throw new FormatException("EMS 원가계산서에 중복된 비목 코드가 있습니다: " + code + ".");
                sourceRows.Add(code, index + 1);
                decimal? value = EmsCellNumber(CellData(rows[index], 4), index + 1, "E", false);
                values.Add(code, value.Value);
            }
            var summary = new EstimateSummary
            {
                MaterialSubtotal = SummaryValue(values, "AS"), IndirectLabor = SummaryValue(values, "B2"), LaborSubtotal = SummaryValue(values, "BS"),
                ExpenseAdditions = new[] { "C4", "C5", "C6", "C7", "CA", "CB", "CG", "CH" }.Sum(code => SummaryValue(values, code)),
                ExpenseSubtotal = SummaryValue(values, "CS"), DirectCost = SummaryValue(values, "S1"), GeneralAdmin = SummaryValue(values, "D1"),
                Profit = SummaryValue(values, "D2"), SupplyAdditions = new[] { "D3", "D4", "D5", "D6", "D7", "D8" }.Sum(code => SummaryOptional(values, code)),
                SupplyAmount = SummaryValue(values, "D9"), Vat = SummaryValue(values, "DB"), ContractAmount = SummaryValue(values, "DH"),
                FinalAdditions = new[] { "DK", "DL", "DM" }.Sum(code => SummaryOptional(values, code)),
                HasFinalAdditions = new[] { "DK", "DL", "DM" }.Any(code => values.ContainsKey(code) && values[code] != 0m), TotalAmount = SummaryValue(values, "S2")
            };
            foreach (var pair in sourceRows) summary.SourceRows[pair.Key] = pair.Value;
            return summary;
        }

        private static CsvTable Table(string path)
        {
            var rows = string.Equals(System.IO.Path.GetExtension(path), ".xlsx", StringComparison.OrdinalIgnoreCase) ? Xlsx.ReadFirstSheet(path) : Csv.Read(path);
            if (rows.Count == 0) throw new FormatException("입력 파일이 비어 있습니다: " + path);
            return new CsvTable(rows[0], rows.Skip(1).ToList());
        }

        private static void RequireHeaders(CsvTable table, params string[] alternatives)
        {
            foreach (string group in alternatives)
            {
                if (group.Split('|').Any(table.HasHeader)) continue;
                throw new FormatException("필수 열이 없습니다: " + group.Split('|')[0] + ".");
            }
        }

        private static string Value(Dictionary<string, string> row, params string[] names)
        {
            foreach (string name in names) { string value; if (row.TryGetValue(name, out value)) return value.Trim(); }
            return "";
        }

        private static string Required(Dictionary<string, string> row, int number, params string[] names)
        {
            string value = Value(row, names);
            if (string.IsNullOrWhiteSpace(value)) throw new FormatException(number + "행: " + names[0] + " 값이 없습니다.");
            return value;
        }

        private static string RequiredIdentifier(Dictionary<string, string> row, int number, params string[] names)
        {
            string value = Required(row, number, names);
            RejectSpreadsheetFormulaIdentifier(value, number, names[0]);
            return value;
        }

        private static void RejectSpreadsheetFormulaIdentifier(string value, int row, string field)
        {
            if (!string.IsNullOrEmpty(value) && (value[0] == '=' || value[0] == '+' || value[0] == '-' || value[0] == '@'))
                throw new FormatException(row + "행: " + field + "는 Excel 수식 문자(=,+,-,@)로 시작할 수 없습니다.");
        }

        private static decimal Number(Dictionary<string, string> row, int number, params string[] names)
        {
            return Csv.Number(Required(row, number, names), names[0], number);
        }

        private static decimal? OptionalNumber(Dictionary<string, string> row, int number, params string[] names)
        {
            string value = Value(row, names);
            return string.IsNullOrWhiteSpace(value) ? (decimal?)null : Csv.Number(value, names[0], number);
        }

        private static string Cell(string[] row, int index) { return index < row.Length ? row[index].Trim() : ""; }

        private static string Cell(XlsxCellData[] row, int index)
        {
            XlsxCellData cell = CellData(row, index);
            return cell == null ? "" : (cell.Value ?? "").Trim();
        }

        private static XlsxCellData CellData(XlsxCellData[] row, int index)
        {
            return row != null && index >= 0 && index < row.Length ? row[index] : null;
        }

        private static Dictionary<string, int> XlsxHeaders(XlsxCellData[] row)
        {
            var result = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            for (int index = 0; row != null && index < row.Length; index++)
            {
                string name = Cell(row, index);
                if (string.IsNullOrWhiteSpace(name)) continue;
                if (result.ContainsKey(name)) throw new FormatException("중복된 열 이름입니다: " + name + ".");
                result.Add(name, index);
            }
            return result;
        }

        private static int RequiredXlsxHeader(Dictionary<string, int> headers, params string[] names)
        {
            foreach (string name in names) { int index; if (headers.TryGetValue(name, out index)) return index; }
            throw new FormatException("필수 열이 없습니다: " + names[0] + ".");
        }

        private static decimal? XlsxNumber(XlsxCellData cell, int row, string field)
        {
            if (TrulyBlank(cell)) return null;
            if (cell == null || !cell.HasCachedValue || !string.Equals(cell.ValueType, "n", StringComparison.Ordinal))
                throw new FormatException(row + "행: " + field + " 셀은 저장값이 있는 숫자 셀이어야 합니다.");
            decimal? value = EmsNumber(cell.Value);
            if (!value.HasValue) throw new FormatException(row + "행: " + field + " 값이 안전한 Excel 숫자가 아닙니다: " + cell.Value);
            return value;
        }

        private static string XlsxTextIdentifier(XlsxCellData cell, int row, string field)
        {
            if (cell == null || !cell.HasCachedValue || cell.Formula != null ||
                !(string.Equals(cell.ValueType, "s", StringComparison.Ordinal) || string.Equals(cell.ValueType, "inlineStr", StringComparison.Ordinal)))
                throw new FormatException(row + "행: " + field + " 셀은 수식이 아닌 XLSX 텍스트 타입이어야 합니다.");
            string value = (cell.Value ?? "").Trim();
            if (value.Length == 0) throw new FormatException(row + "행: " + field + " 값이 없습니다.");
            return value;
        }

        private static decimal XlsxRequiredNumber(XlsxCellData cell, int row, string field)
        {
            if (TrulyBlank(cell)) throw new FormatException(row + "행: " + field + " 값이 없습니다.");
            if (cell.Formula != null && !cell.HasCachedValue) throw new FormatException(row + "행: " + field + " 수식에 저장값이 없습니다.");
            if (string.Equals(cell.ValueType, "n", StringComparison.Ordinal))
            {
                decimal? number = XlsxNumber(cell, row, field);
                if (number.HasValue) return number.Value;
            }
            if ((string.Equals(cell.ValueType, "s", StringComparison.Ordinal) || string.Equals(cell.ValueType, "inlineStr", StringComparison.Ordinal)) && cell.Formula == null)
                return Csv.Number(cell.Value, field, row);
            throw new FormatException(row + "행: " + field + " 셀은 숫자 또는 텍스트 숫자여야 합니다.");
        }

        private static bool TrulyBlank(XlsxCellData cell)
        {
            return cell == null || string.IsNullOrWhiteSpace(cell.Value) && cell.Formula == null && !cell.HasCachedValue;
        }

        private static decimal? EmsCellNumber(XlsxCellData cell, int row, string column, bool optional)
        {
            if (TrulyBlank(cell)) return optional ? (decimal?)null : throw new FormatException(row + "행: EMS " + column + " 값이 없습니다.");
            if (cell == null || !cell.HasCachedValue || !string.Equals(cell.ValueType, "n", StringComparison.Ordinal))
                throw new FormatException(row + "행: EMS " + column + " 셀은 저장값이 있는 숫자 셀이어야 합니다.");
            decimal? value = EmsNumber(cell.Value);
            if (!value.HasValue) throw new FormatException(row + "행: EMS " + column + " 값이 안전한 Excel 숫자가 아닙니다: " + cell.Value);
            return value;
        }

        private static decimal? EmsNumber(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            string normalized = value;
            if (value.Contains(","))
            {
                string signless = value.StartsWith("-") || value.StartsWith("+") ? value.Substring(1) : value;
                string[] groups = signless.Split('.').First().Split(',');
                if (groups.Length < 2 || groups[0].Length < 1 || groups[0].Length > 3 || groups.Skip(1).Any(group => group.Length != 3)) return null;
                normalized = value.Replace(",", "");
            }
            decimal exact;
            if (!decimal.TryParse(normalized, NumberStyles.Float, CultureInfo.InvariantCulture, out exact) ||
                exact < -9007199254740991m || exact > 9007199254740991m) return null;
            double number;
            if (!double.TryParse(normalized, NumberStyles.Float, CultureInfo.InvariantCulture, out number) || double.IsNaN(number) || double.IsInfinity(number)) return null;
            try { return Convert.ToDecimal(number); }
            catch (OverflowException) { return null; }
        }

        public static string ComputeQtoAuditKey(string category, string family, string type, string level)
        {
            string groupKey = (category ?? "") + "\u001F" + (family ?? "") + "\u001F" + (type ?? "") + "\u001F" + (level ?? "");
            using (var sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(groupKey))).Replace("-", "");
        }

        private static string CanonicalQtoAuditKey(string value)
        {
            if (value != null && value.Length == 64 && value.All(character => character >= '0' && character <= '9' || character >= 'A' && character <= 'F' || character >= 'a' && character <= 'f'))
                return value.ToUpperInvariant();
            return value;
        }

        private static decimal SummaryValue(Dictionary<string, decimal> values, string code)
        {
            decimal value;
            if (!values.TryGetValue(code, out value)) throw new FormatException("EMS 원가계산서에 필수 비목 코드가 없습니다: " + code);
            return value;
        }

        private static decimal SummaryOptional(Dictionary<string, decimal> values, string code)
        {
            decimal value;
            return values.TryGetValue(code, out value) ? value : 0m;
        }

        private static string NormalizeUnit(string unit)
        {
            string normalized = unit.Trim().ToUpperInvariant();
            switch (normalized)
            {
                case "EA": case "개": case "개소": case "대": case "매": return "EA";
                case "M": return "m";
                case "M2": case "㎡": return "m2";
                case "M3": case "㎥": return "m3";
                default: return normalized;
            }
        }

        private sealed class CsvTable
        {
            private readonly HashSet<string> _headers = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            public List<TableRow> Rows { get; } = new List<TableRow>();
            public CsvTable(string[] header, List<string[]> rows)
            {
                foreach (string value in header)
                {
                    string name = (value ?? "").Trim();
                    if (!_headers.Add(name)) throw new FormatException("중복된 열 이름입니다: " + name + ".");
                }
                for (int sourceIndex = 0; sourceIndex < rows.Count; sourceIndex++)
                {
                    string[] source = rows[sourceIndex];
                    if (source.All(string.IsNullOrWhiteSpace)) continue;
                    var row = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    for (int i = 0; i < header.Length; i++) row[header[i].Trim()] = i < source.Length ? source[i] : "";
                    Rows.Add(new TableRow { Number = sourceIndex + 2, Values = row });
                }
            }

            public bool HasHeader(string name) { return _headers.Contains(name); }
        }

        private sealed class TableRow
        {
            public int Number { get; set; }
            public Dictionary<string, string> Values { get; set; }
        }
    }
}
