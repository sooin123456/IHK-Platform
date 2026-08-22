using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Xml.Linq;
using Lukas.Qto.Core;

namespace Lukas.Qto.StructuralFixtureTest
{
    internal static class Program
    {
        private static readonly IReadOnlyDictionary<string, decimal> ZgExpected =
            new Dictionary<string, decimal>(StringComparer.Ordinal) {
                { "ZG-CONCRETE-FAMILY", 409.221m },
                { "ZG-FORMWORK-PACKAGE", 2781.316m },
                { "ZG-REBAR-MASS", 30886.375m }
            };

        private static readonly IReadOnlyDictionary<string, decimal> ZjExpected =
            new Dictionary<string, decimal>(StringComparer.Ordinal) {
                { "ZJ-CONCRETE-FAMILY", 450.781m },
                { "ZJ-FORMWORK-PACKAGE", 2717.205m },
                { "ZJ-REBAR-MASS", 31908.817m }
            };

        private static int Main(string[] args)
        {
            bool hardeningOnly = args.Length == 3 && string.Equals(args[0], "--raw-hardening", StringComparison.Ordinal);
            if (!hardeningOnly && args.Length != 3 && args.Length != 5)
            {
                Console.Error.WriteLine("Usage: Lukas.Qto.StructuralFixtureTest <ZG02> <ZG03> <ZJ01> [<ZG04A> <ZJ02>]\n" +
                    "   or: Lukas.Qto.StructuralFixtureTest --raw-hardening <ZG04A> <ZJ02>");
                return 2;
            }

            try
            {
                if (hardeningOnly)
                {
                    ValidateLedgerHardening(args[1], args[2]);
                    Console.WriteLine("Structural raw-ledger hardening test passed.");
                    return 0;
                }

                StructuralWorkbookImportResult zg = StructuralWorkbookAdapter.ImportZgAnchors(args[0], args[1]);
                StructuralWorkbookImportResult zgReversed = StructuralWorkbookAdapter.ImportZgAnchors(args[1], args[0]);
                StructuralWorkbookImportResult zj = StructuralWorkbookAdapter.ImportZjAnchors(args[2]);

                Validate("ZG", zg, "ZG_ANCHOR_V1", ZgExpected);
                Validate("ZG reversed", zgReversed, "ZG_ANCHOR_V1", ZgExpected);
                Assert(Fingerprint(zg) == Fingerprint(zgReversed), "ZG result changes when input order is reversed");
                Validate("ZJ", zj, "ZJ_ANCHOR_V1", ZjExpected);

                if (args.Length == 5)
                {
                    StructuralLedgerWorkbookImportResult zgRaw = StructuralLedgerWorkbookAdapter.ImportZg04A(args[3]);
                    StructuralLedgerWorkbookImportResult zjRaw = StructuralLedgerWorkbookAdapter.ImportZj02(args[4]);
                    ValidateLedger("ZG raw", zgRaw, StructuralLedgerWorkbookAdapter.Zg04ASchemaId, 1092, 264);
                    ValidateLedger("ZJ raw", zjRaw, StructuralLedgerWorkbookAdapter.Zj02SchemaId, 865, 24);
                    ValidateConcreteBridge("ZG concrete bridge", zgRaw, ConcreteSourceKind.Zg, 405.540m, 409.221m, 3.681m);
                    ValidateConcreteBridge("ZJ concrete bridge", zjRaw, ConcreteSourceKind.Zj, 450.781m, 450.781m, 0m);
                    ConcreteLedgerBridgeResult failedBridge = ConcreteTakeoff.FromStructuralLedger(
                        StructuralLedgerWorkbookAdapter.ImportZg04A(args[3] + ".missing"), ConcreteSourceKind.Zg, "어린이집", "APPROVED-FIXTURE-R1");
                    Assert(failedBridge.Status == StructuralQuantityStatus.FAIL && failedBridge.Rows.Count == 0,
                        "FAIL structural import must be rejected by the concrete bridge");
                    ValidateLedgerHardening(args[3], args[4]);
                    ValidateAnchorCacheHardening(args[0], args[1]);
                }

                Console.WriteLine(args.Length == 5
                    ? "Structural fixture test passed: ZG/ZJ official anchors and raw ledgers are structurally valid."
                    : "Structural fixture test passed: ZG and ZJ official anchors match exactly.");
                return 0;
            }
            catch (Exception exception)
            {
                Console.Error.WriteLine(exception.Message);
                return 1;
            }
        }

