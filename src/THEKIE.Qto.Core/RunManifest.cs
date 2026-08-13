using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;

namespace THEKIE.Qto.Core
{
    public static class RunManifest
    {
        public const string RulesetVersion = "L1.4.3";

        public static void Write(string path, string qtoPath, string estimatePath, string mappingPath, AuditPolicy policy, string qtoHash = null, string estimateHash = null, string mappingHash = null, string sourceManifestPath = null, string sourceManifestHash = null, SourceGateResult sourceGate = null, bool sourceGateSkipped = false, string cliAssemblyHash = null, string ifcPath = null, string ifcHash = null, string reportPath = null, string reportHash = null)
        {
            if (policy == null) throw new ArgumentNullException("policy");
            var rows = new List<string[]> {
                new[] { "키", "값" },
                new[] { "규칙버전", RulesetVersion },
                new[] { "엔진_코어_SHA256", AssemblyHash(typeof(RunManifest)) },
                new[] { "엔진_CLI_SHA256", cliAssemblyHash ?? "" },
                new[] { "수량허용오차", policy.QuantityTolerance.ToString(CultureInfo.InvariantCulture) },
                new[] { "KRW허용오차", policy.KrwTolerance.ToString(CultureInfo.InvariantCulture) },
                new[] { "생성시각_UTC", DateTime.UtcNow.ToString("o") },
                new[] { "QTO_파일", Csv.SpreadsheetText(Path.GetFileName(qtoPath)) }, new[] { "QTO_SHA256", qtoHash ?? Hash(qtoPath) },
                new[] { "내역_파일", Csv.SpreadsheetText(Path.GetFileName(estimatePath)) }, new[] { "내역_SHA256", estimateHash ?? Hash(estimatePath) },
                new[] { "매핑_파일", Csv.SpreadsheetText(Path.GetFileName(mappingPath)) }, new[] { "매핑_SHA256", mappingHash ?? Hash(mappingPath) }
            };
            if (!string.IsNullOrEmpty(ifcPath))
            {
                rows.Add(new[] { "IFC_파일", Csv.SpreadsheetText(Path.GetFileName(ifcPath)) });
                rows.Add(new[] { "IFC_SHA256", ifcHash ?? Hash(ifcPath) });
            }
            if (!string.IsNullOrEmpty(reportPath))
            {
                rows.Add(new[] { "결과_CSV_파일", Csv.SpreadsheetText(Path.GetFileName(reportPath)) });
                rows.Add(new[] { "결과_CSV_SHA256", reportHash ?? Hash(reportPath) });
            }
            string gateStatus = sourceGateSkipped ? "SKIPPED" : sourceGate == null ? "UNRECORDED" : sourceGate.Passed ? "PASS" : "FAIL";
            rows.Add(new[] { "소스게이트", gateStatus });
            rows.Add(new[] { "소스_매니페스트", string.IsNullOrEmpty(sourceManifestPath) ? "" : Csv.SpreadsheetText(Path.GetFileName(sourceManifestPath)) });
            rows.Add(new[] { "소스_매니페스트_SHA256", sourceManifestHash ?? (string.IsNullOrEmpty(sourceManifestPath) ? "" : Hash(sourceManifestPath)) });
            rows.Add(new[] { "공사범위_ID", sourceGate == null ? "" : Csv.SpreadsheetText(sourceGate.SelectedScopeId ?? "") });
            foreach (string slot in new[] { "ifc", "qto", "estimate", "mapping" })
            {
                string sourceId;
                rows.Add(new[] { slot.ToUpperInvariant() + "_소스_ID", sourceGate != null && sourceGate.SelectedSourceIds.TryGetValue(slot, out sourceId) ? Csv.SpreadsheetText(sourceId) : "" });
            }
            Csv.Write(path, rows);
        }

        public static string Hash(string path)
        {
            using (var stream = File.OpenRead(path))
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "");
        }

        private static string AssemblyHash(Type type)
        {
            string location = type.Assembly.Location;
            return string.IsNullOrEmpty(location) || !File.Exists(location) ? "UNAVAILABLE" : Hash(location);
        }
    }
}
