using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Xml.Linq;

namespace THEKIE.Qto.Core
{
    internal sealed class XlsxCellData
    {
        public string Value { get; set; }
        public string ValueType { get; set; }
        public string Formula { get; set; }
        public string FormulaType { get; set; }
        public bool HasCachedValue { get; set; }
    }

    internal static class Xlsx
    {
        private static readonly XNamespace Main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        private static readonly XNamespace Relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
        private static readonly XNamespace PackageRelationships = "http://schemas.openxmlformats.org/package/2006/relationships";

        public static List<string[]> ReadFirstSheet(string path)
        {
            return ReadSheet(path, null);
        }

        public static bool HasSheet(string path, string name)
        {
            using (var archive = ZipFile.OpenRead(path))
                return Sheets(archive).Any(x => string.Equals(x.Name, name, StringComparison.Ordinal));
        }

        public static List<string> SheetNames(string path)
        {
            using (var archive = ZipFile.OpenRead(path))
                return Sheets(archive).Select(x => x.Name).ToList();
        }

        public static List<string[]> ReadSheet(string path, string name)
        {
            return ReadSheetData(path, name)
                .Select(row => row.Select(cell => cell == null ? "" : cell.Value ?? "").ToArray())
                .ToList();
        }

        public static List<XlsxCellData[]> ReadSheetData(string path, string name)
        {
            using (var archive = ZipFile.OpenRead(path))
            {
                var strings = SharedStrings(archive);
                var sheets = Sheets(archive);
                var selected = string.IsNullOrEmpty(name) ? sheets.FirstOrDefault() : sheets.FirstOrDefault(x => string.Equals(x.Name, name, StringComparison.Ordinal));
                if (selected == null) throw new FormatException("XLSX 워크시트를 찾을 수 없습니다: " + (name ?? "첫 번째 시트"));
                string sheetPath = selected.Path;
                var sheet = Load(archive, sheetPath);
                var rows = new List<XlsxCellData[]>();
                int expected = 1;
                foreach (XElement row in sheet.Descendants(Main + "row"))
                {
                    int number;
                    if (!int.TryParse((string)row.Attribute("r"), out number) || number < expected) throw new FormatException("XLSX 행 참조가 올바르지 않습니다.");
                    while (rows.Count < number - 1) rows.Add(new XlsxCellData[0]);
                    rows.Add(RowData(row, strings));
                    expected = number + 1;
                }
                return rows;
            }
        }

