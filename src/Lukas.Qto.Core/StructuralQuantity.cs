using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Lukas.Qto.Core
{
    // This is deliberately a small, source-agnostic validator. Importers map ZG, ZJ,
    // BIM, or a future workbook format into this ledger; this class never guesses a map.
    public enum StructuralQuantityBucket
    {
        Unknown,
        ConcreteAggregate,
        ConcreteBedding,
        ConcretePlain,
        ConcreteReinforced,
        PureFormwork,
        FormworkAccessory,
        FormworkPackage,
        RebarLength,
        RebarMass
    }

    public enum StructuralQuantityStatus
    {
        PASS,
        FAIL,
        REVIEW,
        NOT_EVALUATED
    }

    public enum StructuralQuantityOperation
    {
        Unknown,
        Normal,
        Deduction,
        Reinforcement
    }

    public enum RebarMassBasis
    {
        None,
        ApprovedSchedule,
        LengthTimesUnitMass
    }

    public enum StructuralRoundingMode
    {
        None,
        Truncate,
        HalfUp
    }

    public sealed class StructuralRuleEvidence
    {
        public string RuleId { get; set; }
        public string Sha256 { get; set; }
        public string SourceRef { get; set; }

        public bool IsSpecified()
        {
            return !string.IsNullOrWhiteSpace(RuleId) && ValidSha(Sha256) && !string.IsNullOrWhiteSpace(SourceRef);
        }

        public override string ToString()
        {
            return "rule=" + (RuleId ?? "") + ";sha256=" + (Sha256 ?? "") + ";source-ref=" + (SourceRef ?? "");
        }

        internal static bool ValidSha(string value)
        {
            return value != null && value.Length == 64 && value.All(character =>
                character >= '0' && character <= '9' || character >= 'a' && character <= 'f' || character >= 'A' && character <= 'F');
        }
    }

    public sealed class StructuralEvidenceRegistry
    {
        public Dictionary<string, string> ApprovedSourceHashes { get; } = new Dictionary<string, string>(StringComparer.Ordinal);
        public Dictionary<string, string> ApprovedRuleHashes { get; } = new Dictionary<string, string>(StringComparer.Ordinal);
        public Dictionary<string, string> ApprovedDocumentHashes { get; } = new Dictionary<string, string>(StringComparer.Ordinal);

        public bool Approves(StructuralSourceEvidence source)
        {
            string hash;
            return source != null && source.IsSpecified() && ApprovedSourceHashes.TryGetValue(source.SourceId, out hash) &&
                   string.Equals(hash, source.Sha256, StringComparison.OrdinalIgnoreCase);
        }

        public bool Approves(StructuralRuleEvidence rule)
        {
            string hash;
            return rule != null && rule.IsSpecified() && ApprovedRuleHashes.TryGetValue(rule.RuleId, out hash) &&
                   string.Equals(hash, rule.Sha256, StringComparison.OrdinalIgnoreCase);
        }

        public bool ApprovesDocument(string documentId, string sha256)
        {
            string approved;
            return !string.IsNullOrWhiteSpace(documentId) && StructuralRuleEvidence.ValidSha(sha256) &&
                ApprovedDocumentHashes.TryGetValue(documentId, out approved) && string.Equals(approved, sha256, StringComparison.OrdinalIgnoreCase);
        }
    }

    public sealed class StructuralSourceEvidence
    {
        public string SourceId { get; set; }
        public string Sha256 { get; set; }
        public string Revision { get; set; }
        public string Sheet { get; set; }
        public string Cell { get; set; }
        public int? Row { get; set; }

        public bool IsSpecified()
        {
            return !string.IsNullOrWhiteSpace(SourceId) && StructuralRuleEvidence.ValidSha(Sha256) &&
                   !string.IsNullOrWhiteSpace(Revision) && !string.IsNullOrWhiteSpace(Sheet) &&
                   (ValidCell(Cell) || Row.HasValue && Row.Value > 0);
        }

        public string Key()
        {
            return (Sha256 ?? "").ToLowerInvariant() + "|" + (Sheet ?? "").ToUpperInvariant() + "|" +
                   (ValidCell(Cell) ? CanonicalCell(Cell) : "ROW:" + (Row.HasValue ? Row.Value.ToString(CultureInfo.InvariantCulture) : ""));
        }

        public override string ToString()
        {
            return "source=" + (SourceId ?? "") + ";sha256=" + (Sha256 ?? "") + ";revision=" + (Revision ?? "") +
                   ";sheet=" + (Sheet ?? "") + ";cell=" + (Cell ?? "") + ";row=" + (Row.HasValue ? Row.Value.ToString(CultureInfo.InvariantCulture) : "");
        }

        private static bool ValidCell(string value)
        {
            return !string.IsNullOrWhiteSpace(value) && Regex.IsMatch(value, @"^\$?[A-Za-z]{1,3}\$?[1-9][0-9]*(?::\$?[A-Za-z]{1,3}\$?[1-9][0-9]*)?$");
        }

        private static string CanonicalCell(string value)
        {
            string normalized = value.Replace("$", "").ToUpperInvariant();
            string[] endpoints = normalized.Split(':');
            return endpoints.Length == 2 && endpoints[0] == endpoints[1] ? endpoints[0] : normalized;
        }
    }

    // A signed row is intentional: opening deductions and corrections remain traceable
    // instead of being hidden by a later net quantity.
    public sealed class StructuralLedgerRow
    {
        public string LedgerId { get; set; }
        public StructuralQuantityBucket Bucket { get; set; }
        public string Building { get; set; }
        public string Floor { get; set; }
        public string MemberType { get; set; }
        public string MemberMark { get; set; }
        public decimal? InstanceCount { get; set; }
        public StructuralQuantityOperation Operation { get; set; }
        public string Material { get; set; }
        public string Spec { get; set; }
        public decimal SignedQuantity { get; set; }
        public string Unit { get; set; }
        public string ExpressionText { get; set; }
        public string Note { get; set; }
        public string Location { get; set; }
        public StructuralRoundingMode RoundingMode { get; set; }
        public int? RoundingScale { get; set; }
        public StructuralRuleEvidence RoundingRule { get; set; }
        public StructuralSourceEvidence Source { get; set; }
    }

    public sealed class StructuralQuantityAnchor
    {
        public string AnchorId { get; set; }
        public StructuralQuantityBucket Bucket { get; set; }
        public string Unit { get; set; }
        public decimal OfficialQuantity { get; set; }
        public StructuralSourceEvidence Source { get; set; }
        public List<string> ExpectedLedgerIds { get; } = new List<string>();
        // SHA-256 is the canonical digest returned by ComputeLedgerSetRuleHash.
        // This binds an approved completeness rule to the exact anchor/id set.
        public StructuralRuleEvidence LedgerSetRule { get; set; }
        public StructuralRuleEvidence ToleranceRule { get; set; }
    }

    // The selected basis is mandatory. The validator will never infer kg from a detailed
    // length ledger just because the necessary constants happen to look available.
    public sealed class StructuralRebarMassEvidence
    {
        public string RebarId { get; set; }
        public decimal? ReportedMassKg { get; set; }
        public StructuralSourceEvidence ReportedMassSource { get; set; }
        public RebarMassBasis Basis { get; set; }
        public StructuralRuleEvidence BasisRule { get; set; }
        public decimal? ApprovedScheduleMassKg { get; set; }
        public StructuralSourceEvidence ApprovedScheduleSource { get; set; }
        public decimal? LengthM { get; set; }
        public StructuralSourceEvidence LengthSource { get; set; }
        public decimal? UnitMassKgPerM { get; set; }
        public StructuralSourceEvidence UnitMassSource { get; set; }
        public decimal? AllowanceRate { get; set; }
        public StructuralSourceEvidence AllowanceSource { get; set; }
        public StructuralRuleEvidence ToleranceRule { get; set; }
    }

    public sealed class StructuralQuantityFinding
    {
        public string Rule { get; set; }
        public StructuralQuantityStatus Status { get; set; }
        public string SubjectId { get; set; }
        public StructuralQuantityBucket Bucket { get; set; }
        public string Unit { get; set; }
        public decimal? Expected { get; set; }
        public decimal? Actual { get; set; }
        public decimal? Delta { get; set; }
        public decimal? Tolerance { get; set; }
        public string Evidence { get; set; }
        public string Message { get; set; }
    }

    public static class StructuralQuantityValidator
    {
        public static StructuralQuantityFinding ValidateExpression(StructuralLedgerRow row, decimal tolerance, StructuralEvidenceRegistry registry)
        {
            StructuralQuantityFinding finding = ValidateExpression(row, tolerance);
            if (finding.Status != StructuralQuantityStatus.PASS) return finding;
            if (registry == null || !registry.Approves(row.Source) || row.RoundingRule != null && !registry.Approves(row.RoundingRule))
                return Note("SQ001", StructuralQuantityStatus.REVIEW, row.LedgerId, row.Bucket, row.Unit, finding.Expected, row.SignedQuantity, finding.Delta, row.Source, "소스·반올림 규칙 해시가 승인 registry와 일치하지 않아 숫자 판정을 유보했습니다.", tolerance);
            return finding;
        }

        public static StructuralQuantityFinding ValidateExpression(StructuralLedgerRow row, decimal tolerance)
        {
            if (row == null) throw new ArgumentNullException("row");
            EnsureTolerance(tolerance);
            if (string.IsNullOrWhiteSpace(row.LedgerId) || row.Bucket == StructuralQuantityBucket.Unknown ||
                !Enum.IsDefined(typeof(StructuralQuantityBucket), row.Bucket) || !ValidOperation(row.Operation) ||
                !Enum.IsDefined(typeof(StructuralRoundingMode), row.RoundingMode) ||
                string.IsNullOrWhiteSpace(row.Unit) || !HasEvidence(row.Source))
                return Note("SQ001", StructuralQuantityStatus.FAIL, row.LedgerId, row.Bucket, row.Unit, null, row.SignedQuantity, null, row.Source, "ledger ID·bucket·operation·반올림 모드·단위·원본 SHA/시트/셀 근거가 모두 필요합니다.", tolerance);
            if (row.SignedQuantity < 0m && row.Operation != StructuralQuantityOperation.Deduction ||
                row.SignedQuantity > 0m && row.Operation == StructuralQuantityOperation.Deduction)
                return Note("SQ001", StructuralQuantityStatus.FAIL, row.LedgerId, row.Bucket, row.Unit, null, row.SignedQuantity, null, row.Source, "signed 수량의 부호와 operation이 일치해야 합니다.", tolerance);
            if (string.IsNullOrWhiteSpace(row.ExpressionText))
                return Note("SQ001", StructuralQuantityStatus.NOT_EVALUATED, row.LedgerId, row.Bucket, row.Unit, null, row.SignedQuantity, null, row.Source, "산식 문자열이 없어 산출근거 결과를 검산하지 않았습니다.", tolerance);

            decimal expected;
            string reason;
            if (!TryEvaluateExpression(row.ExpressionText, out expected, out reason))
                return Note("SQ001", StructuralQuantityStatus.REVIEW, row.LedgerId, row.Bucket, row.Unit, null, row.SignedQuantity, null, row.Source, "지원하지 않는 산식입니다: " + reason, tolerance);

            if (row.RoundingMode != StructuralRoundingMode.None)
            {
                if (!row.RoundingScale.HasValue || row.RoundingScale.Value < 0 || row.RoundingScale.Value > 6 || row.RoundingRule == null || !row.RoundingRule.IsSpecified())
                    return Note("SQ001", StructuralQuantityStatus.REVIEW, row.LedgerId, row.Bucket, row.Unit, expected, row.SignedQuantity, SafeDelta(row.SignedQuantity, expected), row.Source, "반올림·절사를 적용하려면 0~6 자릿수와 버전·SHA가 고정된 규칙 근거가 필요합니다.", tolerance);
                try { expected = Round(expected, row.RoundingScale.Value, row.RoundingMode); }
                catch (OverflowException) { return Note("SQ001", StructuralQuantityStatus.REVIEW, row.LedgerId, row.Bucket, row.Unit, expected, row.SignedQuantity, null, row.Source, "반올림·절사 계산이 decimal 범위를 벗어났습니다.", tolerance); }
            }
            else if (row.RoundingScale.HasValue || row.RoundingRule != null)
                return Note("SQ001", StructuralQuantityStatus.REVIEW, row.LedgerId, row.Bucket, row.Unit, expected, row.SignedQuantity, SafeDelta(row.SignedQuantity, expected), row.Source, "반올림 자릿수·규칙은 명시적 반올림 모드와 함께 지정해야 합니다.", tolerance);

            decimal delta;
            if (!TrySubtract(row.SignedQuantity, expected, out delta))
                return Note("SQ001", StructuralQuantityStatus.REVIEW, row.LedgerId, row.Bucket, row.Unit, expected, row.SignedQuantity, null, row.Source, "산식 결과와 원시 수량의 차이가 decimal 범위를 벗어났습니다.", tolerance);
            StructuralQuantityStatus status = delta == 0m ? StructuralQuantityStatus.PASS : Within(delta, tolerance) ? StructuralQuantityStatus.REVIEW : StructuralQuantityStatus.FAIL;
            return Note("SQ001", status,
                row.LedgerId, row.Bucket, row.Unit, expected, row.SignedQuantity, delta, row.Source,
                status == StructuralQuantityStatus.REVIEW ? "허용오차 안이지만 차이가 있어 반올림 규칙 승인이 필요합니다." : "산식 결과와 원시 수량을 대조했습니다.", tolerance);
        }

        public static StructuralQuantityFinding ValidateAnchor(IEnumerable<StructuralLedgerRow> ledger, StructuralQuantityAnchor anchor, decimal tolerance)
        {
            if (ledger == null) throw new ArgumentNullException("ledger");
            if (anchor == null) throw new ArgumentNullException("anchor");
            EnsureTolerance(tolerance);
            if (string.IsNullOrWhiteSpace(anchor.AnchorId) || anchor.Bucket == StructuralQuantityBucket.Unknown || string.IsNullOrWhiteSpace(anchor.Unit) || !HasEvidence(anchor.Source) || anchor.OfficialQuantity < 0m)
                return Note("SQ002", StructuralQuantityStatus.FAIL, anchor.AnchorId, anchor.Bucket, anchor.Unit, null, anchor.OfficialQuantity, null, anchor.Source, "공식 앵커 ID·bucket·단위·비음수 값·원본 SHA/시트/셀 근거가 필요합니다.", tolerance);
            if (anchor.Bucket == StructuralQuantityBucket.RebarMass)
                return Note("SQ002", StructuralQuantityStatus.REVIEW, anchor.AnchorId, anchor.Bucket, anchor.Unit, anchor.OfficialQuantity, null, null, anchor.Source, "철근 kg는 ledger 합계로 PASS할 수 없으며 SQ003의 승인 배근중량표 또는 명시적 길이×단위중량×할증 근거가 필요합니다.", tolerance);

            StructuralQuantityBucket[] buckets = ContributingBuckets(anchor.Bucket);
            List<StructuralLedgerRow> all = ledger.Where(x => x != null).ToList();
            if (buckets.Length > 1 && all.Any(x => x.Bucket == anchor.Bucket && string.Equals(x.Unit, anchor.Unit, StringComparison.OrdinalIgnoreCase)))
                return Note("SQ002", StructuralQuantityStatus.FAIL, anchor.AnchorId, anchor.Bucket, anchor.Unit, anchor.OfficialQuantity, null, null, anchor.Source, "복합 bucket에 임의로 만든 parent ledger 행을 넣을 수 없습니다. 명시된 child bucket 합계만 사용합니다.", tolerance);
            List<StructuralLedgerRow> rows = all.Where(x => buckets.Contains(x.Bucket) && string.Equals(x.Unit, anchor.Unit, StringComparison.OrdinalIgnoreCase)).ToList();
            if (rows.Count == 0)
                return Note("SQ002", StructuralQuantityStatus.NOT_EVALUATED, anchor.AnchorId, anchor.Bucket, anchor.Unit, anchor.OfficialQuantity, null, null, anchor.Source, "같은 bucket·단위의 원시 ledger 행이 없습니다.", tolerance);

            if (rows.Any(row => string.IsNullOrWhiteSpace(row.LedgerId) || !HasEvidence(row.Source)))
                return Note("SQ002", StructuralQuantityStatus.FAIL, anchor.AnchorId, anchor.Bucket, anchor.Unit, anchor.OfficialQuantity, null, null, anchor.Source, "합계에 쓰인 모든 ledger 행에 ID와 원본 SHA/시트/셀 근거가 필요합니다.", tolerance);
            string duplicateId = rows.GroupBy(row => row.LedgerId, StringComparer.Ordinal).Where(group => group.Count() > 1).Select(group => group.Key).FirstOrDefault();
            string duplicateSource = rows.GroupBy(row => row.Source.Key(), StringComparer.Ordinal).Where(group => group.Count() > 1).Select(group => group.Key).FirstOrDefault();
            if (duplicateId != null || duplicateSource != null)
                return Note("SQ002", StructuralQuantityStatus.FAIL, anchor.AnchorId, anchor.Bucket, anchor.Unit, anchor.OfficialQuantity, null, null, anchor.Source, "ledger ID 또는 원본 셀이 중복됩니다: " + (duplicateId ?? duplicateSource), tolerance);
            if (anchor.ExpectedLedgerIds.Count == 0)
                return Note("SQ002", StructuralQuantityStatus.REVIEW, anchor.AnchorId, anchor.Bucket, anchor.Unit, anchor.OfficialQuantity, null, null, anchor.Source, "누락 검사에 필요한 승인 expected ledger ID 집합이 없습니다.", tolerance);
            var expectedIds = new HashSet<string>(anchor.ExpectedLedgerIds.Where(id => !string.IsNullOrWhiteSpace(id)), StringComparer.Ordinal);
            var actualIds = new HashSet<string>(rows.Select(row => row.LedgerId), StringComparer.Ordinal);
            if (expectedIds.Count != anchor.ExpectedLedgerIds.Count || !expectedIds.SetEquals(actualIds))
                return Note("SQ002", StructuralQuantityStatus.FAIL, anchor.AnchorId, anchor.Bucket, anchor.Unit, anchor.OfficialQuantity, null, null, anchor.Source, "승인 ledger ID 집합과 실제 child 행이 다릅니다. missing=" + string.Join("|", expectedIds.Except(actualIds)) + ";extra=" + string.Join("|", actualIds.Except(expectedIds)), tolerance);

            decimal actual;
            try { actual = rows.Sum(x => x.SignedQuantity); }
            catch (OverflowException) { return Note("SQ002", StructuralQuantityStatus.REVIEW, anchor.AnchorId, anchor.Bucket, anchor.Unit, anchor.OfficialQuantity, null, null, anchor.Source, "ledger 합계가 decimal 범위를 벗어났습니다.", tolerance); }
            decimal delta;
            if (!TrySubtract(actual, anchor.OfficialQuantity, out delta))
                return Note("SQ002", StructuralQuantityStatus.REVIEW, anchor.AnchorId, anchor.Bucket, anchor.Unit, anchor.OfficialQuantity, actual, null, anchor.Source, "ledger 합계와 공식 앵커의 차이가 decimal 범위를 벗어났습니다.", tolerance);
            if (!Within(delta, tolerance))
                return Note("SQ002", StructuralQuantityStatus.FAIL, anchor.AnchorId, anchor.Bucket, anchor.Unit, anchor.OfficialQuantity, actual, delta, anchor.Source, "signed ledger 합계가 공식 앵커 허용범위를 벗어났습니다.", tolerance);

            List<StructuralQuantityFinding> childFindings = rows.Select(row => ValidateExpression(row, tolerance)).ToList();
            if (childFindings.Any(finding => finding.Status == StructuralQuantityStatus.FAIL))
                return Note("SQ002", StructuralQuantityStatus.FAIL, anchor.AnchorId, anchor.Bucket, anchor.Unit, anchor.OfficialQuantity, actual, delta, anchor.Source, "공식 앵커에 포함된 child ledger 산식 또는 operation이 실패했습니다.", tolerance);
            if (childFindings.Any(finding => finding.Status != StructuralQuantityStatus.PASS))
                return Note("SQ002", StructuralQuantityStatus.REVIEW, anchor.AnchorId, anchor.Bucket, anchor.Unit, anchor.OfficialQuantity, actual, delta, anchor.Source, "공식 앵커에 포함된 child ledger 산식이 모두 PASS하지 않아 합계 판정을 유보했습니다.", tolerance);
            if (delta != 0m && tolerance > 0m && (anchor.ToleranceRule == null || !anchor.ToleranceRule.IsSpecified()))
                return Note("SQ002", StructuralQuantityStatus.REVIEW, anchor.AnchorId, anchor.Bucket, anchor.Unit, anchor.OfficialQuantity, actual, delta, anchor.Source, "0보다 큰 허용오차를 적용하려면 bucket·단위별 승인 규칙 ID·SHA가 필요합니다.", tolerance);
            string rowsEvidence = "ledger=" + string.Join("|", rows.Select(x => x.LedgerId ?? ""));
            return Note("SQ002", StructuralQuantityStatus.PASS,
                anchor.AnchorId, anchor.Bucket, anchor.Unit, anchor.OfficialQuantity, actual, delta, anchor.Source,
                "signed ledger 합계와 공식 앵커를 대조했습니다; " + rowsEvidence, tolerance);
        }

        public static StructuralQuantityFinding ValidateAnchor(IEnumerable<StructuralLedgerRow> ledger, StructuralQuantityAnchor anchor, decimal tolerance, StructuralEvidenceRegistry registry)
        {
            StructuralQuantityFinding finding = ValidateAnchor(ledger, anchor, tolerance);
            if (finding.Status != StructuralQuantityStatus.PASS) return finding;
            var rows = ledger.Where(row => row != null && ContributingBuckets(anchor.Bucket).Contains(row.Bucket) && string.Equals(row.Unit, anchor.Unit, StringComparison.OrdinalIgnoreCase)).ToList();
            if (rows.Any(row => ValidateExpression(row, tolerance, registry).Status != StructuralQuantityStatus.PASS))
                return Note("SQ002", StructuralQuantityStatus.REVIEW, anchor.AnchorId, anchor.Bucket, anchor.Unit, finding.Expected, finding.Actual, finding.Delta, anchor.Source, "child ledger 소스·반올림 규칙이 승인 registry를 모두 통과하지 못해 합계 판정을 유보했습니다.", tolerance);
            string expectedLedgerSetHash = ComputeLedgerSetRuleHash(anchor);
            bool ledgerSetApproved = anchor.LedgerSetRule != null && registry != null && registry.Approves(anchor.LedgerSetRule) &&
                string.Equals(anchor.LedgerSetRule.Sha256, expectedLedgerSetHash, StringComparison.OrdinalIgnoreCase);
            if (registry == null || !registry.Approves(anchor.Source) || rows.Any(row => !registry.Approves(row.Source)) ||
                !ledgerSetApproved || tolerance > 0m && !registry.Approves(anchor.ToleranceRule))
                return Note("SQ002", StructuralQuantityStatus.REVIEW, anchor.AnchorId, anchor.Bucket, anchor.Unit, finding.Expected, finding.Actual, finding.Delta, anchor.Source, "anchor·ledger·승인 ID 집합·허용오차 근거 해시가 승인 registry와 일치하지 않아 숫자 판정을 유보했습니다.", tolerance);
            return finding;
        }

        public static StructuralQuantityFinding ValidateRebarMass(StructuralRebarMassEvidence evidence, decimal tolerance)
        {
            if (evidence == null) throw new ArgumentNullException("evidence");
            EnsureTolerance(tolerance);
            if (!evidence.ReportedMassKg.HasValue)
                return Note("SQ003", StructuralQuantityStatus.NOT_EVALUATED, evidence.RebarId, StructuralQuantityBucket.RebarMass, "kg", null, null, null, evidence.ReportedMassSource, "대조할 보고 철근중량이 없습니다.", tolerance);
            if (string.IsNullOrWhiteSpace(evidence.RebarId) || !HasEvidence(evidence.ReportedMassSource) || evidence.ReportedMassKg.Value < 0m)
                return Note("SQ003", StructuralQuantityStatus.FAIL, evidence.RebarId, StructuralQuantityBucket.RebarMass, "kg", null, evidence.ReportedMassKg, null, evidence.ReportedMassSource, "보고 철근중량에는 ID·비음수 kg·원본 SHA/시트/셀 근거가 필요합니다.", tolerance);
            if (evidence.Basis == RebarMassBasis.None)
                return Note("SQ003", StructuralQuantityStatus.REVIEW, evidence.RebarId, StructuralQuantityBucket.RebarMass, "kg", null, evidence.ReportedMassKg, null, evidence.ReportedMassSource, "승인 배근중량표 또는 명시적 길이×단위중량×할증률 basis를 선택해야 합니다. 자동 추정은 하지 않았습니다.", tolerance);
            if (evidence.BasisRule == null || !evidence.BasisRule.IsSpecified())
                return Note("SQ003", StructuralQuantityStatus.REVIEW, evidence.RebarId, StructuralQuantityBucket.RebarMass, "kg", null, evidence.ReportedMassKg, null, evidence.ReportedMassSource, "선택한 철근 중량 basis의 승인 규칙 ID·SHA-256·원본 참조가 필요합니다.", tolerance);

            decimal expected;
            string source;
            if (evidence.Basis == RebarMassBasis.ApprovedSchedule)
            {
                if (!evidence.ApprovedScheduleMassKg.HasValue || !HasEvidence(evidence.ApprovedScheduleSource))
                    return Note("SQ003", StructuralQuantityStatus.REVIEW, evidence.RebarId, StructuralQuantityBucket.RebarMass, "kg", null, evidence.ReportedMassKg, null, evidence.ApprovedScheduleSource, "승인 배근중량표 값과 원본 셀 근거가 모두 필요합니다.", tolerance);
                if (evidence.ApprovedScheduleMassKg.Value < 0m)
                    return Note("SQ003", StructuralQuantityStatus.FAIL, evidence.RebarId, StructuralQuantityBucket.RebarMass, "kg", null, evidence.ReportedMassKg, null, evidence.ApprovedScheduleSource, "승인 배근중량표 kg는 음수일 수 없습니다.", tolerance);
                if (string.Equals(evidence.ApprovedScheduleSource.Key(), evidence.ReportedMassSource.Key(), StringComparison.Ordinal))
                    return Note("SQ003", StructuralQuantityStatus.REVIEW, evidence.RebarId, StructuralQuantityBucket.RebarMass, "kg", evidence.ApprovedScheduleMassKg, evidence.ReportedMassKg, SafeDelta(evidence.ReportedMassKg.Value, evidence.ApprovedScheduleMassKg.Value), evidence.ReportedMassSource, "보고값과 승인 배근중량이 같은 원본 셀을 가리켜 순환 자기검증입니다.", tolerance);
                expected = evidence.ApprovedScheduleMassKg.Value;
                source = evidence.ApprovedScheduleSource.ToString();
            }
            else if (evidence.Basis == RebarMassBasis.LengthTimesUnitMass)
            {
                if (!evidence.LengthM.HasValue || !evidence.UnitMassKgPerM.HasValue || !evidence.AllowanceRate.HasValue ||
                    !HasEvidence(evidence.LengthSource) || !HasEvidence(evidence.UnitMassSource) || !HasEvidence(evidence.AllowanceSource))
                    return Note("SQ003", StructuralQuantityStatus.REVIEW, evidence.RebarId, StructuralQuantityBucket.RebarMass, "kg", null, evidence.ReportedMassKg, null, evidence.ReportedMassSource, "명시적 길이·단위중량·할증률과 각 원본 근거가 모두 필요합니다.", tolerance);
                if (evidence.LengthM.Value < 0m || evidence.UnitMassKgPerM.Value <= 0m || evidence.AllowanceRate.Value < 0m)
                    return Note("SQ003", StructuralQuantityStatus.FAIL, evidence.RebarId, StructuralQuantityBucket.RebarMass, "kg", null, evidence.ReportedMassKg, null, evidence.ReportedMassSource, "길이·단위중량·할증률은 각각 0 이상·0 초과·0 이상이어야 합니다.", tolerance);
                var basisSourceKeys = new[] { evidence.ReportedMassSource, evidence.LengthSource, evidence.UnitMassSource, evidence.AllowanceSource }
                    .Select(item => item.Key()).ToList();
                if (basisSourceKeys.Distinct(StringComparer.Ordinal).Count() != basisSourceKeys.Count)
                    return Note("SQ003", StructuralQuantityStatus.REVIEW, evidence.RebarId, StructuralQuantityBucket.RebarMass, "kg", null, evidence.ReportedMassKg, null, evidence.ReportedMassSource, "보고값·길이·단위중량·할증률은 서로 다른 원본 셀 근거여야 하며 순환 자기검증을 허용하지 않습니다.", tolerance);
                try { expected = evidence.LengthM.Value * evidence.UnitMassKgPerM.Value * (1m + evidence.AllowanceRate.Value); }
                catch (OverflowException) { return Note("SQ003", StructuralQuantityStatus.REVIEW, evidence.RebarId, StructuralQuantityBucket.RebarMass, "kg", null, evidence.ReportedMassKg, null, evidence.ReportedMassSource, "길이×단위중량×할증률 계산이 decimal 범위를 벗어났습니다.", tolerance); }
                source = "length={" + evidence.LengthSource + "};unit-mass={" + evidence.UnitMassSource + "};allowance={" + evidence.AllowanceSource + "}";
            }
            else
            {
                return Note("SQ003", StructuralQuantityStatus.REVIEW, evidence.RebarId, StructuralQuantityBucket.RebarMass, "kg", null, evidence.ReportedMassKg, null, evidence.ReportedMassSource, "지원하지 않는 철근 중량 basis입니다.", tolerance);
            }

            decimal delta;
            if (!TrySubtract(evidence.ReportedMassKg.Value, expected, out delta))
                return Note("SQ003", StructuralQuantityStatus.REVIEW, evidence.RebarId, StructuralQuantityBucket.RebarMass, "kg", expected, evidence.ReportedMassKg, null, evidence.ReportedMassSource, "보고 철근중량과 선택 basis의 차이가 decimal 범위를 벗어났습니다.", tolerance);
            if (!Within(delta, tolerance))
                return Note("SQ003", StructuralQuantityStatus.FAIL, evidence.RebarId, StructuralQuantityBucket.RebarMass, "kg", expected, evidence.ReportedMassKg, delta, evidence.ReportedMassSource, "보고 철근중량이 선택된 basis의 허용범위를 벗어났습니다; " + source + ";" + evidence.BasisRule, tolerance);
            if (delta != 0m && tolerance > 0m && (evidence.ToleranceRule == null || !evidence.ToleranceRule.IsSpecified()))
                return Note("SQ003", StructuralQuantityStatus.REVIEW, evidence.RebarId, StructuralQuantityBucket.RebarMass, "kg", expected, evidence.ReportedMassKg, delta, evidence.ReportedMassSource, "0보다 큰 철근 kg 허용오차는 승인 규칙 ID·SHA가 필요합니다.", tolerance);
            return Note("SQ003", StructuralQuantityStatus.PASS,
                evidence.RebarId, StructuralQuantityBucket.RebarMass, "kg", expected, evidence.ReportedMassKg, delta, evidence.ReportedMassSource,
                "보고 철근중량과 선택된 승인 basis를 대조했습니다; " + source + ";" + evidence.BasisRule, tolerance);
        }

        public static StructuralQuantityFinding ValidateRebarMass(StructuralRebarMassEvidence evidence, decimal tolerance, StructuralEvidenceRegistry registry)
        {
            StructuralQuantityFinding finding = ValidateRebarMass(evidence, tolerance);
            if (finding.Status != StructuralQuantityStatus.PASS) return finding;
            bool approved = registry != null && registry.Approves(evidence.ReportedMassSource) && registry.Approves(evidence.BasisRule) &&
                (evidence.Basis == RebarMassBasis.ApprovedSchedule
                    ? registry.Approves(evidence.ApprovedScheduleSource)
                    : registry.Approves(evidence.LengthSource) && registry.Approves(evidence.UnitMassSource) && registry.Approves(evidence.AllowanceSource)) &&
                (tolerance == 0m || registry.Approves(evidence.ToleranceRule));
            if (!approved)
                return Note("SQ003", StructuralQuantityStatus.REVIEW, evidence.RebarId, StructuralQuantityBucket.RebarMass, "kg", finding.Expected, finding.Actual, finding.Delta, evidence.ReportedMassSource, "보고값·basis·환산근거 해시가 승인 registry와 일치하지 않아 숫자 판정을 유보했습니다.", tolerance);
            return finding;
        }

        public static List<StructuralQuantityFinding> Validate(IEnumerable<StructuralLedgerRow> ledger, IEnumerable<StructuralQuantityAnchor> anchors, IEnumerable<StructuralRebarMassEvidence> rebar, decimal tolerance)
        {
            if (ledger == null || anchors == null || rebar == null) throw new ArgumentNullException();
            EnsureTolerance(tolerance);
            List<StructuralLedgerRow> rows = ledger.ToList();
            List<StructuralQuantityAnchor> anchorList = anchors.ToList();
            List<StructuralRebarMassEvidence> rebarList = rebar.ToList();
            var findings = CollectionInputFindings(rows, anchorList, rebarList, tolerance);
            findings.AddRange(rows.Where(x => x != null).Select(x => ValidateExpression(x, tolerance)));
            findings.AddRange(GlobalLedgerDuplicateFindings(rows, tolerance));
            findings.AddRange(anchorList.Where(x => x != null).Select(x => ValidateAnchor(rows, x, tolerance)));
            findings.AddRange(rebarList.Where(x => x != null).Select(x => ValidateRebarMass(x, tolerance)));
            return findings;
        }

        public static List<StructuralQuantityFinding> Validate(IEnumerable<StructuralLedgerRow> ledger, IEnumerable<StructuralQuantityAnchor> anchors, IEnumerable<StructuralRebarMassEvidence> rebar, decimal tolerance, StructuralEvidenceRegistry registry)
        {
            if (ledger == null || anchors == null || rebar == null) throw new ArgumentNullException();
            EnsureTolerance(tolerance);
            List<StructuralLedgerRow> rows = ledger.ToList();
            List<StructuralQuantityAnchor> anchorList = anchors.ToList();
            List<StructuralRebarMassEvidence> rebarList = rebar.ToList();
            var findings = CollectionInputFindings(rows, anchorList, rebarList, tolerance);
            findings.AddRange(rows.Where(row => row != null).Select(row => ValidateExpression(row, tolerance, registry)));
            findings.AddRange(GlobalLedgerDuplicateFindings(rows, tolerance));
            findings.AddRange(anchorList.Where(anchor => anchor != null).Select(anchor => ValidateAnchor(rows, anchor, tolerance, registry)));
            findings.AddRange(rebarList.Where(item => item != null).Select(item => ValidateRebarMass(item, tolerance, registry)));
            return findings;
        }

        private static List<StructuralQuantityFinding> CollectionInputFindings(List<StructuralLedgerRow> rows,
            List<StructuralQuantityAnchor> anchors, List<StructuralRebarMassEvidence> rebar, decimal tolerance)
        {
            var findings = new List<StructuralQuantityFinding>();
            for (int index = 0; index < rows.Count; index++)
                if (rows[index] == null)
                    findings.Add(Note("SQ001", StructuralQuantityStatus.FAIL, "ledger[" + index + "]", StructuralQuantityBucket.Unknown,
                        null, null, null, null, null, "ledger 컬렉션에 null 항목이 있습니다.", tolerance));
            for (int index = 0; index < anchors.Count; index++)
                if (anchors[index] == null)
                    findings.Add(Note("SQ002", StructuralQuantityStatus.FAIL, "anchor[" + index + "]", StructuralQuantityBucket.Unknown,
                        null, null, null, null, null, "anchor 컬렉션에 null 항목이 있습니다.", tolerance));
            for (int index = 0; index < rebar.Count; index++)
                if (rebar[index] == null)
                    findings.Add(Note("SQ003", StructuralQuantityStatus.FAIL, "rebar[" + index + "]", StructuralQuantityBucket.RebarMass,
                        "kg", null, null, null, null, "철근 중량 근거 컬렉션에 null 항목이 있습니다.", tolerance));
            return findings;
        }

        private static List<StructuralQuantityFinding> GlobalLedgerDuplicateFindings(List<StructuralLedgerRow> rows, decimal tolerance)
        {
            List<StructuralLedgerRow> present = rows.Where(row => row != null).ToList();
            var findings = new List<StructuralQuantityFinding>();
            foreach (var duplicate in present.Where(row => !string.IsNullOrWhiteSpace(row.LedgerId))
                .GroupBy(row => row.LedgerId, StringComparer.Ordinal).Where(group => group.Count() > 1))
            {
                StructuralLedgerRow first = duplicate.First();
                findings.Add(Note("SQ001", StructuralQuantityStatus.FAIL, duplicate.Key, first.Bucket, first.Unit,
                    null, null, null, first.Source, "전체 ledger에서 ledger ID가 중복됩니다: " + duplicate.Key, tolerance));
            }
            foreach (var duplicate in present.Where(row => HasEvidence(row.Source))
                .GroupBy(row => row.Source.Key(), StringComparer.Ordinal).Where(group => group.Count() > 1))
            {
                StructuralLedgerRow first = duplicate.First();
                findings.Add(Note("SQ001", StructuralQuantityStatus.FAIL, first.LedgerId, first.Bucket, first.Unit,
                    null, null, null, first.Source, "전체 ledger에서 원본 셀이 중복됩니다: " + duplicate.Key, tolerance));
            }
            return findings;
        }

        // Supported grammar: decimal literals, unary +/- , + - * / and parentheses.
        // Korean annotations such as 2.7<안목길이> are removed before parsing.
        public static bool TryEvaluateExpression(string expressionText, out decimal value, out string reason)
        {
            value = 0m;
            reason = null;
            if (string.IsNullOrWhiteSpace(expressionText))
            {
                reason = "빈 산식";
                return false;
            }
            string expression;
            if (!TryStripAnnotations(expressionText, out expression, out reason)) return false;
            try
            {
                var parser = new DecimalExpressionParser(expression);
                value = parser.Parse();
                return true;
            }
            catch (FormatException ex)
            {
                reason = ex.Message;
                return false;
            }
            catch (DivideByZeroException)
            {
                reason = "0으로 나눌 수 없습니다.";
                return false;
            }
            catch (OverflowException)
            {
                reason = "decimal 범위를 벗어났습니다.";
                return false;
            }
        }

        public static string ComputeLedgerSetRuleHash(StructuralQuantityAnchor anchor)
        {
            if (anchor == null) throw new ArgumentNullException("anchor");
            var fields = new List<string> {
                anchor.AnchorId ?? "",
                ((int)anchor.Bucket).ToString(CultureInfo.InvariantCulture),
                anchor.Unit ?? "",
                anchor.OfficialQuantity.ToString("0.############################", CultureInfo.InvariantCulture),
                anchor.Source == null ? "" : anchor.Source.SourceId ?? "",
                anchor.Source == null ? "" : (anchor.Source.Sha256 ?? "").ToLowerInvariant(),
                anchor.Source == null ? "" : anchor.Source.Revision ?? "",
                anchor.Source == null ? "" : anchor.Source.Sheet ?? "",
                anchor.Source == null ? "" : anchor.Source.Cell ?? "",
                anchor.Source == null || !anchor.Source.Row.HasValue ? "" : anchor.Source.Row.Value.ToString(CultureInfo.InvariantCulture)
            };
            fields.AddRange(anchor.ExpectedLedgerIds.Where(id => !string.IsNullOrWhiteSpace(id)).OrderBy(id => id, StringComparer.Ordinal));
            string canonical = string.Join("", fields.Select(field => field.Length.ToString(CultureInfo.InvariantCulture) + ":" + field));
            using (var sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(canonical))).Replace("-", "");
        }

        private static bool TryStripAnnotations(string text, out string output, out string reason)
        {
            var characters = new List<char>();
            bool inAnnotation = false;
            foreach (char character in text)
            {
                if (character == '<')
                {
                    if (inAnnotation) { output = null; reason = "중첩된 < 주석"; return false; }
                    if (characters.Count > 0 && !char.IsWhiteSpace(characters[characters.Count - 1])) characters.Add(' ');
                    inAnnotation = true;
                }
                else if (character == '>')
                {
                    if (!inAnnotation) { output = null; reason = "짝 없는 > 주석"; return false; }
                    inAnnotation = false;
                    characters.Add(' ');
                }
                else if (!inAnnotation) characters.Add(character);
            }
            if (inAnnotation) { output = null; reason = "닫히지 않은 < 주석"; return false; }
            output = new string(characters.ToArray());
            reason = null;
            return true;
        }

        private static bool HasEvidence(StructuralSourceEvidence source)
        {
            return source != null && source.IsSpecified();
        }

        private static bool ValidOperation(StructuralQuantityOperation operation)
        {
            return operation == StructuralQuantityOperation.Normal || operation == StructuralQuantityOperation.Deduction ||
                   operation == StructuralQuantityOperation.Reinforcement;
        }

        private static decimal? SafeDelta(decimal actual, decimal expected)
        {
            decimal delta;
            return TrySubtract(actual, expected, out delta) ? (decimal?)delta : null;
        }

        private static bool TrySubtract(decimal actual, decimal expected, out decimal delta)
        {
            try { delta = checked(actual - expected); return true; }
            catch (OverflowException) { delta = 0m; return false; }
        }

        private static bool Within(decimal delta, decimal tolerance)
        {
            return delta >= -tolerance && delta <= tolerance;
        }

        private static StructuralQuantityBucket[] ContributingBuckets(StructuralQuantityBucket bucket)
        {
            if (bucket == StructuralQuantityBucket.ConcreteAggregate)
                return new[] { StructuralQuantityBucket.ConcreteBedding, StructuralQuantityBucket.ConcretePlain, StructuralQuantityBucket.ConcreteReinforced };
            if (bucket == StructuralQuantityBucket.FormworkPackage)
                return new[] { StructuralQuantityBucket.PureFormwork, StructuralQuantityBucket.FormworkAccessory };
            return new[] { bucket };
        }

        private static decimal Round(decimal value, int scale, StructuralRoundingMode mode)
        {
            if (mode == StructuralRoundingMode.HalfUp) return Math.Round(value, scale, MidpointRounding.AwayFromZero);
            decimal factor = 1m;
            for (int index = 0; index < scale; index++) factor *= 10m;
            return decimal.Truncate(value * factor) / factor;
        }

        private static void EnsureTolerance(decimal tolerance)
        {
            if (tolerance < 0) throw new ArgumentOutOfRangeException("tolerance", "허용오차는 음수일 수 없습니다.");
        }

        private static StructuralQuantityFinding Note(string rule, StructuralQuantityStatus status, string subjectId, StructuralQuantityBucket bucket, string unit, decimal? expected, decimal? actual, decimal? delta, StructuralSourceEvidence source, string message, decimal? tolerance = null)
        {
            return new StructuralQuantityFinding
            {
                Rule = rule,
                Status = status,
                SubjectId = subjectId,
                Bucket = bucket,
                Unit = unit,
                Expected = expected,
                Actual = actual,
                Delta = delta,
                Tolerance = tolerance,
                Evidence = source == null ? "" : source.ToString(),
                Message = message
            };
        }

        private sealed class DecimalExpressionParser
        {
            private readonly string text;
            private int position;

            public DecimalExpressionParser(string text) { this.text = text ?? ""; }

            public decimal Parse()
            {
                decimal value = ParseSum();
                SkipWhitespace();
                if (position != text.Length) throw new FormatException("허용되지 않는 문자: " + text[position]);
                return value;
            }

            private decimal ParseSum()
            {
                decimal value = ParseProduct();
                while (true)
                {
                    SkipWhitespace();
                    if (Take('+')) value += ParseProduct();
                    else if (Take('-')) value -= ParseProduct();
                    else return value;
                }
            }

            private decimal ParseProduct()
            {
                decimal value = ParseUnary();
                while (true)
                {
                    SkipWhitespace();
                    if (Take('*')) value *= ParseUnary();
                    else if (Take('/')) value /= ParseUnary();
                    else return value;
                }
            }

            private decimal ParseUnary()
            {
                SkipWhitespace();
                if (Take('+')) return ParseUnary();
                if (Take('-')) return -ParseUnary();
                if (Take('('))
                {
                    decimal value = ParseSum();
                    SkipWhitespace();
                    if (!Take(')')) throw new FormatException("닫는 괄호가 없습니다.");
                    return value;
                }
                return ParseNumber();
            }

            private decimal ParseNumber()
            {
                SkipWhitespace();
                int start = position;
                bool dot = false;
                while (position < text.Length)
                {
                    char character = text[position];
                    if (character >= '0' && character <= '9') position++;
                    else if (character == '.' && !dot) { dot = true; position++; }
                    else break;
                }
                if (start == position) throw new FormatException("숫자가 필요합니다.");
                string token = text.Substring(start, position - start);
                decimal result;
                if (!decimal.TryParse(token, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out result))
                    throw new FormatException("유효하지 않은 소수: " + token);
                return result;
            }

            private void SkipWhitespace()
            {
                while (position < text.Length && char.IsWhiteSpace(text[position])) position++;
            }

            private bool Take(char character)
            {
                if (position < text.Length && text[position] == character) { position++; return true; }
                return false;
            }
        }
    }
}