        private static void ValidateAnchorCacheHardening(string zg02Path, string zg03Path)
        {
            string staleLeafPath = null;
            string formulaWithoutCachePath = null;
            try
            {
                staleLeafPath = CopyWithCell(zg03Path, "F5", "148.248", false);
                StructuralWorkbookImportResult staleLeaf = StructuralWorkbookAdapter.ImportZgAnchors(zg02Path, staleLeafPath);
                Assert(staleLeaf.Status == StructuralQuantityStatus.FAIL,
                    "a changed leaf with stale intermediate/anchor caches must fail");

                formulaWithoutCachePath = CopyWithFormulaWithoutCache(zg02Path, "D8", "D5");
                StructuralWorkbookImportResult formulaWithoutCache = StructuralWorkbookAdapter.ImportZgAnchors(formulaWithoutCachePath, zg03Path);
                Assert(formulaWithoutCache.Status == StructuralQuantityStatus.FAIL,
                    "a dependency formula without a cached value must not be treated as a blank zero");
                Console.WriteLine("Anchor cache hardening: stale leaf and formula-without-cache checks passed.");
            }
            finally
            {
                DeleteIfPresent(staleLeafPath);
                DeleteIfPresent(formulaWithoutCachePath);
            }
        }

        private static void ValidateLedger(string label, StructuralLedgerWorkbookImportResult result, string schemaId,
            int expectedRows, int expectedUnknownRows)
        {
            Assert(result != null, label + " result is null");
            Assert(result.SchemaId == schemaId, label + " schema mismatch: " + result.SchemaId);
            StructuralQuantityFinding firstFailure = result.Findings.FirstOrDefault(finding => finding.Status == StructuralQuantityStatus.FAIL);
            Assert(result.Status == StructuralQuantityStatus.REVIEW, label + " must remain REVIEW until conversion rules are approved: " + result.Message +
                (firstFailure == null ? "" : " / " + firstFailure.SubjectId + " / " + firstFailure.Message + " / expected=" +
                    (firstFailure.Expected.HasValue ? firstFailure.Expected.Value.ToString(CultureInfo.InvariantCulture) : "null") +
                    ", actual=" + (firstFailure.Actual.HasValue ? firstFailure.Actual.Value.ToString(CultureInfo.InvariantCulture) : "null")));
            Assert(result.Rows.Count == expectedRows, label + " row count mismatch: expected=" + expectedRows + ", actual=" + result.Rows.Count);
            Assert(result.Rows.Count(row => row.Bucket == StructuralQuantityBucket.Unknown) == expectedUnknownRows,
                label + " unknown-row count mismatch: expected=" + expectedUnknownRows + ", actual=" +
                result.Rows.Count(row => row.Bucket == StructuralQuantityBucket.Unknown));
            Assert(result.Findings.All(finding => finding.Status != StructuralQuantityStatus.FAIL), label + " contains a failed raw expression or input");
            Assert(result.Findings.Any(finding => finding.Rule == "RAW_TO_OFFICIAL" && finding.Status == StructuralQuantityStatus.REVIEW),
                label + " lacks the raw-to-official REVIEW gate");
            foreach (StructuralLedgerRow row in result.Rows)
            {
                Assert(!string.IsNullOrWhiteSpace(row.LedgerId), label + " row has no stable ID");
                Assert(row.Source != null && IsSha256(row.Source.Sha256), label + " row has no SHA evidence: " + row.LedgerId);
                Assert(!string.IsNullOrWhiteSpace(row.Source.Sheet) && !string.IsNullOrWhiteSpace(row.Source.Cell),
                    label + " row has no source cell: " + row.LedgerId);
                Assert(!string.IsNullOrWhiteSpace(row.Material) && !string.IsNullOrWhiteSpace(row.Unit),
                    label + " row lost material/unit: " + row.LedgerId);
                Assert(!string.IsNullOrWhiteSpace(row.ExpressionText), label + " row lost expression: " + row.LedgerId);
            }
            Console.WriteLine(label + ": rows=" + result.Rows.Count.ToString(CultureInfo.InvariantCulture) +
                ", unknown=" + result.Rows.Count(row => row.Bucket == StructuralQuantityBucket.Unknown).ToString(CultureInfo.InvariantCulture));
        }

