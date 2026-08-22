using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace Lukas.Qto.Core
{
    public sealed class FormworkTakeoffReportArtifact
    {
        public string ReportPath { get; internal set; }
        public string ManifestPath { get; internal set; }
        public string ReportSha256 { get; internal set; }
    }

    public static class FormworkTakeoffReport
    {
        public static FormworkTakeoffReportArtifact Write(string path, FormworkTakeoffResult result, IDictionary<string, string> inputHashes)
        {
            if (result == null) throw new ArgumentNullException("result");
            if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("formwork report 경로가 없습니다.");
            path = Path.GetFullPath(path); string manifest = path + ".manifest.csv";
            if (File.Exists(path) || File.Exists(manifest)) throw new IOException("기존 formwork report를 덮어쓰지 않습니다.");
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            var rows = new List<string[]> { new[] { "record_type", "status", "subject_id", "expected_m2", "actual_m2", "rule", "message" } };
            rows.Add(new[] { "SUMMARY", result.Status.ToString(), "pure_formwork", "", result.PureFormworkM2.ToString(CultureInfo.InvariantCulture), "FW-SUM", "순수 거푸집" });
            rows.Add(new[] { "SUMMARY", result.Status.ToString(), "pe_film", "", result.PeFilmM2.ToString(CultureInfo.InvariantCulture), "FW-SUM", "PE 필름 (순수 거푸집과 별도)" });
            rows.Add(new[] { "SUMMARY", result.Status.ToString(), "bead_insulation", "", result.BeadInsulationM2.ToString(CultureInfo.InvariantCulture), "FW-SUM", "비드 단열재 (순수 거푸집과 별도)" });
            rows.Add(new[] { "SUMMARY", result.Status.ToString(), "pf_insulation", "", result.PfInsulationM2.ToString(CultureInfo.InvariantCulture), "FW-SUM", "PF 단열재 (순수 거푸집과 별도)" });
            foreach (FormworkFinding finding in result.Findings ?? Array.Empty<FormworkFinding>()) rows.Add(new[] { "FINDING", finding.Status.ToString(), finding.SubjectId ?? "", Decimal(finding.Expected), Decimal(finding.Actual), finding.Rule ?? "", finding.Message ?? "" });
            Csv.Write(path, rows);
            string hash = RunManifest.Hash(path);
            var manifestRows = new List<string[]> { new[] { "key", "value" }, new[] { "report_file", Path.GetFileName(path) }, new[] { "report_sha256", hash }, new[] { "status", result.Status.ToString() }, new[] { "exported_at_utc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) } };
            foreach (var pair in (inputHashes ?? new Dictionary<string, string>()).OrderBy(x => x.Key, StringComparer.Ordinal)) manifestRows.Add(new[] { "input_" + pair.Key + "_sha256", pair.Value ?? "" });
            Csv.Write(manifest, manifestRows);
            return new FormworkTakeoffReportArtifact { ReportPath = path, ManifestPath = manifest, ReportSha256 = hash };
        }
        private static string Decimal(decimal? value) { return value.HasValue ? value.Value.ToString(CultureInfo.InvariantCulture) : ""; }
    }
}
