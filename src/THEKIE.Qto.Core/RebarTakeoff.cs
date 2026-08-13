using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace THEKIE.Qto.Core
{
    [Flags]
    public enum RebarLengthComponent
    {
        None = 0,
        Anchorage = 1,
        Lap = 2,
        Hook = 4,
        Bend = 8,
        Chair = 16
    }

    public enum RebarRoundingStage { Row, Specification, Total }

    public sealed class RebarLengthRow
    {
        public string RowId { get; set; }
        public string Spec { get; set; }
        public decimal SignedLengthM { get; set; }
        public StructuralSourceEvidence Source { get; set; }
        public RebarLengthComponent IncludedComponents { get; set; }
    }

    public sealed class RebarAdditionalLengthRule
    {
        public string RuleId { get; set; }
        public RebarLengthComponent Component { get; set; }
        public decimal SignedLengthM { get; set; }
        public StructuralSourceEvidence Source { get; set; }
    }

    public sealed class RebarSpecificationRule
    {
        public string Spec { get; set; }
        public decimal UnitMassKgPerM { get; set; }
        public StructuralSourceEvidence UnitMassSource { get; set; }
        public decimal LossRate { get; set; }
        public StructuralSourceEvidence LossSource { get; set; }
        public RebarRoundingStage RoundingStage { get; set; }
        public StructuralRoundingMode RoundingMode { get; set; }
        public int RoundingScale { get; set; }
        public StructuralSourceEvidence RoundingSource { get; set; }
        public List<RebarAdditionalLengthRule> AdditionalLengths { get; } = new List<RebarAdditionalLengthRule>();
    }

    public sealed class RebarRuleBundle
    {
        public string BundleId { get; set; }
        public string Version { get; set; }
        public StructuralRuleEvidence Evidence { get; set; }
        public decimal ApprovedToleranceKg { get; set; }
        public StructuralSourceEvidence ToleranceSource { get; set; }
        public List<RebarSpecificationRule> Specifications { get; } = new List<RebarSpecificationRule>();
    }

    public sealed class RebarOfficialTarget
    {
        public decimal MassKg { get; set; }
        public StructuralSourceEvidence Source { get; set; }
    }

    public sealed class RebarTakeoffSpecificationResult
    {
        public string Spec { get; internal set; }
        public decimal RawLengthM { get; internal set; }
        public decimal AdditionalLengthM { get; internal set; }
        public decimal MassBeforeLossKg { get; internal set; }
        public decimal LossKg { get; internal set; }
        public decimal FinalMassKg { get; internal set; }
        public string Formula { get; internal set; }
        public string Evidence { get; internal set; }
    }

    public sealed class RebarTakeoffResult
    {
        private readonly List<RebarTakeoffSpecificationResult> specifications = new List<RebarTakeoffSpecificationResult>();
        public StructuralQuantityStatus Status { get; internal set; }
        public decimal? CalculatedMassKg { get; internal set; }
        public decimal? OfficialMassKg { get; internal set; }
        public decimal? DeltaKg { get; internal set; }
        public string Message { get; internal set; }
        public IReadOnlyList<RebarTakeoffSpecificationResult> Specifications { get { return specifications.AsReadOnly(); } }
        internal List<RebarTakeoffSpecificationResult> MutableSpecifications { get { return specifications; } }
    }

    public static class RebarTakeoff
    {
        public static RebarTakeoffResult Evaluate(IEnumerable<RebarLengthRow> inputRows, RebarRuleBundle bundle,
            RebarOfficialTarget official, decimal tolerance, StructuralEvidenceRegistry registry)
        {
            var result = new RebarTakeoffResult();
            if (inputRows == null || tolerance < 0m) return Fail(result, "철근 행과 0 이상의 허용오차가 필요합니다.");
            List<RebarLengthRow> rows = inputRows.ToList();
            if (rows.Count == 0) return Note(result, StructuralQuantityStatus.NOT_EVALUATED, "선택된 철근 길이 행이 없습니다.");
            if (rows.Any(row => row == null || string.IsNullOrWhiteSpace(row.RowId) || string.IsNullOrWhiteSpace(row.Spec) ||
                row.Source == null || !row.Source.IsSpecified())) return Fail(result, "모든 철근 행에는 ID·규격·원본 SHA/시트/셀이 필요합니다.");
            if (rows.Any(row => ((int)row.IncludedComponents & ~((int)RebarLengthComponent.Anchorage | (int)RebarLengthComponent.Lap | (int)RebarLengthComponent.Hook | (int)RebarLengthComponent.Bend | (int)RebarLengthComponent.Chair)) != 0))
                return Fail(result, "원시 철근 행에 지원하지 않는 길이 구성요소 flag가 있습니다.");
            if (rows.GroupBy(row => row.RowId, StringComparer.Ordinal).Any(group => group.Count() != 1) ||
                rows.GroupBy(row => row.Source.Key(), StringComparer.Ordinal).Any(group => group.Count() != 1))
                return Fail(result, "철근 행 ID 또는 원본 셀이 중복됩니다.");
            if (bundle == null || string.IsNullOrWhiteSpace(bundle.BundleId) || string.IsNullOrWhiteSpace(bundle.Version) ||
                bundle.Evidence == null || !bundle.Evidence.IsSpecified())
                return Note(result, StructuralQuantityStatus.REVIEW, "규격별 철근 환산 bundle ID·version·SHA·원본 참조가 필요합니다.");
            if (!string.Equals(bundle.Evidence.Sha256, ComputeRuleHash(bundle), StringComparison.OrdinalIgnoreCase))
                return Note(result, StructuralQuantityStatus.REVIEW, "철근 환산 bundle의 canonical 내용과 승인 SHA-256이 일치하지 않습니다.");
            if (bundle.ApprovedToleranceKg < 0m || tolerance != bundle.ApprovedToleranceKg ||
                (tolerance > 0m && !Specified(bundle.ToleranceSource)))
                return Note(result, StructuralQuantityStatus.REVIEW, "철근 허용오차는 bundle에 같은 값과 독립 원본 근거로 승인되어야 합니다.");
            if (bundle.Specifications.GroupBy(rule => rule == null ? "" : rule.Spec ?? "", StringComparer.OrdinalIgnoreCase).Any(group => group.Count() != 1))
                return Fail(result, "규격별 철근 환산 규칙은 하나씩만 있어야 합니다.");

            Dictionary<string, RebarSpecificationRule> rules = bundle.Specifications.Where(rule => rule != null && !string.IsNullOrWhiteSpace(rule.Spec))
                .ToDictionary(rule => rule.Spec, StringComparer.OrdinalIgnoreCase);
            string unsupported = rows.Select(row => row.Spec).Where(spec => !rules.ContainsKey(spec)).Distinct(StringComparer.OrdinalIgnoreCase).FirstOrDefault();
            if (unsupported != null) return Fail(result, "선택된 철근 규격의 승인 환산 규칙이 없습니다: " + unsupported);
            foreach (RebarSpecificationRule rule in rules.Values)
            {
                if (rule.UnitMassKgPerM <= 0m || rule.LossRate < 0m || rule.RoundingScale < 0 || rule.RoundingScale > 6 ||
                    !ValidStage(rule.RoundingStage) || !ValidMode(rule.RoundingMode) || !Specified(rule.UnitMassSource) ||
                    !Specified(rule.LossSource) || !Specified(rule.RoundingSource))
                    return Note(result, StructuralQuantityStatus.REVIEW, "규격 " + rule.Spec + "의 단위중량·손율·반올림 단계/방식/자릿수와 원본 근거가 필요합니다.");
                if (rule.RoundingMode == StructuralRoundingMode.None && rule.RoundingScale != 0)
                    return Note(result, StructuralQuantityStatus.REVIEW, "반올림 없음 모드에는 자릿수를 지정할 수 없습니다.");
                if (rule.AdditionalLengths.Any(additional => additional == null || string.IsNullOrWhiteSpace(additional.RuleId) ||
                    additional.Component == RebarLengthComponent.None || !SingleComponent(additional.Component) || !Specified(additional.Source)))
                    return Note(result, StructuralQuantityStatus.REVIEW, "규격 " + rule.Spec + "의 추가길이 규칙 근거가 불완전합니다.");
                if (rule.AdditionalLengths.GroupBy(additional => additional.RuleId, StringComparer.Ordinal).Any(group => group.Count() != 1))
                    return Fail(result, "규격 " + rule.Spec + "의 추가길이 rule ID가 중복됩니다.");
            }

            foreach (IGrouping<string, RebarLengthRow> group in rows.GroupBy(row => row.Spec, StringComparer.OrdinalIgnoreCase))
            {
                RebarSpecificationRule rule = rules[group.Key];
                RebarLengthComponent existing = group.Aggregate(RebarLengthComponent.None, (value, row) => value | row.IncludedComponents);
                RebarLengthComponent added = rule.AdditionalLengths.Aggregate(RebarLengthComponent.None, (value, item) => value | item.Component);
                if ((existing & added) != RebarLengthComponent.None)
                    return Note(result, StructuralQuantityStatus.REVIEW, "규격 " + group.Key + " 원시 산식에 포함된 정착·이음·갈고리·벤드·chair를 추가길이로 다시 적용할 수 없습니다.");

                decimal rawLength = group.Sum(row => row.SignedLengthM);
                decimal additionalLength = rule.AdditionalLengths.Sum(item => item.SignedLengthM);
                decimal massBeforeLoss;
                decimal final;
                try
                {
                    if (rule.RoundingStage == RebarRoundingStage.Row)
                    {
                        massBeforeLoss = group.Sum(row => Round(row.SignedLengthM * rule.UnitMassKgPerM, rule.RoundingMode, rule.RoundingScale)) +
                            rule.AdditionalLengths.Sum(item => Round(item.SignedLengthM * rule.UnitMassKgPerM, rule.RoundingMode, rule.RoundingScale));
                        final = Round(massBeforeLoss * (1m + rule.LossRate), rule.RoundingMode, rule.RoundingScale);
                    }
                    else
                    {
                        massBeforeLoss = (rawLength + additionalLength) * rule.UnitMassKgPerM;
                        decimal afterLoss = massBeforeLoss * (1m + rule.LossRate);
                        final = rule.RoundingStage == RebarRoundingStage.Specification ? Round(afterLoss, rule.RoundingMode, rule.RoundingScale) : afterLoss;
                    }
                }
                catch (OverflowException) { return Note(result, StructuralQuantityStatus.REVIEW, "규격 " + group.Key + " 철근 환산이 decimal 범위를 벗어났습니다."); }
                result.MutableSpecifications.Add(new RebarTakeoffSpecificationResult {
                    Spec = group.Key, RawLengthM = rawLength, AdditionalLengthM = additionalLength, MassBeforeLossKg = massBeforeLoss,
                    LossKg = final - massBeforeLoss, FinalMassKg = final,
                    Formula = "(" + rawLength + "+" + additionalLength + ")*" + rule.UnitMassKgPerM + "*(1+" + rule.LossRate + ") @ " + rule.RoundingStage,
                    Evidence = bundle.Evidence + ";unit-mass=" + rule.UnitMassSource + ";loss=" + rule.LossSource + ";rounding=" + rule.RoundingSource
                });
            }

            try {
                bool totalRound = rules.Values.Any(rule => rule.RoundingStage == RebarRoundingStage.Total);
                if (totalRound && rules.Values.Any(rule => rule.RoundingStage != RebarRoundingStage.Total))
                    return Note(result, StructuralQuantityStatus.REVIEW, "한 환산 bundle 안에서 total 반올림과 다른 반올림 단계를 혼용할 수 없습니다.");
                if (totalRound && rules.Values.Select(rule => rule.RoundingMode + ":" + rule.RoundingScale.ToString(CultureInfo.InvariantCulture)).Distinct(StringComparer.Ordinal).Count() != 1)
                    return Note(result, StructuralQuantityStatus.REVIEW, "total 반올림은 모든 규격에 같은 방식과 자릿수를 사용해야 합니다.");
                decimal total = result.Specifications.Sum(item => item.FinalMassKg);
                if (totalRound)
                {
                    RebarSpecificationRule rule = rules.Values.First();
                    total = Round(total, rule.RoundingMode, rule.RoundingScale);
                }
                result.CalculatedMassKg = total;
            }
            catch (OverflowException) { return Note(result, StructuralQuantityStatus.REVIEW, "철근 kg 합계가 decimal 범위를 벗어났습니다."); }

            if (official == null) return Note(result, StructuralQuantityStatus.NOT_EVALUATED, "독립 공식 철근 kg target이 없어 계산 결과만 보존했습니다.");
            if (official.MassKg < 0m || !Specified(official.Source)) return Fail(result, "공식 철근 kg target에는 비음수 값과 원본 SHA/시트/셀 근거가 필요합니다.");
            result.OfficialMassKg = official.MassKg;
            if (rows.Any(row => row.Source.Key() == official.Source.Key()) || rules.Values.Any(rule => Same(official.Source, rule.UnitMassSource) || Same(official.Source, rule.LossSource) || Same(official.Source, rule.RoundingSource) || rule.AdditionalLengths.Any(item => Same(official.Source, item.Source))))
                return Note(result, StructuralQuantityStatus.REVIEW, "공식 target이 길이 또는 환산 규칙의 같은 원본 셀을 가리켜 순환 검증입니다.");
            try { result.DeltaKg = result.CalculatedMassKg.Value - official.MassKg; }
            catch (OverflowException) { return Note(result, StructuralQuantityStatus.REVIEW, "철근 환산값과 공식 kg target의 차이가 decimal 범위를 벗어났습니다."); }
            if (result.DeltaKg.Value < -tolerance || result.DeltaKg.Value > tolerance) return Fail(result, "규격별 철근 환산 결과가 공식 kg target과 허용오차를 벗어났습니다.");
            if (!Approved(rows, bundle, rules.Values, official, registry))
                return Note(result, StructuralQuantityStatus.REVIEW, "원시 행·환산 bundle·규격별 근거·공식 target SHA가 승인 registry와 일치하지 않습니다.");
            result.Status = StructuralQuantityStatus.PASS;
            result.Message = "승인된 규격별 길이×단위중량×손율×반올림 결과가 독립 공식 kg target과 일치합니다.";
            return result;
        }

        public static string ComputeRuleHash(RebarRuleBundle bundle)
        {
            if (bundle == null) throw new ArgumentNullException("bundle");
            var fields = new List<string> { bundle.BundleId ?? "", bundle.Version ?? "",
                bundle.Evidence == null ? "" : bundle.Evidence.RuleId ?? "",
                bundle.Evidence == null ? "" : bundle.Evidence.SourceRef ?? "",
                bundle.ApprovedToleranceKg.ToString(CultureInfo.InvariantCulture), SourceKey(bundle.ToleranceSource) };
            foreach (RebarSpecificationRule rule in bundle.Specifications.Where(rule => rule != null).OrderBy(rule => rule.Spec, StringComparer.OrdinalIgnoreCase))
            {
                fields.Add(rule.Spec ?? "");
                fields.Add(rule.UnitMassKgPerM.ToString(CultureInfo.InvariantCulture));
                fields.Add(SourceKey(rule.UnitMassSource));
                fields.Add(rule.LossRate.ToString(CultureInfo.InvariantCulture));
                fields.Add(SourceKey(rule.LossSource));
                fields.Add(rule.RoundingStage.ToString());
                fields.Add(rule.RoundingMode.ToString());
                fields.Add(rule.RoundingScale.ToString(CultureInfo.InvariantCulture));
                fields.Add(SourceKey(rule.RoundingSource));
                foreach (RebarAdditionalLengthRule additional in rule.AdditionalLengths.Where(item => item != null).OrderBy(item => item.RuleId, StringComparer.Ordinal))
                {
                    fields.Add(additional.RuleId ?? "");
                    fields.Add(additional.Component.ToString());
                    fields.Add(additional.SignedLengthM.ToString(CultureInfo.InvariantCulture));
                    fields.Add(SourceKey(additional.Source));
                }
            }
            string canonical = string.Join("", fields.Select(field => field.Length.ToString(CultureInfo.InvariantCulture) + ":" + field));
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(canonical))).Replace("-", "");
        }

        public static void RequireReview(RebarTakeoffResult result, string reason)
        {
            if (result == null) throw new ArgumentNullException("result");
            if (result.Status == StructuralQuantityStatus.PASS) result.Status = StructuralQuantityStatus.REVIEW;
            result.Message = (result.Message ?? "") + "; " + (reason ?? "운영 승인이 필요합니다.");
        }

        private static bool Approved(IEnumerable<RebarLengthRow> rows, RebarRuleBundle bundle, IEnumerable<RebarSpecificationRule> rules, RebarOfficialTarget official, StructuralEvidenceRegistry registry)
        {
            return registry != null && registry.Approves(bundle.Evidence) && registry.Approves(official.Source) &&
                (bundle.ApprovedToleranceKg == 0m || registry.Approves(bundle.ToleranceSource)) && rows.All(row => registry.Approves(row.Source)) &&
                rules.All(rule => registry.Approves(rule.UnitMassSource) && registry.Approves(rule.LossSource) && registry.Approves(rule.RoundingSource) && rule.AdditionalLengths.All(item => registry.Approves(item.Source)));
        }
        private static bool Specified(StructuralSourceEvidence source) { return source != null && source.IsSpecified(); }
        private static string SourceKey(StructuralSourceEvidence source) { return source == null ? "" : source.Key() + "|" + (source.SourceId ?? "") + "|" + (source.Revision ?? ""); }
        private static bool Same(StructuralSourceEvidence a, StructuralSourceEvidence b) { return a != null && b != null && a.Key() == b.Key(); }
        private static bool SingleComponent(RebarLengthComponent value) { return value != RebarLengthComponent.None && ((int)value & ((int)value - 1)) == 0; }
        private static bool ValidStage(RebarRoundingStage value) { return value == RebarRoundingStage.Row || value == RebarRoundingStage.Specification || value == RebarRoundingStage.Total; }
        private static bool ValidMode(StructuralRoundingMode value) { return value == StructuralRoundingMode.None || value == StructuralRoundingMode.Truncate || value == StructuralRoundingMode.HalfUp; }
        private static decimal Round(decimal value, StructuralRoundingMode mode, int scale)
        {
            if (mode == StructuralRoundingMode.None) return value;
            decimal factor = 1m;
            for (int index = 0; index < scale; index++) factor *= 10m;
            if (mode == StructuralRoundingMode.Truncate) return decimal.Truncate(value * factor) / factor;
            return Math.Round(value, scale, MidpointRounding.AwayFromZero);
        }
        private static RebarTakeoffResult Fail(RebarTakeoffResult result, string message) { return Note(result, StructuralQuantityStatus.FAIL, message); }
        private static RebarTakeoffResult Note(RebarTakeoffResult result, StructuralQuantityStatus status, string message) { result.Status = status; result.Message = message; return result; }
    }
}
