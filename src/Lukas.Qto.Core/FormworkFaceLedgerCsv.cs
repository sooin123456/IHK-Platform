using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace Lukas.Qto.Core
{
    // Reader for the separate Revit face ledger.  The extractor intentionally emits
    // Unknown/Review; this reader does not infer contact, openings, or a decision.
    public sealed class FormworkFaceLedgerImport
    {
        public IReadOnlyList<FormworkFaceRow> Faces { get; internal set; }
        public string LedgerPath { get; internal set; }
        public string ManifestPath { get; internal set; }
        public string LedgerSha256 { get; internal set; }
        public string CanonicalGeometryLedgerSha256 { get; internal set; }
        public string ManifestSha256 { get; internal set; }
        public string ExportedAtUtc { get; internal set; }
        public string RevitVersion { get; internal set; }
    }

    public static class FormworkFaceLedgerCsv
    {
        public static readonly string[] LedgerHeader = { "face_id", "element_id", "host_element_id", "member_type", "level", "category", "material_evidence", "face_area_m2", "orientation_evidence", "boundary_kind", "boundary_evidence_id", "decision", "review_reason" };
        public static readonly string[] ManifestHeader = { "product_version", "exported_at_utc", "revit_version", "ledger_file", "ledger_sha256", "canonical_geometry_ledger_sha256", "face_row_count", "status" };
        // Every face must be explicitly bound to the exported ledger SHA. The
        // approval-source hash is supplied from this CSV's immutable file digest.
        public static readonly string[] ApprovalHeader = { "face_id", "ledger_sha256", "area_basis", "opening_union_m2", "boundary_kind", "boundary_evidence_id", "decision", "policy_rule_id", "policy_sha256", "policy_source_ref", "approval_source_id", "approval_revision", "approval_sheet", "approval_cell" };
        public static readonly string[] RegistryHeader = { "kind", "id", "sha256" };

        public static FormworkFaceLedgerImport ReadExport(string ledgerPath, string manifestPath = null)
        {
            ledgerPath = RequiredCsv(ledgerPath, "formwork face ledger");
            manifestPath = string.IsNullOrWhiteSpace(manifestPath)
                ? Path.Combine(Path.GetDirectoryName(ledgerPath), Path.GetFileNameWithoutExtension(ledgerPath) + ".manifest.csv")
                : RequiredCsv(manifestPath, "formwork face ledger manifest");
            manifestPath = RequiredCsv(manifestPath, "formwork face ledger manifest");
            List<string[]> ledger = ReadExact(ledgerPath, LedgerHeader, "formwork face ledger");
            List<string[]> manifest = ReadExact(manifestPath, ManifestHeader, "formwork face ledger manifest");
            if (manifest.Count != 2) throw new InvalidDataException("formwork face ledger manifest는 정확히 한 행이어야 합니다.");
            string[] m = manifest[1];
            if (m[7] != "REVIEW") throw new InvalidDataException("formwork face ledger manifest status는 REVIEW여야 합니다.");
            if (m[3] != Path.GetFileName(ledgerPath) || !StructuralRuleEvidence.ValidSha(m[4]) || !StructuralRuleEvidence.ValidSha(m[5]) ||
                !int.TryParse(m[6], NumberStyles.None, CultureInfo.InvariantCulture, out int count) || count != ledger.Count - 1 ||
                !DateTime.TryParse(m[1], CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out DateTime timestamp) || timestamp.Kind != DateTimeKind.Utc)
                throw new InvalidDataException("formwork face ledger manifest binding 또는 UTC/count 계약이 올바르지 않습니다.");
            if (count < 1) throw new InvalidDataException("formwork face ledger에는 적어도 하나의 실제 face가 필요합니다.");
            string actualHash = RunManifest.Hash(ledgerPath);
            if (!string.Equals(actualHash, m[4], StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("formwork face ledger SHA-256이 manifest와 다릅니다.");
            var faces = new List<FormworkFaceRow>();
            var ids = new HashSet<string>(StringComparer.Ordinal);
            for (int index = 1; index < ledger.Count; index++)
            {
                string[] row = ledger[index];
                if (!decimal.TryParse(row[7], NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out decimal area) || area < 0m ||
                    !Enum.TryParse(row[9], false, out FormworkBoundaryKind boundary) || !Enum.TryParse(row[11], false, out FormworkDecision decision) ||
                    string.IsNullOrWhiteSpace(row[0]) || string.IsNullOrWhiteSpace(row[1]) || !ids.Add(row[0]))
                    throw new InvalidDataException("formwork face ledger " + (index + 1) + "행이 올바르지 않거나 face_id가 중복됩니다.");
                // Exporter must not make an unreviewed construction assertion.
                if (boundary != FormworkBoundaryKind.Unknown || decision != FormworkDecision.Review)
                    throw new InvalidDataException("formwork face ledger는 추정 판정이 아닌 Unknown/Review 원장만 허용합니다.");
                faces.Add(new FormworkFaceRow {
                    FaceId = row[0], ElementId = row[1], HostElementId = row[2], MemberType = row[3], Level = row[4], Category = row[5], MaterialEvidence = row[6],
                    FaceAreaM2 = area, OrientationEvidence = row[8], BoundaryKind = boundary, BoundaryEvidenceId = row[10], Decision = decision, ReviewReason = row[12],
                    AreaBasis = FormworkAreaBasis.Gross, OpeningUnionAreaM2 = 0m,
                    Source = new StructuralSourceEvidence { SourceId = "FORMWORK_FACE_LEDGER", Sha256 = actualHash, Revision = m[1], Sheet = Path.GetFileName(ledgerPath), Row = index + 1 }
                });
            }
            string canonical = FormworkTakeoff.ComputeLedgerHash(faces);
            if (!string.Equals(canonical, m[5], StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("formwork face ledger canonical geometry SHA-256이 manifest와 다릅니다.");
            foreach (FormworkFaceRow face in faces) face.GeometryLedgerSha256 = canonical;
            return new FormworkFaceLedgerImport { Faces = faces.AsReadOnly(), LedgerPath = ledgerPath, ManifestPath = manifestPath, LedgerSha256 = actualHash, CanonicalGeometryLedgerSha256 = canonical, ManifestSha256 = RunManifest.Hash(manifestPath), ExportedAtUtc = m[1], RevitVersion = m[2] };
        }

        public static IReadOnlyList<FormworkFaceRow> ApplyApprovals(FormworkFaceLedgerImport imported, string approvalPath)
        {
            if (imported == null) throw new ArgumentNullException("imported");
            approvalPath = RequiredCsv(approvalPath, "formwork face approval");
            List<string[]> rows = ReadExact(approvalPath, ApprovalHeader, "formwork face approval");
            if (rows.Count - 1 != imported.Faces.Count) throw new InvalidDataException("formwork face approval은 원장의 모든 face를 정확히 한 번씩 명시해야 합니다.");
            string approvalHash = RunManifest.Hash(approvalPath);
            var result = new Dictionary<string, FormworkFaceRow>(StringComparer.Ordinal);
            foreach (string[] row in rows.Skip(1))
            {
                if (!string.Equals(row[1], imported.LedgerSha256, StringComparison.OrdinalIgnoreCase) || !Enum.TryParse(row[2], false, out FormworkAreaBasis areaBasis) ||
                    !decimal.TryParse(row[3], NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out decimal opening) || opening < 0m ||
                    !Enum.TryParse(row[4], false, out FormworkBoundaryKind boundary) || !Enum.TryParse(row[6], false, out FormworkDecision decision) ||
                    !StructuralRuleEvidence.ValidSha(row[8]) || string.IsNullOrWhiteSpace(row[0]) || string.IsNullOrWhiteSpace(row[5]) || string.IsNullOrWhiteSpace(row[7]) ||
                    string.IsNullOrWhiteSpace(row[9]) || string.IsNullOrWhiteSpace(row[10]) || string.IsNullOrWhiteSpace(row[11]) || string.IsNullOrWhiteSpace(row[12]) || string.IsNullOrWhiteSpace(row[13]))
                    throw new InvalidDataException("formwork face approval 행이 올바르지 않습니다.");
                FormworkFaceRow raw = imported.Faces.FirstOrDefault(x => x.FaceId == row[0]);
                if (raw == null) throw new InvalidDataException("formwork face approval에 원장에 없는 face_id가 있습니다.");
                if (result.ContainsKey(row[0])) throw new InvalidDataException("formwork face approval face_id가 중복됩니다.");
                result.Add(row[0], new FormworkFaceRow {
                    FaceId = raw.FaceId, ElementId = raw.ElementId, HostElementId = raw.HostElementId, MemberType = raw.MemberType, Level = raw.Level,
                    Category = raw.Category, MaterialEvidence = raw.MaterialEvidence, OrientationEvidence = raw.OrientationEvidence, ReviewReason = raw.ReviewReason,
                    Source = raw.Source, GeometryLedgerSha256 = raw.GeometryLedgerSha256, FaceAreaM2 = raw.FaceAreaM2,
                    AreaBasis = areaBasis, OpeningUnionAreaM2 = opening, BoundaryKind = boundary, BoundaryEvidenceId = row[5], Decision = decision,
                    Policy = new StructuralRuleEvidence { RuleId = row[7], Sha256 = row[8], SourceRef = row[9] },
                    DecisionSource = new StructuralSourceEvidence { SourceId = row[10], Sha256 = approvalHash, Revision = row[11], Sheet = row[12], Cell = row[13] }
                });
            }
            return imported.Faces.Select(face => result[face.FaceId]).ToList().AsReadOnly();
        }

        public static StructuralEvidenceRegistry ReadRegistry(string path)
        {
            List<string[]> rows = ReadExact(RequiredCsv(path, "formwork registry"), RegistryHeader, "formwork registry");
            var registry = new StructuralEvidenceRegistry();
            foreach (string[] row in rows.Skip(1))
            {
                if (string.IsNullOrWhiteSpace(row[1]) || !StructuralRuleEvidence.ValidSha(row[2])) throw new InvalidDataException("formwork registry ID/SHA가 올바르지 않습니다.");
                Dictionary<string, string> target = row[0] == "source" ? registry.ApprovedSourceHashes : row[0] == "rule" ? registry.ApprovedRuleHashes : row[0] == "document" ? registry.ApprovedDocumentHashes : null;
                if (target == null || target.ContainsKey(row[1])) throw new InvalidDataException("formwork registry kind 또는 ID가 올바르지 않습니다.");
                target.Add(row[1], row[2]);
            }
            return registry;
        }

        private static string RequiredCsv(string path, string label)
        {
            if (string.IsNullOrWhiteSpace(path) || !File.Exists(path) || !string.Equals(Path.GetExtension(path), ".csv", StringComparison.OrdinalIgnoreCase)) throw new FileNotFoundException(label + " CSV 파일을 찾을 수 없습니다.", path);
            return Path.GetFullPath(path);
        }
        private static List<string[]> ReadExact(string path, string[] header, string label)
        {
            List<string[]> rows = Csv.Read(path);
            if (rows.Count == 0 || !rows[0].SequenceEqual(header, StringComparer.Ordinal) || rows.Skip(1).Any(x => x.Length != header.Length)) throw new InvalidDataException(label + " CSV 계약이 올바르지 않습니다.");
            return rows;
        }
    }
}
