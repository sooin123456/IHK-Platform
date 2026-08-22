using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace Lukas.Qto.Core
{
    public sealed class RevitExportPackageResult
    {
        public string PackageDirectory { get; internal set; }
        public string ExportManifestPath { get; internal set; }
        public string IfcPath { get; internal set; }
        public string QtoPath { get; internal set; }
        public string ElementLedgerPath { get; internal set; }
        public string ExportManifestSha256 { get; internal set; }
        public string IfcSha256 { get; internal set; }
        public string QtoSha256 { get; internal set; }
        public string ElementLedgerSha256 { get; internal set; }
        public int QtoRowCount { get; internal set; }
        public int ElementCount { get; internal set; }
        public int ElementLedgerRowCount { get; internal set; }
    }

    // Verifies the immutable four-file Revit export boundary before any takeoff rule is evaluated.
    public static class RevitExportPackage
    {
        private static readonly string[] Headers =
        {
            "product_version", "exported_at_utc", "revit_version", "document_title", "ifc_configuration",
            "ifc_file", "ifc_sha256", "qto_file", "qto_sha256", "qto_row_count", "element_count",
            "element_ledger_file", "element_ledger_sha256", "element_ledger_row_count", "status", "failure_reason"
        };

        public static RevitExportPackageResult Verify(string exportManifestPath)
        {
            string manifest = RequiredRegularFile(exportManifestPath, "export manifest");
            string directory = Path.GetDirectoryName(manifest) ?? Directory.GetCurrentDirectory();
            string manifestHash = RunManifest.Hash(manifest);
            List<string[]> rows = Csv.Read(manifest);
            EnsureHash(manifest, manifestHash, "export manifest를 읽는 중 파일이 변경되었습니다.");
            if (rows.Count != 2 || !rows[0].SequenceEqual(Headers, StringComparer.Ordinal) || rows[1].Length != Headers.Length)
                throw new FormatException("export-manifest.csv는 정확한 v2 16열 한 행이어야 합니다.");

            var values = Headers.Select((name, index) => new { name, value = (rows[1][index] ?? "").Trim() })
                .ToDictionary(x => x.name, x => x.value, StringComparer.Ordinal);
            if (!string.Equals(values["status"], "COMPLETE", StringComparison.Ordinal))
                throw new InvalidDataException("COMPLETE Revit export package만 사용할 수 있습니다.");
            if (!string.Equals(values["ifc_file"], "model.ifc", StringComparison.Ordinal) ||
                !string.Equals(values["qto_file"], "qto.csv", StringComparison.Ordinal) ||
                !string.Equals(values["element_ledger_file"], "element-ledger.csv", StringComparison.Ordinal))
                throw new InvalidDataException("export manifest의 고정 파일명이 올바르지 않습니다.");

            string ifc = RequiredRegularFile(Path.Combine(directory, "model.ifc"), "IFC");
            string qto = RequiredRegularFile(Path.Combine(directory, "qto.csv"), "QTO");
            string ledger = RequiredRegularFile(Path.Combine(directory, "element-ledger.csv"), "요소별 수량 원장");
            string ifcHash = RunManifest.Hash(ifc);
            string qtoHash = RunManifest.Hash(qto);
            string ledgerHash = RunManifest.Hash(ledger);
            if (!SameSha(ifcHash, values["ifc_sha256"]) || !SameSha(qtoHash, values["qto_sha256"]) || !SameSha(ledgerHash, values["element_ledger_sha256"]))
                throw new InvalidDataException("Revit export package 파일 SHA-256이 manifest와 다릅니다.");

            List<QtoRecord> qtoRows = Input.ReadQto(qto);
            IReadOnlyList<ElementQuantityLedgerRow> ledgerRows = ElementQuantityLedger.Read(ledger);
            int qtoRowCount = PositiveInt(values["qto_row_count"], "qto_row_count");
            int elementCount = PositiveInt(values["element_count"], "element_count");
            int ledgerRowCount = PositiveInt(values["element_ledger_row_count"], "element_ledger_row_count");
            var qtoIds = new HashSet<string>(qtoRows.SelectMany(x => x.ElementIds), StringComparer.Ordinal);
            var ledgerIds = new HashSet<string>(ledgerRows.Select(x => x.ElementId), StringComparer.Ordinal);
            if (qtoRows.Count != qtoRowCount || qtoIds.Count != elementCount || ledgerRows.Count != ledgerRowCount ||
                ledgerRows.Count != elementCount || !qtoIds.SetEquals(ledgerIds))
                throw new InvalidDataException("manifest, QTO, 요소별 원장의 행 수 또는 요소ID 집합이 일치하지 않습니다.");

            EnsureHash(manifest, manifestHash, "패키지 검증 중 export manifest가 변경되었습니다.");
            EnsureHash(ifc, ifcHash, "패키지 검증 중 IFC가 변경되었습니다.");
            EnsureHash(qto, qtoHash, "패키지 검증 중 QTO가 변경되었습니다.");
            EnsureHash(ledger, ledgerHash, "패키지 검증 중 요소별 원장이 변경되었습니다.");
            return new RevitExportPackageResult
            {
                PackageDirectory = directory,
                ExportManifestPath = manifest,
                IfcPath = ifc,
                QtoPath = qto,
                ElementLedgerPath = ledger,
                ExportManifestSha256 = manifestHash,
                IfcSha256 = ifcHash,
                QtoSha256 = qtoHash,
                ElementLedgerSha256 = ledgerHash,
                QtoRowCount = qtoRowCount,
                ElementCount = elementCount,
                ElementLedgerRowCount = ledgerRowCount
            };
        }

        private static string RequiredRegularFile(string path, string label)
        {
            if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException(label + " 경로가 없습니다.");
            string full = Path.GetFullPath(path);
            if (!File.Exists(full)) throw new FileNotFoundException(label + " 파일이 없습니다.", full);
            if ((File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0) throw new IOException(label + " 파일은 심볼릭 링크일 수 없습니다.");
            return full;
        }

        private static int PositiveInt(string value, string name)
        {
            int parsed;
            if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out parsed) || parsed <= 0)
                throw new InvalidDataException(name + "은 양의 정수여야 합니다.");
            return parsed;
        }

        private static bool SameSha(string actual, string declared)
        {
            return declared != null && declared.Length == 64 && string.Equals(actual, declared, StringComparison.OrdinalIgnoreCase);
        }

        private static void EnsureHash(string path, string expected, string message)
        {
            if (!SameSha(RunManifest.Hash(path), expected)) throw new IOException(message);
        }
    }
}