        public static void WriteTextSheet(string path, string sheetName, IEnumerable<string[]> sourceRows)
        {
            if (!string.Equals(Path.GetExtension(path), ".xlsx", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("텍스트 형식 보존을 위해 XLSX 출력 경로가 필요합니다.", "path");
            XNamespace contentTypes = "http://schemas.openxmlformats.org/package/2006/content-types";
            using (var archive = ZipFile.Open(path, ZipArchiveMode.Create))
            {
                Save(archive, "[Content_Types].xml", new XDocument(new XElement(contentTypes + "Types",
                    new XElement(contentTypes + "Default", new XAttribute("Extension", "rels"), new XAttribute("ContentType", "application/vnd.openxmlformats-package.relationships+xml")),
                    new XElement(contentTypes + "Default", new XAttribute("Extension", "xml"), new XAttribute("ContentType", "application/xml")),
                    new XElement(contentTypes + "Override", new XAttribute("PartName", "/xl/workbook.xml"), new XAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")),
                    new XElement(contentTypes + "Override", new XAttribute("PartName", "/xl/worksheets/sheet1.xml"), new XAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")))));
                Save(archive, "_rels/.rels", new XDocument(new XElement(PackageRelationships + "Relationships",
                    new XElement(PackageRelationships + "Relationship", new XAttribute("Id", "rId1"), new XAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"), new XAttribute("Target", "xl/workbook.xml")))));
                Save(archive, "xl/workbook.xml", new XDocument(new XElement(Main + "workbook", new XAttribute(XNamespace.Xmlns + "r", Relationships),
                    new XElement(Main + "sheets", new XElement(Main + "sheet", new XAttribute("name", sheetName ?? "Sheet1"), new XAttribute("sheetId", "1"), new XAttribute(Relationships + "id", "rId1"))))));
                Save(archive, "xl/_rels/workbook.xml.rels", new XDocument(new XElement(PackageRelationships + "Relationships",
                    new XElement(PackageRelationships + "Relationship", new XAttribute("Id", "rId1"), new XAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"), new XAttribute("Target", "worksheets/sheet1.xml")))));
                var sheetData = new XElement(Main + "sheetData");
                int rowNumber = 0;
                foreach (string[] values in sourceRows)
                {
                    rowNumber++;
                    var row = new XElement(Main + "row", new XAttribute("r", rowNumber));
                    for (int column = 0; values != null && column < values.Length; column++)
                    {
                        string value = values[column] ?? "";
                        row.Add(new XElement(Main + "c", new XAttribute("r", ColumnName(column) + rowNumber), new XAttribute("t", "inlineStr"),
                            new XElement(Main + "is", new XElement(Main + "t", new XAttribute(XNamespace.Xml + "space", "preserve"), value))));
                    }
                    sheetData.Add(row);
                }
                Save(archive, "xl/worksheets/sheet1.xml", new XDocument(new XElement(Main + "worksheet", sheetData)));
            }
        }

        private static List<string> SharedStrings(ZipArchive archive)
        {
            ZipArchiveEntry entry = archive.GetEntry("xl/sharedStrings.xml");
            if (entry == null) return new List<string>();
            var document = Load(entry);
            return document.Descendants(Main + "si").Select(x => string.Concat(x.Descendants(Main + "t").Select(t => t.Value))).ToList();
        }

        private static List<SheetInfo> Sheets(ZipArchive archive)
        {
            var workbook = Load(archive, "xl/workbook.xml");
            var relations = Load(archive, "xl/_rels/workbook.xml.rels");
            var result = new List<SheetInfo>();
            foreach (XElement sheet in workbook.Descendants(Main + "sheet"))
            {
                string relationshipId = (string)sheet.Attribute(Relationships + "id");
                XElement relation = relations.Descendants(PackageRelationships + "Relationship").FirstOrDefault(x => (string)x.Attribute("Id") == relationshipId);
                if (relation == null) throw new FormatException("XLSX 워크시트 연결 정보가 없습니다.");
                string target = (string)relation.Attribute("Target");
                result.Add(new SheetInfo { Name = (string)sheet.Attribute("name"), Path = target.StartsWith("/") ? target.TrimStart('/') : "xl/" + target.Replace("../", "") });
            }
            if (result.Count == 0) throw new FormatException("XLSX에 워크시트가 없습니다.");
            return result;
        }

        private sealed class SheetInfo { public string Name { get; set; } public string Path { get; set; } }

        private static XlsxCellData[] RowData(XElement row, List<string> strings)
        {
            var values = new List<XlsxCellData>();
            foreach (XElement cell in row.Elements(Main + "c"))
            {
                int column = Column((string)cell.Attribute("r"));
                while (values.Count <= column) values.Add(null);
                string type = (string)cell.Attribute("t");
                XElement cached = cell.Element(Main + "v");
                XElement formula = cell.Element(Main + "f");
                string value;
                if (type == "s")
                {
                    int index;
                    if (!int.TryParse((string)cached, out index) || index < 0 || index >= strings.Count) throw new FormatException("XLSX 공유 문자열 인덱스가 올바르지 않습니다.");
                    value = strings[index];
                }
                else if (type == "inlineStr") value = string.Concat(cell.Descendants(Main + "t").Select(t => t.Value));
                else value = (string)cached ?? "";
                values[column] = new XlsxCellData {
                    Value = value,
                    ValueType = string.IsNullOrWhiteSpace(type) ? "n" : type,
                    Formula = formula == null ? null : formula.Value,
                    FormulaType = formula == null ? null : (string)formula.Attribute("t"),
                    HasCachedValue = cached != null || type == "inlineStr"
                };
            }
            return values.ToArray();
        }

        private static int Column(string reference)
        {
            if (string.IsNullOrEmpty(reference)) throw new FormatException("XLSX 셀 참조가 없습니다.");
            int result = 0;
            foreach (char c in reference)
            {
                if (c >= 'A' && c <= 'Z') result = result * 26 + c - 'A' + 1;
                else if (c >= 'a' && c <= 'z') result = result * 26 + c - 'a' + 1;
                else break;
            }
            if (result == 0) throw new FormatException("XLSX 셀 참조가 올바르지 않습니다: " + reference);
            return result - 1;
        }

        private static string ColumnName(int zeroBased)
        {
            string result = "";
            for (int value = zeroBased + 1; value > 0; value = (value - 1) / 26)
                result = (char)('A' + (value - 1) % 26) + result;
            return result;
        }

        private static void Save(ZipArchive archive, string path, XDocument document)
        {
            using (Stream stream = archive.CreateEntry(path).Open()) document.Save(stream);
        }

        private static XDocument Load(ZipArchive archive, string path)
        {
            ZipArchiveEntry entry = archive.GetEntry(path);
            if (entry == null) throw new FormatException("XLSX 구성 요소가 없습니다: " + path);
            return Load(entry);
        }

        private static XDocument Load(ZipArchiveEntry entry)
        {
            using (Stream stream = entry.Open()) return XDocument.Load(stream);
        }
    }
}
