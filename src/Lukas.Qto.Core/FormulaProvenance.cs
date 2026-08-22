using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace Lukas.Qto.Core
{
    public static class FormulaProvenance
    {
        private static readonly string[] CoreSheets = { "원가계산서", "공종별집계표", "공종별내역서", "일위대가목록", "일위대가", "단가대비표", " 공사설정 " };
        private static readonly XNamespace Main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        private static readonly XNamespace Relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
        private static readonly XNamespace PackageRelationships = "http://schemas.openxmlformats.org/package/2006/relationships";
        private static readonly Regex CellReference = new Regex(@"(?<![A-Z0-9_])(?<ca>\$?)(?<c>[A-Z]{1,3})(?<ra>\$?)(?<r>\d+)", RegexOptions.Compiled | RegexOptions.IgnoreCase);

        public static FormulaSnapshot Snapshot(string path)
        {
            using (var archive = ZipFile.OpenRead(path))
            {
                var strings = SharedStrings(archive);
                var sheets = Sheets(archive);
                var snapshot = new FormulaSnapshot();
                foreach (string name in CoreSheets)
                {
                    string sheetPath;
                    if (!sheets.TryGetValue(name, out sheetPath)) continue;
                    ReadSheet(archive, sheetPath, name, strings, snapshot);
                    snapshot.MatchedCoreSheetCount++;
                    snapshot.MatchedCoreSheets.Add(name);
                }
                return snapshot;
            }
        }

        public static FormulaComparison Compare(string derivativePath, string originPath)
        {
            var derivative = Snapshot(derivativePath);
            var origin = Snapshot(originPath);
            var comparison = new FormulaComparison
            {
                DerivativeValueCount = derivative.Values.Count, OriginValueCount = origin.Values.Count,
                DerivativeFormulaCount = derivative.Formulas.Count, OriginFormulaCount = origin.Formulas.Count,
                DerivativeCoreSheetCount = derivative.MatchedCoreSheetCount, OriginCoreSheetCount = origin.MatchedCoreSheetCount,
                CoreSheetsEqual = derivative.MatchedCoreSheets.SetEquals(origin.MatchedCoreSheets),
                DerivativeUnresolvedSharedFormulaCount = derivative.UnresolvedSharedFormulas.Count, OriginUnresolvedSharedFormulaCount = origin.UnresolvedSharedFormulas.Count,
                DisplayedValuesEqual = Same(derivative.Values, origin.Values) && derivative.ValueCells.SetEquals(origin.ValueCells),
                FormulasEqual = Same(derivative.Formulas, origin.Formulas)
            };
            foreach (string key in derivative.ValueCells.Union(origin.ValueCells).OrderBy(key => key))
            {
                string left, right;
                bool leftCell = derivative.ValueCells.Contains(key), rightCell = origin.ValueCells.Contains(key);
                derivative.Values.TryGetValue(key, out left); origin.Values.TryGetValue(key, out right);
                if (!leftCell || !rightCell || left != right)
                    comparison.ValueMismatches.Add(key);
            }
            foreach (var formula in derivative.Formulas)
            {
                string originFormula;
                if (!origin.Formulas.TryGetValue(formula.Key, out originFormula) || originFormula != formula.Value)
                    comparison.FormulaMismatches.Add(formula.Key);
            }
            foreach (string key in origin.Formulas.Keys.Except(derivative.Formulas.Keys).OrderBy(key => key))
                if (!origin.ValueCells.Contains(key) || !derivative.ValueCells.Contains(key)) comparison.RemovedFormulaCellsWithoutCachedValue.Add(key);
            bool comparable = comparison.DerivativeCoreSheetCount > 0 && comparison.OriginCoreSheetCount > 0 && comparison.CoreSheetsEqual
                && comparison.DerivativeValueCount > 0 && comparison.OriginValueCount > 0 && comparison.OriginFormulaCount > 0
                && comparison.DerivativeUnresolvedSharedFormulaCount == 0 && comparison.OriginUnresolvedSharedFormulaCount == 0;
            if (comparable && comparison.DisplayedValuesEqual && comparison.FormulasEqual)
                comparison.Classification = "EXACT_EQUIVALENT";
            else if (comparable && comparison.DisplayedValuesEqual && comparison.DerivativeFormulaCount < comparison.OriginFormulaCount && comparison.FormulaMismatches.Count == 0 && comparison.RemovedFormulaCellsWithoutCachedValue.Count == 0)
                comparison.Classification = "FLATTENED_DERIVATIVE";
            else comparison.Classification = "UNRELATED";
            return comparison;
        }

        private static void ReadSheet(ZipArchive archive, string path, string name, List<string> strings, FormulaSnapshot snapshot)
        {
            var sheet = Load(archive, path);
            var masters = new Dictionary<string, FormulaMaster>();
            foreach (var cell in sheet.Descendants(Main + "c"))
            {
                XElement formula = cell.Element(Main + "f");
                string text = formula == null ? null : formula.Value;
                string shared = formula == null ? null : (string)formula.Attribute("si");
                if (!string.IsNullOrWhiteSpace(text) && (string)formula.Attribute("t") == "shared" && !string.IsNullOrEmpty(shared))
                    masters[shared] = new FormulaMaster { Cell = (string)cell.Attribute("r"), Text = text };
            }
            foreach (var cell in sheet.Descendants(Main + "c"))
            {
                string reference = (string)cell.Attribute("r");
                if (string.IsNullOrEmpty(reference)) continue;
                string key = name + "!" + reference;
                if (cell.Element(Main + "v") != null || (string)cell.Attribute("t") == "inlineStr") snapshot.ValueCells.Add(key);
                string value = Value(cell, strings);
                if (snapshot.ValueCells.Contains(key)) snapshot.Values[key] = value;
                XElement formula = cell.Element(Main + "f");
                if (formula == null) continue;
                string formulaType = (string)formula.Attribute("t");
                if (!string.IsNullOrEmpty(formulaType) && formulaType != "shared")
                {
                    snapshot.UnresolvedSharedFormulas.Add(key);
                    snapshot.Formulas[key] = "!UNSUPPORTED_FORMULA_TYPE:" + formulaType;
                    continue;
                }
                string text = formula.Value;
                string anchor = reference;
                if (string.IsNullOrWhiteSpace(text) && (string)formula.Attribute("t") == "shared")
                {
                    FormulaMaster master;
                    if (masters.TryGetValue((string)formula.Attribute("si"), out master)) { text = master.Text; anchor = master.Cell; }
                    else
                    {
                        snapshot.UnresolvedSharedFormulas.Add(key);
                        snapshot.Formulas[key] = "!UNRESOLVED_SHARED_FORMULA:" + ((string)formula.Attribute("si") ?? "");
                        continue;
                    }
                }
                else if (string.IsNullOrWhiteSpace(text))
                {
                    snapshot.UnresolvedSharedFormulas.Add(key);
                    snapshot.Formulas[key] = "!UNRESOLVED_FORMULA";
                    continue;
                }
                if (!string.IsNullOrWhiteSpace(text)) snapshot.Formulas[key] = Canonical(text, anchor);
            }
        }

        private static string Canonical(string formula, string anchor)
        {
            int anchorColumn, anchorRow;
            Address(anchor, out anchorColumn, out anchorRow);
            var result = new StringBuilder();
            int start = 0;
            bool inString = false;
            for (int index = 0; index < formula.Length; index++)
            {
                if (formula[index] != '"') continue;
                if (inString && index + 1 < formula.Length && formula[index + 1] == '"') { index++; continue; }
                if (inString) result.Append(formula, start, index - start + 1);
                else
                {
                    result.Append(CanonicalReferences(formula.Substring(start, index - start).ToUpperInvariant(), anchorColumn, anchorRow));
                    result.Append('"');
                }
                inString = !inString;
                start = index + 1;
            }
            string tail = formula.Substring(start);
            result.Append(inString ? tail : CanonicalReferences(tail.ToUpperInvariant(), anchorColumn, anchorRow));
            return result.ToString();
        }

        private static string CanonicalReferences(string formula, int anchorColumn, int anchorRow)
        {
            return CellReference.Replace(formula, match =>
            {
                int column = Column(match.Groups["c"].Value), row = int.Parse(match.Groups["r"].Value);
                string c = match.Groups["ca"].Value == "$" ? "C" + column : "C[" + (column - anchorColumn) + "]";
                string r = match.Groups["ra"].Value == "$" ? "R" + row : "R[" + (row - anchorRow) + "]";
                return r + c;
            });
        }

        private static string Value(XElement cell, List<string> strings)
        {
            string value = (string)cell.Element(Main + "v");
            string type = (string)cell.Attribute("t") ?? "n";
            if (type == "s")
            {
                int index;
                return "s:" + (int.TryParse(value, out index) && index >= 0 && index < strings.Count ? strings[index] : "");
            }
            if (type == "inlineStr") return "s:" + string.Concat(cell.Descendants(Main + "t").Select(x => x.Value));
            return type + ":" + (value ?? "");
        }

        private static bool Same(Dictionary<string, string> left, Dictionary<string, string> right)
        {
            return left.Count == right.Count && left.All(pair => { string value; return right.TryGetValue(pair.Key, out value) && value == pair.Value; });
        }

        private static List<string> SharedStrings(ZipArchive archive)
        {
            ZipArchiveEntry entry = archive.GetEntry("xl/sharedStrings.xml");
            return entry == null ? new List<string>() : Load(entry).Descendants(Main + "si").Select(x => string.Concat(x.Descendants(Main + "t").Select(t => t.Value))).ToList();
        }

        private static Dictionary<string, string> Sheets(ZipArchive archive)
        {
            var workbook = Load(archive, "xl/workbook.xml");
            var relations = Load(archive, "xl/_rels/workbook.xml.rels").Descendants(PackageRelationships + "Relationship").ToDictionary(x => (string)x.Attribute("Id"), x => (string)x.Attribute("Target"));
            return workbook.Descendants(Main + "sheet").ToDictionary(sheet => (string)sheet.Attribute("name"), sheet =>
            {
                string target = relations[(string)sheet.Attribute(Relationships + "id")];
                return target.StartsWith("/") ? target.TrimStart('/') : "xl/" + target.Replace("../", "");
            }, StringComparer.Ordinal);
        }

        private static XDocument Load(ZipArchive archive, string path)
        {
            ZipArchiveEntry entry = archive.GetEntry(path);
            if (entry == null) throw new FormatException("XLSX 구성 요소가 없습니다: " + path);
            return Load(entry);
        }

        private static XDocument Load(ZipArchiveEntry entry) { using (Stream stream = entry.Open()) return XDocument.Load(stream); }
        private static void Address(string reference, out int column, out int row) { column = Column(reference); row = int.Parse(new string(reference.SkipWhile(char.IsLetter).ToArray())); }
        private static int Column(string reference) { int value = 0; foreach (char c in reference) { if (!char.IsLetter(c)) break; value = value * 26 + char.ToUpperInvariant(c) - 'A' + 1; } return value; }

        private sealed class FormulaMaster { public string Cell { get; set; } public string Text { get; set; } }
    }

    public sealed class FormulaSnapshot
    {
        public int MatchedCoreSheetCount { get; internal set; }
        public HashSet<string> MatchedCoreSheets { get; } = new HashSet<string>(StringComparer.Ordinal);
        public Dictionary<string, string> Values { get; } = new Dictionary<string, string>(StringComparer.Ordinal);
        public HashSet<string> ValueCells { get; } = new HashSet<string>(StringComparer.Ordinal);
        public Dictionary<string, string> Formulas { get; } = new Dictionary<string, string>(StringComparer.Ordinal);
        public List<string> UnresolvedSharedFormulas { get; } = new List<string>();
    }

    public sealed class FormulaComparison
    {
        public string Classification { get; internal set; }
        public bool DisplayedValuesEqual { get; internal set; }
        public bool FormulasEqual { get; internal set; }
        public int DerivativeValueCount { get; internal set; }
        public int OriginValueCount { get; internal set; }
        public int DerivativeFormulaCount { get; internal set; }
        public int OriginFormulaCount { get; internal set; }
        public int DerivativeCoreSheetCount { get; internal set; }
        public int OriginCoreSheetCount { get; internal set; }
        public bool CoreSheetsEqual { get; internal set; }
        public int DerivativeUnresolvedSharedFormulaCount { get; internal set; }
        public int OriginUnresolvedSharedFormulaCount { get; internal set; }
        public List<string> FormulaMismatches { get; } = new List<string>();
        public List<string> ValueMismatches { get; } = new List<string>();
        public List<string> RemovedFormulaCellsWithoutCachedValue { get; } = new List<string>();
    }
}