        private static void ValidateConcreteBridge(string label, StructuralLedgerWorkbookImportResult import,
            ConcreteSourceKind sourceKind, decimal expectedRaw, decimal official, decimal expectedDelta)
        {
            const string revision = "APPROVED-FIXTURE-R1";
            ConcreteLedgerBridgeResult bridge = ConcreteTakeoff.FromStructuralLedger(import, sourceKind, "어린이집", revision);
            Assert(bridge.Status == StructuralQuantityStatus.REVIEW && bridge.Rows.Count == bridge.SelectedConcreteCount && bridge.Rows.Count > 0,
                label + " must preserve rows but remain REVIEW before raw-to-official rules");
            Assert(bridge.ExcludedUnknownCount == import.Rows.Count(row => row.Bucket == StructuralQuantityBucket.Unknown) &&
                bridge.ExcludedNonConcreteCount + bridge.ExcludedUnknownCount + bridge.SelectedConcreteCount == import.Rows.Count,
                label + " exclusion counts do not close to the imported row count");
            var originals = import.Rows.ToDictionary(row => row.LedgerId, StringComparer.Ordinal);
            Assert(bridge.Rows.All(row => originals.ContainsKey(row.RowId) && row.SourceKind == sourceKind && row.Building == "어린이집" &&
                row.Floor == originals[row.RowId].Floor && row.Member == (!string.IsNullOrWhiteSpace(originals[row.RowId].MemberMark) ? originals[row.RowId].MemberMark : originals[row.RowId].MemberType) &&
                row.Spec == originals[row.RowId].Spec && row.Operation == originals[row.RowId].Operation && row.SignedQuantityM3 == originals[row.RowId].SignedQuantity &&
                row.SourceEvidence != null && row.SourceEvidence.Revision == revision && row.SourceEvidence.Sha256 == originals[row.RowId].Source.Sha256 &&
                row.SourceEvidence.Sheet == originals[row.RowId].Source.Sheet && row.SourceEvidence.Cell == originals[row.RowId].Source.Cell),
                label + " lost identity, source evidence, or approved revision");
            Assert(bridge.RawConcreteQuantityM3 == expectedRaw,
                label + " raw sum mismatch: expected=" + expectedRaw.ToString(CultureInfo.InvariantCulture) +
                ", actual=" + bridge.RawConcreteQuantityM3.ToString(CultureInfo.InvariantCulture) +
                ", excluded-m3=" + string.Join(" | ", import.Rows.Where(row => row.Bucket == StructuralQuantityBucket.Unknown && string.Equals(row.Unit, "m3", StringComparison.OrdinalIgnoreCase))
                    .GroupBy(row => (row.Material ?? "") + "/" + (row.Spec ?? ""), StringComparer.Ordinal)
                    .Select(group => group.Key + "=" + group.Sum(row => row.SignedQuantity).ToString(CultureInfo.InvariantCulture))));
            Assert(official - bridge.RawConcreteQuantityM3 == expectedDelta,
                label + " unexplained raw-to-official delta changed");
            ConcreteSourceKind wrongKind = sourceKind == ConcreteSourceKind.Zg ? ConcreteSourceKind.Zj : ConcreteSourceKind.Zg;
            Assert(ConcreteTakeoff.FromStructuralLedger(import, wrongKind, "어린이집", revision).Status == StructuralQuantityStatus.NOT_EVALUATED &&
                ConcreteTakeoff.FromStructuralLedger(import, sourceKind, "어린이집", "").Rows.Count == 0,
                label + " accepted an ambiguous source kind or revision");
            Console.WriteLine(label + ": selected=" + bridge.SelectedConcreteCount.ToString(CultureInfo.InvariantCulture) +
                ", raw=" + bridge.RawConcreteQuantityM3.ToString(CultureInfo.InvariantCulture) +
                ", official=" + official.ToString(CultureInfo.InvariantCulture) +
                ", unexplained-delta=" + (official - bridge.RawConcreteQuantityM3).ToString(CultureInfo.InvariantCulture) +
                ", excluded-m3=" + string.Join(" | ", import.Rows.Where(row => row.Bucket == StructuralQuantityBucket.Unknown && string.Equals(row.Unit, "m3", StringComparison.OrdinalIgnoreCase))
                    .GroupBy(row => (row.Material ?? "") + "/" + (row.Spec ?? ""), StringComparer.Ordinal)
                    .Select(group => group.Key + "=" + group.Sum(row => row.SignedQuantity).ToString(CultureInfo.InvariantCulture))));
        }

