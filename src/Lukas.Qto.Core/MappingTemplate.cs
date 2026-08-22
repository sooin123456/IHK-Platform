using System.Collections.Generic;
using System.Globalization;

namespace Lukas.Qto.Core
{
    public static class MappingTemplate
    {
        public static void Write(string mappingPath, string qtoIndexPath, IEnumerable<EstimateLine> lines, IEnumerable<QtoRecord> qtoRows)
        {
            if (!string.Equals(System.IO.Path.GetExtension(mappingPath), ".xlsx", System.StringComparison.OrdinalIgnoreCase) ||
                !string.Equals(System.IO.Path.GetExtension(qtoIndexPath), ".xlsx", System.StringComparison.OrdinalIgnoreCase))
                throw new System.ArgumentException("매핑 템플릿과 QTO 인덱스는 기계 ID를 텍스트로 보존하는 .xlsx 파일이어야 합니다.");
            var mappings = new List<string[]> { new[] { "내역ID", "품명", "내역단위", "내역수량", "검산키", "단위", "계수", "승인" } };
            foreach (var line in lines)
            {
                if (!string.Equals(Csv.SpreadsheetText(line.Id), line.Id, System.StringComparison.Ordinal))
                    throw new System.ArgumentException("내역ID는 Excel 수식 문자(=,+,-,@)로 시작할 수 없습니다.");
                mappings.Add(new[] { line.Id, Csv.SpreadsheetText(line.Description), Csv.SpreadsheetText(line.Unit), Number(line.Quantity), "", Csv.SpreadsheetText(line.Unit), "1", "" });
            }
            Xlsx.WriteTextSheet(mappingPath, "매핑", mappings);

            var index = new List<string[]> { new[] { "검산키", "분류", "패밀리", "타입", "레벨", "수량", "길이_m", "면적_m2", "체적_m3", "요소ID수" } };
            foreach (var row in qtoRows) index.Add(new[] { Csv.SpreadsheetText(row.Id), Csv.SpreadsheetText(row.Category), Csv.SpreadsheetText(row.Family), Csv.SpreadsheetText(row.Type), Csv.SpreadsheetText(row.Level), Number(row.Count), Number(row.LengthM), Number(row.AreaM2), Number(row.VolumeM3), row.ElementIds.Count.ToString(CultureInfo.InvariantCulture) });
            Xlsx.WriteTextSheet(qtoIndexPath, "QTO 인덱스", index);
        }

        private static string Number(decimal? value) { return value.HasValue ? value.Value.ToString("0.############################", CultureInfo.InvariantCulture) : ""; }
        private static string Number(decimal value) { return value.ToString("0.############################", CultureInfo.InvariantCulture); }
    }
}
