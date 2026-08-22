using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Lukas.Qto.Core
{
    // This contract deliberately consumes classified faces.  It does not derive faces
    // from an element Area parameter, nor does it guess construction methods.
    public enum FormworkAreaBasis { Gross, Net, GenericAreaM2 }
    public enum FormworkBoundaryKind { Air, Soil, Blinding, ConcreteMember, Opening, Unknown }
    public enum FormworkDecision { Include, Exclude, Review }
    public enum FormworkAccessoryKind { PeFilm, BeadInsulation, PfInsulation }

    public sealed class FormworkFaceRow
    {
        public string FaceId { get; set; }
        public string ElementId { get; set; }
        public string HostElementId { get; set; }
        public string MemberType { get; set; }
        public string Level { get; set; }
        // Geometry extraction records these verbatim.  They are evidence, not a
        // material/contact classifier and therefore cannot turn a REVIEW into PASS.
        public string Category { get; set; }
        public string MaterialEvidence { get; set; }
        public string OrientationEvidence { get; set; }
        public string ReviewReason { get; set; }
        // The exported geometry and the user's later construction decision are
        // independent evidence.  A decision CSV must never silently replace the
        // geometry source that produced the face.
        public StructuralSourceEvidence Source { get; set; }
        public StructuralSourceEvidence DecisionSource { get; set; }
        public string GeometryLedgerSha256 { get; set; }
        public FormworkAreaBasis AreaBasis { get; set; }
        public decimal FaceAreaM2 { get; set; }
        public decimal OpeningUnionAreaM2 { get; set; }
        public FormworkBoundaryKind BoundaryKind { get; set; }
        public string BoundaryEvidenceId { get; set; }
        public FormworkDecision Decision { get; set; }
        public StructuralRuleEvidence Policy { get; set; }
    }

    public sealed class FormworkAccessoryRow
    {
        public string AccessoryId { get; set; }
        public FormworkAccessoryKind Kind { get; set; }
        public decimal AreaM2 { get; set; }
        // A source must not call an accessory a pure contact face simply to make a total match.
        public bool IncludedInPureFormwork { get; set; }
        public StructuralRuleEvidence Policy { get; set; }
        public StructuralSourceEvidence Source { get; set; }
        public string AccessoryLedgerId { get; set; }
        public string AccessoryLedgerSha256 { get; set; }
    }

    public sealed class FormworkFinding
    {
        public string Rule { get; set; }
        public StructuralQuantityStatus Status { get; set; }
        public string SubjectId { get; set; }
        public decimal? Expected { get; set; }
        public decimal? Actual { get; set; }
        public string Message { get; set; }
    }

    public sealed class FormworkTakeoffResult
    {
        public decimal PureFormworkM2 { get; internal set; }
        public decimal PeFilmM2 { get; internal set; }
        public decimal BeadInsulationM2 { get; internal set; }
        public decimal PfInsulationM2 { get; internal set; }
        public decimal LegacyPackageM2 { get { return PureFormworkM2 + PeFilmM2 + BeadInsulationM2 + PfInsulationM2; } }
        public StructuralQuantityStatus Status { get; internal set; }
        public IReadOnlyList<FormworkFinding> Findings { get; internal set; }
    }

    public static class FormworkTakeoff
    {
        public static FormworkTakeoffResult Calculate(IEnumerable<FormworkFaceRow> faces,
            IEnumerable<FormworkAccessoryRow> accessories, StructuralEvidenceRegistry registry)
        {
            var findings = new List<FormworkFinding>();
            List<FormworkFaceRow> faceList = (faces ?? Enumerable.Empty<FormworkFaceRow>()).ToList();
            List<FormworkAccessoryRow> accessoryList = (accessories ?? Enumerable.Empty<FormworkAccessoryRow>()).ToList();
            decimal pure = 0m, pe = 0m, bead = 0m, pf = 0m;
            string ledgerHash = faceList.Count == 0 ? null : ComputeLedgerHash(faceList);
            string accessoryLedgerHash = accessoryList.Count == 0 ? null : ComputeAccessoryLedgerHash(accessoryList);

            foreach (FormworkFaceRow face in faceList)
            {
                if (face == null) { findings.Add(Note("FW001", StructuralQuantityStatus.FAIL, "", "face 행이 null입니다.")); continue; }
                string id = face.FaceId ?? "";
                if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(face.ElementId) || string.IsNullOrWhiteSpace(face.BoundaryEvidenceId) ||
                    face.FaceAreaM2 < 0m || face.OpeningUnionAreaM2 < 0m)
                { findings.Add(Note("FW001", StructuralQuantityStatus.FAIL, id, "face_id·element_id·boundary evidence와 비음수 면적이 필요합니다.")); continue; }
                if (!Enum.IsDefined(typeof(FormworkAreaBasis), face.AreaBasis) || !Enum.IsDefined(typeof(FormworkBoundaryKind), face.BoundaryKind) ||
                    !Enum.IsDefined(typeof(FormworkDecision), face.Decision))
                { findings.Add(Note("FW001", StructuralQuantityStatus.FAIL, id, "face 면적기준·경계·판정 값이 정의되지 않았습니다.")); continue; }
                if (face.AreaBasis == FormworkAreaBasis.GenericAreaM2)
                { findings.Add(Note("FW001", StructuralQuantityStatus.NOT_EVALUATED, id, "일반 AreaM2는 face·개구부·접촉 근거가 없어 순수 거푸집으로 계산하지 않습니다.")); continue; }
                if (face.AreaBasis == FormworkAreaBasis.Net && face.OpeningUnionAreaM2 != 0m)
                { findings.Add(Note("FW001", StructuralQuantityStatus.FAIL, id, "net face에는 개구부를 다시 공제할 수 없습니다.")); continue; }
                if (face.AreaBasis == FormworkAreaBasis.Gross && face.OpeningUnionAreaM2 > face.FaceAreaM2)
                { findings.Add(Note("FW001", StructuralQuantityStatus.FAIL, id, "개구부 union 면적이 gross face 면적보다 클 수 없습니다.")); continue; }
                if (face.BoundaryKind == FormworkBoundaryKind.ConcreteMember && face.Decision == FormworkDecision.Include)
                { findings.Add(Note("FW001", StructuralQuantityStatus.FAIL, id, "콘크리트-콘크리트 접촉면은 거푸집에 포함할 수 없습니다.")); continue; }
                if (face.BoundaryKind == FormworkBoundaryKind.Opening && face.Decision == FormworkDecision.Include)
                { findings.Add(Note("FW001", StructuralQuantityStatus.FAIL, id, "개구부 자체를 거푸집 face로 포함할 수 없습니다.")); continue; }
                if (face.BoundaryKind == FormworkBoundaryKind.Unknown || face.Decision == FormworkDecision.Review)
                { findings.Add(Note("FW001", StructuralQuantityStatus.REVIEW, id, "경계 또는 시공 판단이 확정되지 않아 검토가 필요합니다.")); continue; }
                if (face.Source == null || !face.Source.IsSpecified() || registry == null || !registry.Approves(face.Source))
                { findings.Add(Note("FW001", StructuralQuantityStatus.REVIEW, id, "face 원장/RVT source SHA가 승인 registry와 일치하지 않습니다.")); continue; }
                if (face.DecisionSource == null || !face.DecisionSource.IsSpecified() || !registry.Approves(face.DecisionSource))
                { findings.Add(Note("FW001", StructuralQuantityStatus.REVIEW, id, "경계·시공 판정 승인 CSV source SHA가 승인 registry와 일치하지 않습니다.")); continue; }
                if (!StructuralRuleEvidence.ValidSha(face.GeometryLedgerSha256) || !string.Equals(face.GeometryLedgerSha256, ledgerHash, StringComparison.OrdinalIgnoreCase) ||
                    !registry.ApprovesDocument("formwork-face-ledger", face.GeometryLedgerSha256))
                { findings.Add(Note("FW001", StructuralQuantityStatus.REVIEW, id, "canonical geometry-ledger SHA가 현재 기록과 일치하고 독립 registry에 승인되어야 합니다.")); continue; }
                if (!Approved(face.Policy, registry))
                { findings.Add(Note("FW001", StructuralQuantityStatus.REVIEW, id, "승인된 policy rule ID·SHA-256·source가 없습니다.")); continue; }
                decimal net = face.AreaBasis == FormworkAreaBasis.Gross ? face.FaceAreaM2 - face.OpeningUnionAreaM2 : face.FaceAreaM2;
                if (face.Decision == FormworkDecision.Include)
                {
                    try { pure = checked(pure + net); }
                    catch (OverflowException) { findings.Add(Note("FW001", StructuralQuantityStatus.FAIL, id, "순수 거푸집 합계가 decimal 범위를 벗어났습니다.")); continue; }
                }
                findings.Add(Note("FW001", StructuralQuantityStatus.PASS, id, face.Decision == FormworkDecision.Include ? "승인된 face 면적을 순수 거푸집에 반영했습니다." : "승인된 face 제외 결정을 반영했습니다.", net, face.Decision == FormworkDecision.Include ? net : 0m));
            }

            foreach (var duplicate in faceList.Where(x => x != null && !string.IsNullOrWhiteSpace(x.FaceId)).GroupBy(x => x.FaceId, StringComparer.Ordinal).Where(x => x.Count() > 1))
                findings.Add(Note("FW002", StructuralQuantityStatus.FAIL, duplicate.Key, "같은 face_id가 중복되어 면적을 두 번 산입할 수 없습니다."));
            foreach (var duplicate in faceList.Where(x => x != null && !string.IsNullOrWhiteSpace(x.ElementId) && !string.IsNullOrWhiteSpace(x.BoundaryEvidenceId))
                .GroupBy(x => x.ElementId + "\u001f" + x.BoundaryEvidenceId, StringComparer.Ordinal).Where(x => x.Count() > 1))
                findings.Add(Note("FW002", StructuralQuantityStatus.FAIL, duplicate.Key, "같은 element/boundary evidence가 중복되었습니다."));
            foreach (var duplicate in accessoryList.Where(x => x != null && !string.IsNullOrWhiteSpace(x.AccessoryId))
                .GroupBy(x => x.AccessoryId, StringComparer.Ordinal).Where(x => x.Count() > 1))
                findings.Add(Note("FW003", StructuralQuantityStatus.FAIL, duplicate.Key, "같은 부대재료 ID가 중복되었습니다."));

            foreach (FormworkAccessoryRow accessory in accessoryList)
            {
                if (accessory == null || string.IsNullOrWhiteSpace(accessory.AccessoryId) || accessory.AreaM2 < 0m)
                { findings.Add(Note("FW003", StructuralQuantityStatus.FAIL, accessory == null ? "" : accessory.AccessoryId, "부대재료 ID와 비음수 면적이 필요합니다.")); continue; }
                if (!Enum.IsDefined(typeof(FormworkAccessoryKind), accessory.Kind))
                { findings.Add(Note("FW003", StructuralQuantityStatus.FAIL, accessory.AccessoryId, "정의되지 않은 부대재료 종류입니다.")); continue; }
                if (accessory.IncludedInPureFormwork)
                { findings.Add(Note("FW003", StructuralQuantityStatus.FAIL, accessory.AccessoryId, "PE·단열재를 순수 거푸집에 합칠 수 없습니다.")); continue; }
                if (!Approved(accessory.Policy, registry))
                { findings.Add(Note("FW003", StructuralQuantityStatus.REVIEW, accessory.AccessoryId, "부대재료의 승인 policy rule ID·SHA-256·source가 없습니다.")); continue; }
                if (accessory.Source == null || !accessory.Source.IsSpecified() || !registry.Approves(accessory.Source) ||
                    string.IsNullOrWhiteSpace(accessory.AccessoryLedgerId) || !string.Equals(accessory.AccessoryLedgerSha256, accessoryLedgerHash, StringComparison.OrdinalIgnoreCase) ||
                    !registry.ApprovesDocument(accessory.AccessoryLedgerId, accessory.AccessoryLedgerSha256))
                { findings.Add(Note("FW003", StructuralQuantityStatus.REVIEW, accessory.AccessoryId, "부대재료 면적은 승인 source와 독립 ledger SHA가 필요합니다.")); continue; }
                try
                {
                    if (accessory.Kind == FormworkAccessoryKind.PeFilm) pe = checked(pe + accessory.AreaM2);
                    else if (accessory.Kind == FormworkAccessoryKind.BeadInsulation) bead = checked(bead + accessory.AreaM2);
                    else pf = checked(pf + accessory.AreaM2);
                }
                catch (OverflowException) { findings.Add(Note("FW003", StructuralQuantityStatus.FAIL, accessory.AccessoryId, "부대재료 합계가 decimal 범위를 벗어났습니다.")); continue; }
                findings.Add(Note("FW003", StructuralQuantityStatus.PASS, accessory.AccessoryId, "부대재료를 순수 거푸집과 분리했습니다."));
            }

            StructuralQuantityStatus status = findings.Count == 0 ? StructuralQuantityStatus.NOT_EVALUATED :
                findings.Any(x => x.Status == StructuralQuantityStatus.FAIL) ? StructuralQuantityStatus.FAIL :
                findings.Any(x => x.Status == StructuralQuantityStatus.REVIEW || x.Status == StructuralQuantityStatus.NOT_EVALUATED) ? StructuralQuantityStatus.REVIEW : StructuralQuantityStatus.PASS;
            return new FormworkTakeoffResult { PureFormworkM2 = pure, PeFilmM2 = pe, BeadInsulationM2 = bead, PfInsulationM2 = pf, Status = status, Findings = findings.AsReadOnly() };
        }

        public static void RequireReview(FormworkTakeoffResult result, string reason)
        {
            if (result == null) throw new ArgumentNullException("result");
            var findings = (result.Findings ?? Array.Empty<FormworkFinding>()).ToList();
            findings.Add(Note("FW004", StructuralQuantityStatus.REVIEW, "approval-trust", reason));
            result.Findings = findings.AsReadOnly();
            if (result.Status != StructuralQuantityStatus.FAIL) result.Status = StructuralQuantityStatus.REVIEW;
        }

        public static string ComputeLedgerHash(IEnumerable<FormworkFaceRow> faces)
        {
            if (faces == null) throw new ArgumentNullException("faces");
            // Only immutable extracted geometry belongs here. Boundary/contact and
            // construction decisions are a separately hashed approval document.
            List<string> fields = faces.Select(face => face == null ? "<null>" : string.Join("\u001f", new[] {
                face.FaceId ?? "", face.ElementId ?? "", face.HostElementId ?? "", face.Category ?? "", face.MaterialEvidence ?? "", face.OrientationEvidence ?? "",
                face.FaceAreaM2.ToString(System.Globalization.CultureInfo.InvariantCulture) })).OrderBy(x => x, StringComparer.Ordinal).ToList();
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(string.Join("\n", fields)))).Replace("-", "");
        }

        public static string ComputeAccessoryLedgerHash(IEnumerable<FormworkAccessoryRow> accessories)
        {
            if (accessories == null) throw new ArgumentNullException("accessories");
            List<string> fields = accessories.Select(item => item == null ? "<null>" : string.Join("\u001f", new[] {
                item.AccessoryId ?? "", item.Kind.ToString(), item.AreaM2.ToString(System.Globalization.CultureInfo.InvariantCulture),
                item.IncludedInPureFormwork ? "1" : "0", item.Source == null ? "" : item.Source.Key()
            })).OrderBy(value => value, StringComparer.Ordinal).ToList();
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(string.Join("\n", fields)))).Replace("-", "");
        }

        private static bool Approved(StructuralRuleEvidence policy, StructuralEvidenceRegistry registry)
        {
            return policy != null && policy.IsSpecified() && registry != null && registry.Approves(policy);
        }

        private static FormworkFinding Note(string rule, StructuralQuantityStatus status, string subject, string message, decimal? expected = null, decimal? actual = null)
        {
            return new FormworkFinding { Rule = rule, Status = status, SubjectId = subject, Expected = expected, Actual = actual, Message = message };
        }
    }
}