        private static void ValidateLedgerHardening(string zg04APath, string zj02Path)
        {
            string unknownMismatchPath = null;
            string textResultPath = null;
            string textCountPath = null;
            string formulaResultPath = null;
            try
            {
                unknownMismatchPath = CopyWithCell(zg04APath, "G6", "999", false);
                StructuralLedgerWorkbookImportResult unknownMismatch = StructuralLedgerWorkbookAdapter.ImportZg04A(unknownMismatchPath);
                StructuralQuantityFinding unknownFailure = unknownMismatch.Findings.FirstOrDefault(finding =>
                    finding.Rule == "SQ001" && finding.Status == StructuralQuantityStatus.FAIL &&
                    finding.SubjectId != null && finding.SubjectId.EndsWith("/FT/6", StringComparison.Ordinal));
                Assert(unknownMismatch.Status == StructuralQuantityStatus.FAIL,
                    "an evaluable Unknown row with a changed cached result must fail");
                Assert(unknownFailure != null && unknownFailure.Expected == 7.2m && unknownFailure.Actual == 999m,
                    "the Unknown-row mismatch must retain expected/actual evidence");

                textResultPath = CopyWithCell(zg04APath, "G5", "1.08", true);
                StructuralLedgerWorkbookImportResult textResult = StructuralLedgerWorkbookAdapter.ImportZg04A(textResultPath);
                Assert(textResult.Status == StructuralQuantityStatus.FAIL && textResult.Message.Contains("FT!G5", StringComparison.Ordinal),
                    "a text-typed result cell must fail at its source address");

                textCountPath = CopyWithCell(zj02Path, "C3", "1", true);
                StructuralLedgerWorkbookImportResult textCount = StructuralLedgerWorkbookAdapter.ImportZj02(textCountPath);
                Assert(textCount.Status == StructuralQuantityStatus.FAIL && textCount.Message.Contains("FT!C3", StringComparison.Ordinal),
                    "a text-typed count cell must fail at its source address");

                formulaResultPath = CopyWithCell(zg04APath, "G5", "1.08", false, "2.4*3*0.15");
                StructuralLedgerWorkbookImportResult formulaResult = StructuralLedgerWorkbookAdapter.ImportZg04A(formulaResultPath);
                Assert(formulaResult.Status == StructuralQuantityStatus.FAIL && formulaResult.Message.Contains("FT!G5", StringComparison.Ordinal),
                    "the fixed raw schema must reject a hidden formula even when its cache matches");

                Console.WriteLine("Raw ledger hardening: Unknown mismatch, numeric-cell type, and hidden-formula checks passed.");
            }
            finally
            {
                DeleteIfPresent(unknownMismatchPath);
                DeleteIfPresent(textResultPath);
                DeleteIfPresent(textCountPath);
                DeleteIfPresent(formulaResultPath);
            }
        }

