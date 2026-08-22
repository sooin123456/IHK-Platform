using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Lukas.Qto.Core
{
    public static class Csv
    {
        public static List<string[]> Read(string path)
        {
            var rows = new List<string[]>();
            using (var reader = new StreamReader(path, Encoding.UTF8, true))
            {
                var row = new List<string>();
                var value = new StringBuilder();
                bool quoted = false;
                int next;
                while ((next = reader.Read()) >= 0)
                {
                    char c = (char)next;
                    if (c == '"')
                    {
                        if (quoted && reader.Peek() == '"') { value.Append(c); reader.Read(); }
                        else if (quoted) quoted = false;
                        else if (value.Length == 0) quoted = true;
                        else throw new FormatException("CSV 큰따옴표는 필드 시작 위치에만 올 수 있습니다.");
                    }
                    else if (c == ',' && !quoted) { row.Add(value.ToString()); value.Clear(); }
                    else if ((c == '\r' || c == '\n') && !quoted)
                    {
                        if (c == '\r' && reader.Peek() == '\n') reader.Read();
                        row.Add(value.ToString()); value.Clear(); rows.Add(row.ToArray()); row.Clear();
                    }
                    else value.Append(c);
                }
                if (quoted) throw new FormatException("CSV 큰따옴표가 닫히지 않았습니다.");
                if (row.Count > 0 || value.Length > 0) { row.Add(value.ToString()); rows.Add(row.ToArray()); }
            }
            return rows;
        }

        public static void Write(string path, IEnumerable<string[]> rows)
        {
            using (var writer = new StreamWriter(path, false, new UTF8Encoding(true)))
            foreach (var row in rows) writer.WriteLine(string.Join(",", Array.ConvertAll(row, Escape)));
        }

        public static decimal Number(string value, string field, int row)
        {
            decimal result;
            value = (value ?? "").Trim();
            if (!Regex.IsMatch(value, "^-?(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\\.[0-9]+)?$") ||
                !decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out result))
                throw new FormatException(row + "행: " + field + " 값이 올바른 숫자가 아닙니다 ('" + value + "').");
            return result;
        }

        private static string Escape(string value)
        {
            value = value ?? "";
            return value.IndexOfAny(new[] { ',', '"', '\r', '\n' }) < 0 ? value : "\"" + value.Replace("\"", "\"\"") + "\"";
        }

        public static string SpreadsheetText(string value)
        {
            value = value ?? "";
            int index = 0;
            while (index < value.Length && (value[index] == ' ' || value[index] == '\t' || value[index] == '\r' || value[index] == '\n')) index++;
            if (index < value.Length && (value[index] == '=' || value[index] == '+' || value[index] == '-' || value[index] == '@'))
                return value.Insert(index, "'");
            return value;
        }
    }
}
