using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace THEKIE.Qto.Core
{
    public static class RebarTakeoffReport
    {
        public static TakeoffReportArtifact Verify(string path)
        {
            string report = Path.GetFullPath(path), manifest = report + ".manifest.csv";
            if (!File.Exists(report) || !File.Exists(manifest)) throw new FileNotFoundException("철근 report bundle이 완전하지 않습니다.");
            List<string[]> manifestRows = Csv.Read(manifest);
            if (manifestRows.Count < 7 || !manifestRows[0].SequenceEqual(new[] { "key", "value" }, StringComparer.Ordinal) || manifestRows.Skip(1).Any(row => row.Length != 2)) throw new InvalidDataException("철근 report manifest 형식이 올바르지 않습니다.");
            var values = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (string[] row in manifestRows.Skip(1))
                if (string.IsNullOrWhiteSpace(row[0]) || values.ContainsKey(row[0])) throw new InvalidDataException("철근 report manifest 키가 비어 있거나 중복됩니다.");
                else values.Add(row[0], row[1]);
            string[] required = { "input_length_ledger", "input_rule_bundle", "input_registry" };
            if (!required.All(values.ContainsKey) || values.Where(pair => pair.Key.StartsWith("input_", StringComparison.Ordinal)).Any(pair => !ValidSha(pair.Value)))
                throw new InvalidDataException("철근 report 입력 SHA-256 근거가 올바르지 않습니다.");
            string hash = RunManifest.Hash(report);
            List<string[]> reportRows = Csv.Read(report);
            string[] header = { "record_type", "status", "spec", "raw_length_m", "additional_length_m", "mass_before_loss_kg", "loss_kg", "final_mass_kg", "formula", "evidence", "message" };
            if (reportRows.Count < 2 || !reportRows[0].SequenceEqual(header, StringComparer.Ordinal) || reportRows.Skip(1).Any(row => row.Length != header.Length))
                throw new InvalidDataException("철근 report header 또는 열 수가 올바르지 않습니다.");
            string[] summary = reportRows[1];
            StructuralQuantityStatus summaryStatus;
            if (summary[0] != "SUMMARY" || !Status(summary[1], out summaryStatus) || reportRows.Skip(2).Any(row => row[0] != "SPEC" || row[1] != summary[1]))
                throw new InvalidDataException("철근 report는 하나의 SUMMARY와 동일 status의 SPEC 행만 허용합니다.");
            if (!Blank(summary, 2, 4) || !Blank(summary, 6, 6) || !string.IsNullOrEmpty(summary[9]) || string.IsNullOrWhiteSpace(Original(summary[10])))
                throw new InvalidDataException("철근 SUMMARY 행 계약이 올바르지 않습니다.");
            decimal? calculated = OptionalNumber(summary[5], "SUMMARY 계산 kg"), official = OptionalNumber(summary[7], "SUMMARY official kg");
            decimal? delta = Delta(summary[8]);
            if (delta.HasValue != (calculated.HasValue && official.HasValue) || (delta.HasValue && delta.Value != calculated.Value - official.Value))
                throw new InvalidDataException("철근 SUMMARY delta가 계산 kg와 official kg의 차이가 아닙니다.");
            var specifications = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            decimal specificationTotal = 0m;
            foreach (string[] row in reportRows.Skip(2))
            {
                string spec = Original(row[2]);
                if (string.IsNullOrWhiteSpace(spec) || !specifications.Add(spec) || !Numbers(row, 3, 7) ||
                    string.IsNullOrWhiteSpace(Original(row[8])) || string.IsNullOrWhiteSpace(Original(row[9])) || string.IsNullOrWhiteSpace(Original(row[10])))
                    throw new InvalidDataException("철근 SPEC 행에는 규격·수치·공식·근거가 필요합니다.");
                decimal before = RequiredNumber(row[5], "SPEC 손율 전 kg"), loss = RequiredNumber(row[6], "SPEC 손율 kg"), final = RequiredNumber(row[7], "SPEC 최종 kg");
                if (final != before + loss) throw new InvalidDataException("철근 SPEC 최종 kg가 손율 전 kg와 손율 kg의 합이 아닙니다.");
                specificationTotal = checked(specificationTotal + final);
            }
            if ((calculated.HasValue && specifications.Count == 0) || (calculated.HasValue && calculated.Value != specificationTotal))
                throw new InvalidDataException("철근 SUMMARY 계산 kg가 SPEC 최종 kg 합계와 다릅니다.");
            if (summaryStatus == StructuralQuantityStatus.PASS && (specifications.Count == 0 || !calculated.HasValue || !official.HasValue || !delta.HasValue || !values.ContainsKey("input_official_target")))
                throw new InvalidDataException("PASS 철근 report에는 독립 official target 값과 입력 SHA-256이 필요합니다.");
            string verifiedHash = RunManifest.Hash(report);
            if (!string.Equals(hash, verifiedHash, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("검증 중 철근 report 내용이 변경되었습니다.");
            if (!values.TryGetValue("report_file", out string file) || Original(file) != Path.GetFileName(report) || !values.TryGetValue("report_sha256", out string expected) || !string.Equals(expected, hash, StringComparison.OrdinalIgnoreCase) || !values.TryGetValue("row_count", out string count) || !int.TryParse(count, NumberStyles.None, CultureInfo.InvariantCulture, out int parsed) || parsed != reportRows.Count) throw new InvalidDataException("철근 report manifest SHA-256 또는 행 수가 맞지 않습니다.");
            return new TakeoffReportArtifact { ReportPath = report, ManifestPath = manifest, ReportSha256 = hash };
        }
        public static TakeoffReportArtifact Write(string path, RebarTakeoffResult result, IDictionary<string, string> inputSha256)
        {
            if (result == null) throw new ArgumentNullException("result");
            ValidateInputs(result.Status, inputSha256);
            string report = Path.GetFullPath(path), manifest = Path.GetFullPath(path) + ".manifest.csv";
            if (File.Exists(report) || File.Exists(manifest)) throw new IOException("기존 철근 report를 덮어쓰지 않습니다.");
            string parent = Path.GetDirectoryName(report); if (string.IsNullOrEmpty(parent)) throw new IOException("철근 report 상위 폴더가 없습니다."); Directory.CreateDirectory(parent);
            string stage = Path.Combine(parent, "." + Path.GetFileName(report) + "." + Guid.NewGuid().ToString("N") + ".tmp");
            var published = new List<string>();
            try {
                Directory.CreateDirectory(stage); string stagedReport = Path.Combine(stage, Path.GetFileName(report)); string stagedManifest = Path.Combine(stage, Path.GetFileName(manifest));
                var rows = new List<string[]> { new[] { "record_type", "status", "spec", "raw_length_m", "additional_length_m", "mass_before_loss_kg", "loss_kg", "final_mass_kg", "formula", "evidence", "message" }, new[] { "SUMMARY", result.Status.ToString(), "", "", "", Number(result.CalculatedMassKg), "", Number(result.OfficialMassKg), Protect("delta_kg=" + Number(result.DeltaKg)), "", Protect(result.Message) } };
                rows.AddRange(result.Specifications.Select(x => new[] { "SPEC", result.Status.ToString(), Protect(x.Spec), Number(x.RawLengthM), Number(x.AdditionalLengthM), Number(x.MassBeforeLossKg), Number(x.LossKg), Number(x.FinalMassKg), Protect(x.Formula), Protect(x.Evidence), Protect(result.Message) }));
                Csv.Write(stagedReport, rows); string hash = RunManifest.Hash(stagedReport);
                var manifestRows = new List<string[]> { new[] { "key", "value" }, new[] { "report_file", Protect(Path.GetFileName(report)) }, new[] { "report_sha256", hash }, new[] { "row_count", rows.Count.ToString(CultureInfo.InvariantCulture) } };
                foreach (KeyValuePair<string, string> pair in inputSha256.OrderBy(pair => pair.Key, StringComparer.Ordinal)) {
                    if (!ValidKey(pair.Key) || !ValidSha(pair.Value)) throw new InvalidDataException("철근 report 입력 근거가 올바르지 않습니다.");
                    manifestRows.Add(new[] { "input_" + pair.Key, pair.Value });
                }
                Csv.Write(stagedManifest, manifestRows);
                Publish(stagedReport, report); published.Add(report); Publish(stagedManifest, manifest); published.Add(manifest);
                return new TakeoffReportArtifact { ReportPath = report, ManifestPath = manifest, ReportSha256 = hash };
            } catch { foreach (string item in published) try { File.Delete(item); } catch { } throw; }
            finally { try { if (Directory.Exists(stage)) Directory.Delete(stage, true); } catch { } }
        }
        private static void Publish(string source, string destination)
        {
            bool created = false;
            try
            {
                using (var input = File.OpenRead(source))
                using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    created = true;
                    input.CopyTo(output);
                }
            }
            catch
            {
                if (created) try { File.Delete(destination); } catch { }
                throw;
            }
        }
        private static string Protect(string value) { return Csv.SpreadsheetText(value ?? ""); }
        private static string Original(string value) { return !string.IsNullOrEmpty(value) && value[0] == '\'' && value.Length > 1 && "'=+-@".IndexOf(value[1]) >= 0 ? value.Substring(1) : value; }
        private static bool ValidKey(string value) { return !string.IsNullOrWhiteSpace(value) && value.All(c => c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_'); }
        private static bool ValidSha(string value) { return value != null && value.Length == 64 && value.All(c => c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F'); }
        private static bool Numbers(string[] row, int first, int last) { for (int i = first; i <= last; i++) { decimal value; if (!decimal.TryParse(row[i], NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out value)) return false; } return true; }
        private static bool Status(string value, out StructuralQuantityStatus status) { return Enum.TryParse(value, false, out status) && Enum.IsDefined(typeof(StructuralQuantityStatus), status); }
        private static bool Blank(string[] row, int first, int last) { for (int i = first; i <= last; i++) if (!string.IsNullOrEmpty(row[i])) return false; return true; }
        private static decimal RequiredNumber(string value, string label) { decimal number; if (!decimal.TryParse(value, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out number)) throw new InvalidDataException(label + "가 올바른 decimal이 아닙니다."); return number; }
        private static decimal? OptionalNumber(string value, string label) { return string.IsNullOrEmpty(value) ? (decimal?)null : RequiredNumber(value, label); }
        private static decimal? Delta(string value)
        {
            string original = Original(value);
            const string prefix = "delta_kg=";
            if (original == null || !original.StartsWith(prefix, StringComparison.Ordinal)) throw new InvalidDataException("철근 SUMMARY delta 공식이 올바르지 않습니다.");
            return OptionalNumber(original.Substring(prefix.Length), "SUMMARY delta kg");
        }
        private static void ValidateInputs(StructuralQuantityStatus status, IDictionary<string, string> inputs)
        {
            if (inputs == null) throw new InvalidDataException("철근 report 입력 SHA-256이 필요합니다.");
            string[] required = { "length_ledger", "rule_bundle", "registry" };
            if (!required.All(inputs.ContainsKey) || inputs.Any(pair => !ValidKey(pair.Key) || !ValidSha(pair.Value)) ||
                (status == StructuralQuantityStatus.PASS && !inputs.ContainsKey("official_target")))
                throw new InvalidDataException("철근 report 상태에 필요한 입력 SHA-256 근거가 없거나 올바르지 않습니다.");
        }
        private static string Number(decimal? value) => value.HasValue ? value.Value.ToString(CultureInfo.InvariantCulture) : "";
        private static string Number(decimal value) => value.ToString(CultureInfo.InvariantCulture);
    }
}