        private static string CopyWithCell(string sourcePath, string address, string value, bool inlineText, string formula = null)
        {
            string extension = Path.GetExtension(sourcePath);
            string copyPath = Path.Combine(Path.GetTempPath(), "lukas-structural-" + Guid.NewGuid().ToString("N") + extension);
            File.Copy(sourcePath, copyPath);
            using (ZipArchive archive = ZipFile.Open(copyPath, ZipArchiveMode.Update))
            {
                const string worksheetPath = "xl/worksheets/sheet1.xml";
                ZipArchiveEntry entry = archive.GetEntry(worksheetPath);
                Assert(entry != null, "fixture has no " + worksheetPath);
                XDocument document;
                using (Stream input = entry.Open()) document = XDocument.Load(input);
                XNamespace spreadsheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
                XElement cell = document.Descendants(spreadsheet + "c").SingleOrDefault(element =>
                    string.Equals((string)element.Attribute("r"), address, StringComparison.Ordinal));
                Assert(cell != null, "fixture has no cell " + address);

                cell.Elements(spreadsheet + "v").Remove();
                cell.Elements(spreadsheet + "is").Remove();
                cell.Elements(spreadsheet + "f").Remove();
                if (inlineText)
                {
                    cell.SetAttributeValue("t", "inlineStr");
                    cell.Add(new XElement(spreadsheet + "is", new XElement(spreadsheet + "t", value)));
                }
                else
                {
                    cell.SetAttributeValue("t", null);
                    if (!string.IsNullOrWhiteSpace(formula)) cell.Add(new XElement(spreadsheet + "f", formula));
                    cell.Add(new XElement(spreadsheet + "v", value));
                }

                entry.Delete();
                ZipArchiveEntry replacement = archive.CreateEntry(worksheetPath, CompressionLevel.Optimal);
                using (Stream output = replacement.Open()) document.Save(output);
            }
            return copyPath;
        }

        private static string CopyWithFormulaWithoutCache(string sourcePath, string address, string formula)
        {
            string extension = Path.GetExtension(sourcePath);
            string copyPath = Path.Combine(Path.GetTempPath(), "lukas-structural-" + Guid.NewGuid().ToString("N") + extension);
            File.Copy(sourcePath, copyPath);
            using (ZipArchive archive = ZipFile.Open(copyPath, ZipArchiveMode.Update))
            {
                const string worksheetPath = "xl/worksheets/sheet1.xml";
                ZipArchiveEntry entry = archive.GetEntry(worksheetPath);
                Assert(entry != null, "fixture has no " + worksheetPath);
                XDocument document;
                using (Stream input = entry.Open()) document = XDocument.Load(input);
                XNamespace spreadsheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
                XElement sheetData = document.Descendants(spreadsheet + "sheetData").Single();
                int rowNumber = int.Parse(new string(address.SkipWhile(char.IsLetter).ToArray()), CultureInfo.InvariantCulture);
                XElement row = sheetData.Elements(spreadsheet + "row").Single(element => (int)element.Attribute("r") == rowNumber);
                XElement cell = row.Elements(spreadsheet + "c").SingleOrDefault(element =>
                    string.Equals((string)element.Attribute("r"), address, StringComparison.Ordinal));
                if (cell == null)
                {
                    cell = new XElement(spreadsheet + "c", new XAttribute("r", address));
                    row.Add(cell);
                }
                cell.SetAttributeValue("t", null);
                cell.RemoveNodes();
                cell.Add(new XElement(spreadsheet + "f", formula));
                entry.Delete();
                ZipArchiveEntry replacement = archive.CreateEntry(worksheetPath, CompressionLevel.Optimal);
                using (Stream output = replacement.Open()) document.Save(output);
            }
            return copyPath;
        }

        private static void DeleteIfPresent(string path)
        {
            if (!string.IsNullOrWhiteSpace(path) && File.Exists(path)) File.Delete(path);
        }

