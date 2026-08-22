using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace Lukas.Qto.Core
{
    public static class CsvWriter
    {
        /// <summary>
        /// UTF-8 BOM으로 저장한다. BOM이 없으면 한국어 Windows의 Excel이
        /// CP949로 읽어 한글이 깨진다. (같은 원리로 .bat은 반대로 BOM 금지)
        /// </summary>
        public static void Write(string path, IEnumerable<QtoRow> rows)
        {
            var sb = new StringBuilder();
            sb.AppendLine("검산키,분류,패밀리,타입,레벨,수량,체적_m3,면적_m2,길이_m,요소ID");

            foreach (QtoRow r in rows)
            {
                sb.AppendLine(string.Join(",",
                    Esc(r.AuditKey),
                    Esc(Csv.SpreadsheetText(r.Category)),
                    Esc(Csv.SpreadsheetText(r.FamilyName)),
                    Esc(Csv.SpreadsheetText(r.TypeName)),
                    Esc(Csv.SpreadsheetText(r.Level)),
                    r.Count.ToString(CultureInfo.InvariantCulture),
                    Num(r.VolumeM3),
                    Num(r.AreaM2),
                    Num(r.LengthM),
                    Esc(string.Join("|", r.ElementIds))));
            }

            File.WriteAllText(path, sb.ToString(), new UTF8Encoding(true));
        }

        private static string Num(double v)
        {
            return v.ToString("0.############", CultureInfo.InvariantCulture);
        }

        private static string Esc(string s)
        {
            if (s == null) return "";
            if (s.IndexOfAny(new[] { ',', '"', '\n', '\r' }) < 0) return s;
            return "\"" + s.Replace("\"", "\"\"") + "\"";
        }
    }
}
