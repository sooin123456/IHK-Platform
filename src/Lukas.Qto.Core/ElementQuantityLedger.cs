using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace Lukas.Qto.Core
{
    public enum ElementVolumeState { MISSING, ZERO, COMPUTED }

    public sealed class ElementQuantityLedgerRow
    {
        public string ElementId { get; set; }
        public string Category { get; set; }
        public string Family { get; set; }
        public string Type { get; set; }
        public string ElementName { get; set; }
        public string Level { get; set; }
        public ElementVolumeState VolumeState { get; set; }
        public decimal? VolumeM3 { get; set; }
        public string SourceParameter { get; set; }
        public ElementVolumeState LengthState { get; set; }
        public decimal? LengthM { get; set; }
        public string LengthSourceParameter { get; set; }
        public ElementVolumeState HeightState { get; set; }
        public decimal? HeightM { get; set; }
        public string HeightSourceParameter { get; set; }
    }

    /// <summary>Revit에 의존하지 않는 요소별 원시 Properties 원장 CSV 계약.</summary>
    public static class ElementQuantityLedger
    {
        public const string FormatVersion = "ELEMENT_QUANTITY_LEDGER_V2";
        private static readonly string[] Header = {
            "element_id", "category", "family", "type", "element_name", "level",
            "volume_state", "volume_m3", "volume_source_parameter",
            "length_state", "length_m", "length_source_parameter",
            "height_state", "height_m", "height_source_parameter"
        };

        public static void Write(string path, IEnumerable<ElementQuantityLedgerRow> rows)
        {
            if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("요소 수량 원장 경로가 없습니다.", "path");
            List<ElementQuantityLedgerRow> checkedRows = Validate(rows).ToList();
            string output = Path.GetFullPath(path);
            if (File.Exists(output) || Directory.Exists(output)) throw new IOException("기존 요소 수량 원장을 덮어쓰지 않습니다.");
            string parent = Path.GetDirectoryName(output);
            if (string.IsNullOrEmpty(parent)) throw new IOException("요소 수량 원장 상위 폴더가 없습니다.");
            Directory.CreateDirectory(parent);
            if ((File.GetAttributes(parent) & FileAttributes.ReparsePoint) != 0) throw new IOException("심볼릭 링크 폴더에는 요소 수량 원장을 게시하지 않습니다.");
            string staging = Path.Combine(parent, "." + Path.GetFileName(output) + "." + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                Csv.Write(staging, new[] { Header }.Concat(checkedRows.Select(Fields)));
                using (var source = File.OpenRead(staging))
                using (var target = new FileStream(output, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    source.CopyTo(target);
            }
            finally { try { if (File.Exists(staging)) File.Delete(staging); } catch { } }
        }

        public static IReadOnlyList<ElementQuantityLedgerRow> Read(string path)
        {
            List<string[]> csv = Csv.Read(path);
            if (csv.Count == 0 || !csv[0].SequenceEqual(Header, StringComparer.Ordinal))
                throw new InvalidDataException("요소 수량 원장 헤더가 " + FormatVersion + " 계약과 다릅니다.");
            var rows = new List<ElementQuantityLedgerRow>();
            for (int index = 1; index < csv.Count; index++)
            {
                string[] fields = csv[index];
                if (fields.Length != Header.Length) throw new InvalidDataException((index + 1).ToString(CultureInfo.InvariantCulture) + "행 열 수가 올바르지 않습니다.");
                ElementVolumeState volumeState = ReadState(fields[6], index, "volume_state");
                ElementVolumeState lengthState = ReadState(fields[9], index, "length_state");
                ElementVolumeState heightState = ReadState(fields[12], index, "height_state");
                rows.Add(new ElementQuantityLedgerRow {
                    ElementId = CanonicalElementId(Original(fields[0])), Category = Original(fields[1]), Family = Original(fields[2]),
                    Type = Original(fields[3]), ElementName = Original(fields[4]), Level = Original(fields[5]),
                    VolumeState = volumeState, VolumeM3 = ReadDecimal(fields[7], index, "volume_m3"), SourceParameter = Original(fields[8]),
                    LengthState = lengthState, LengthM = ReadDecimal(fields[10], index, "length_m"), LengthSourceParameter = Original(fields[11]),
                    HeightState = heightState, HeightM = ReadDecimal(fields[13], index, "height_m"), HeightSourceParameter = Original(fields[14])
                });
            }
            return Validate(rows).ToList().AsReadOnly();
        }

        public static string CanonicalElementId(string value)
        {
            long id;
            string text = (value ?? "").Trim();
            if (!long.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out id) || id <= 0)
                throw new InvalidDataException("element_id는 0보다 큰 10진 정수여야 합니다.");
            return id.ToString(CultureInfo.InvariantCulture);
        }

        private static IEnumerable<ElementQuantityLedgerRow> Validate(IEnumerable<ElementQuantityLedgerRow> rows)
        {
            if (rows == null) throw new ArgumentNullException("rows");
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (ElementQuantityLedgerRow row in rows)
            {
                if (row == null) throw new InvalidDataException("요소 수량 원장 행이 null입니다.");
                row.ElementId = CanonicalElementId(row.ElementId);
                if (!ids.Add(row.ElementId)) throw new InvalidDataException("중복 element_id: " + row.ElementId);
                ValidateMeasurement(row.ElementId, "volume_m3", row.VolumeState, row.VolumeM3, row.SourceParameter);
                ValidateMeasurement(row.ElementId, "length_m", row.LengthState, row.LengthM, row.LengthSourceParameter);
                ValidateMeasurement(row.ElementId, "height_m", row.HeightState, row.HeightM, row.HeightSourceParameter);
                yield return row;
            }
        }

        private static string[] Fields(ElementQuantityLedgerRow row)
        {
            return new[] {
                Safe(row.ElementId), Safe(row.Category), Safe(row.Family), Safe(row.Type), Safe(row.ElementName), Safe(row.Level),
                row.VolumeState.ToString(), DecimalText(row.VolumeM3), Safe(row.SourceParameter),
                row.LengthState.ToString(), DecimalText(row.LengthM), Safe(row.LengthSourceParameter),
                row.HeightState.ToString(), DecimalText(row.HeightM), Safe(row.HeightSourceParameter)
            };
        }

        private static ElementVolumeState ReadState(string value, int index, string field)
        {
            ElementVolumeState state;
            if (!Enum.TryParse(Original(value), false, out state) || !Enum.IsDefined(typeof(ElementVolumeState), state))
                throw new InvalidDataException((index + 1).ToString(CultureInfo.InvariantCulture) + "행 " + field + "가 올바르지 않습니다.");
            return state;
        }

        private static decimal? ReadDecimal(string value, int index, string field)
        {
            if (value.Length == 0) return null;
            decimal parsed;
            if (!decimal.TryParse(value, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out parsed))
                throw new InvalidDataException((index + 1).ToString(CultureInfo.InvariantCulture) + "행 " + field + "가 올바르지 않습니다.");
            return parsed;
        }

        private static void ValidateMeasurement(string elementId, string field, ElementVolumeState state, decimal? value, string source)
        {
            if (!Enum.IsDefined(typeof(ElementVolumeState), state)) throw new InvalidDataException(field + " 상태가 올바르지 않습니다: " + elementId);
            bool missing = state == ElementVolumeState.MISSING;
            if (missing && (value.HasValue || !string.IsNullOrEmpty(source)))
                throw new InvalidDataException("MISSING 행에는 " + field + "/source_parameter가 없어야 합니다: " + elementId);
            if (!missing && (!value.HasValue || string.IsNullOrWhiteSpace(source)))
                throw new InvalidDataException("ZERO/COMPUTED 행에는 " + field + "/source_parameter가 필요합니다: " + elementId);
            if (value.HasValue && value.Value < 0m) throw new InvalidDataException("음수 " + field + "는 허용되지 않습니다: " + elementId);
            if (state == ElementVolumeState.ZERO && value != 0m) throw new InvalidDataException("ZERO 행의 " + field + "는 0이어야 합니다: " + elementId);
            if (state == ElementVolumeState.COMPUTED && value <= 0m)
                throw new InvalidDataException("COMPUTED 행의 " + field + "는 0보다 커야 합니다: " + elementId);
        }

        private static string DecimalText(decimal? value) { return value.HasValue ? value.Value.ToString(CultureInfo.InvariantCulture) : ""; }

        private static string Safe(string value)
        {
            value = value ?? "";
            int index = SignificantIndex(value);
            if (index < value.Length && value[index] == '\'') value = value.Insert(index, "'");
            return Csv.SpreadsheetText(value);
        }

        private static string Original(string value)
        {
            value = value ?? "";
            int index = SignificantIndex(value);
            return index < value.Length && value[index] == '\'' ? value.Remove(index, 1) : value;
        }

        private static int SignificantIndex(string value)
        {
            int index = 0;
            while (index < value.Length && (value[index] == ' ' || value[index] == '\t' || value[index] == '\r' || value[index] == '\n')) index++;
            return index;
        }
    }
}