        private static void Validate(string label, StructuralWorkbookImportResult result, string schemaId,
            IReadOnlyDictionary<string, decimal> expected)
        {
            Assert(result != null, label + " result is null");
            Assert(result.SchemaId == schemaId, label + " schema mismatch: " + result.SchemaId);
            Assert(result.Status == StructuralQuantityStatus.PASS, label + " import did not pass: " + result.Message + " / " +
                string.Join(" | ", result.Anchors.Where(anchor => anchor.Status != StructuralQuantityStatus.PASS)
                    .Select(anchor => anchor.AnchorId + ":" + anchor.Message + ":" +
                        string.Join(",", anchor.Values.Where(value => !value.FormulaValid).Select(EvidenceLocation)))));
            Assert(result.RawLedgerStatus == StructuralQuantityStatus.NOT_EVALUATED,
                label + " raw ledger must remain NOT_EVALUATED");
            Assert(result.RawToOfficialStatus == StructuralQuantityStatus.REVIEW,
                label + " raw-to-official status must remain REVIEW");
            Assert(result.Anchors.Count == 3, label + " must contain exactly three anchors");
            Assert(result.Anchors.Select(x => x.AnchorId).OrderBy(x => x, StringComparer.Ordinal)
                .SequenceEqual(expected.Keys.OrderBy(x => x, StringComparer.Ordinal)), label + " anchor IDs mismatch");

            foreach (StructuralWorkbookAnchorCheck anchor in result.Anchors)
            {
                decimal total = expected[anchor.AnchorId];
                Assert(anchor.Status == StructuralQuantityStatus.PASS,
                    label + " anchor did not pass: " + anchor.AnchorId + " / " + anchor.Message);
                Assert(anchor.Values.Count > 1, label + " anchor lacks independent evidence: " + anchor.AnchorId);
                foreach (StructuralWorkbookValue value in anchor.Values)
                {
                    Assert(value.Quantity.HasValue && value.Quantity.Value == total,
                        label + " exact total mismatch at " + EvidenceLocation(value) + ": expected=" +
                        total.ToString(CultureInfo.InvariantCulture) + ", actual=" +
                        (value.Quantity.HasValue ? value.Quantity.Value.ToString(CultureInfo.InvariantCulture) : "<non-numeric>"));
                    Assert(value.Evidence != null, label + " evidence is null: " + anchor.AnchorId);
                    Assert(IsSha256(value.Evidence.SourceSha256),
                        label + " evidence SHA-256 is not 64 hex characters: " + anchor.AnchorId);
                    Assert(!string.IsNullOrWhiteSpace(value.Evidence.Sheet),
                        label + " evidence sheet is empty: " + anchor.AnchorId);
                    Assert(!string.IsNullOrWhiteSpace(value.Evidence.Cell),
                        label + " evidence cell is empty: " + anchor.AnchorId);
                    Assert(!string.IsNullOrWhiteSpace(value.Evidence.RawValue),
                        label + " evidence raw value is empty: " + anchor.AnchorId);
                    Assert(value.FormulaValid, label + " anchor formula/cache dependency check failed: " + EvidenceLocation(value));
                    if (!string.IsNullOrWhiteSpace(value.Evidence.ExpectedFormula))
                    {
                        Assert(!string.IsNullOrWhiteSpace(value.Evidence.Formula), label + " stored formula is missing: " + EvidenceLocation(value));
                        Assert(value.Evidence.RecalculatedValue.HasValue && value.Evidence.RecalculatedValue.Value == value.Quantity.Value,
                            label + " cached value differs from recalculated dependencies: " + EvidenceLocation(value));
                    }
                }
            }
        }

        private static string Fingerprint(StructuralWorkbookImportResult result)
        {
            return string.Join("\n", result.Anchors.SelectMany(anchor => anchor.Values.Select(value =>
                anchor.AnchorId + "|" + value.Quantity.Value.ToString(CultureInfo.InvariantCulture) + "|" +
                value.Evidence.SourceSha256 + "|" + value.Evidence.Sheet + "|" + value.Evidence.Cell + "|" +
                value.Evidence.RawValue)));
        }

        private static string EvidenceLocation(StructuralWorkbookValue value)
        {
            return value.Evidence == null ? "<missing evidence>" : value.Evidence.Sheet + "!" + value.Evidence.Cell;
        }

        private static bool IsSha256(string value)
        {
            return value != null && value.Length == 64 && value.All(Uri.IsHexDigit);
        }

        private static void Assert(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException("Structural fixture test failed: " + message);
        }
    }
}
