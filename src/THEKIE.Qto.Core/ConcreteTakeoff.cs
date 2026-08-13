using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace THEKIE.Qto.Core
{
    public enum ConcreteSourceKind { Unknown, Revit, Zg, Zj }
    public enum ConcreteAllowanceBasis { Unknown, Row, Subtotal }
    public enum ConcreteDeductionTiming { Unknown, BeforeAllowance, AfterAllowance }

    public sealed class ConcreteInputRow
    {
        public string RowId { get; set; }
        public ConcreteSourceKind SourceKind { get; set; }
        public string Building { get; set; }
        public string Floor { get; set; }
        public string Member { get; set; }
        public string Spec { get; set; }
        public decimal SignedQuantityM3 { get; set; }
        public StructuralQuantityOperation Operation { get; set; }
        public List<string> ElementIds { get; } = new List<string>();
        public StructuralSourceEvidence SourceEvidence { get; set; }
    }

    public sealed class ConcreteAllowanceRule
    {
        public string Spec { get; set; }
        public decimal AllowanceRate { get; set; }
        public ConcreteAllowanceBasis ApplicationBasis { get; set; }
        public ConcreteDeductionTiming DeductionTiming { get; set; }
        public StructuralRoundingMode RoundingMode { get; set; }
        public int? RoundingScale { get; set; }
    }

    public sealed class ConcreteRuleBundle
    {
        public string BundleId { get; set; }
        public string Version { get; set; }
        public string Sha256 { get; set; }
        public string SourceRef { get; set; }
        public List<ConcreteAllowanceRule> Rules { get; } = new List<ConcreteAllowanceRule>();
    }

    public sealed class ConcreteRuleRegistry
    {
        public Dictionary<string, string> ApprovedHashes { get; } = new Dictionary<string, string>(StringComparer.Ordinal);
        public Dictionary<string, string> ApprovedSourceHashes { get; } = new Dictionary<string, string>(StringComparer.Ordinal);
        public Dictionary<string, string> ApprovedRevitMappingHashes { get; } = new Dictionary<string, string>(StringComparer.Ordinal);

        public bool Approves(ConcreteRuleBundle bundle)
        {
            if (bundle == null) return false;
            string approved;
            return ApprovedHashes.TryGetValue(BundleKey(bundle.BundleId, bundle.Version), out approved) &&
                string.Equals(approved, bundle.Sha256, StringComparison.OrdinalIgnoreCase);
        }

        public bool Approves(StructuralSourceEvidence source)
        {
            if (source == null || !source.IsSpecified()) return false;
            string approved;
            return ApprovedSourceHashes.TryGetValue(source.SourceId, out approved) &&
                string.Equals(approved, source.Sha256, StringComparison.OrdinalIgnoreCase);
        }

        public static string BundleKey(string id, string version) { return (id ?? "") + "@" + (version ?? ""); }

        public bool Approves(RevitConcreteMappingBundle bundle)
        {
            if (bundle == null) return false;
            string approved;
            return ApprovedRevitMappingHashes.TryGetValue(BundleKey(bundle.BundleId, bundle.Version), out approved) &&
                string.Equals(approved, bundle.Sha256, StringComparison.OrdinalIgnoreCase);
        }
    }

    public enum RevitConcreteMappingDecision { Include, Exclude }

    public sealed class RevitConcreteMappingRule
    {
        public string Category { get; set; }
        public string Family { get; set; }
        public string Type { get; set; }
        public string Building { get; set; }
        public string Member { get; set; }
        public string Spec { get; set; }
        public RevitConcreteMappingDecision Decision { get; set; }
    }

    public sealed class RevitConcreteMappingBundle
    {
        public string BundleId { get; set; }
        public string Version { get; set; }
        public string Sha256 { get; set; }
        public string SourceRef { get; set; }
        public List<RevitConcreteMappingRule> Rules { get; } = new List<RevitConcreteMappingRule>();
    }

    public sealed class RevitConcreteMappingResult
    {
        public IReadOnlyList<ConcreteInputRow> Rows { get; internal set; }
        public int ComputedSelectedCount { get; internal set; }
        public int ZeroExcludedCount { get; internal set; }
        public int ComputedExcludedCount { get; internal set; }
        public int MissingReviewCount { get; internal set; }
        public int UnmatchedReviewCount { get; internal set; }
        public StructuralQuantityStatus Status { get; internal set; }
        public string Message { get; internal set; }
    }

    public sealed class ConcreteTakeoffRow
    {
        public ConcreteSourceKind SourceKind { get; internal set; }
        public string Building { get; internal set; }
        public string Floor { get; internal set; }
        public string Member { get; internal set; }
        public string Spec { get; internal set; }
        public StructuralQuantityStatus Status { get; internal set; }
        public decimal RawQuantityM3 { get; internal set; }
        public decimal DeductionQuantityM3 { get; internal set; }
        public decimal? AllowanceQuantityM3 { get; internal set; }
        public decimal? FinalQuantityM3 { get; internal set; }
        public string Formula { get; internal set; }
        public string RuleId { get; internal set; }
        public string RuleHash { get; internal set; }
        public string RuleSource { get; internal set; }
        public string Source { get; internal set; }
        public IReadOnlyList<string> ElementIds { get; internal set; }
        public string Message { get; internal set; }
        public string CommonKey { get { return ConcreteTakeoff.CommonKey(Building, Floor, Member, Spec); } }
    }

    public sealed class ConcreteTakeoffResult
    {
        public IReadOnlyList<ConcreteTakeoffRow> Rows { get; internal set; }
        public StructuralQuantityStatus Status { get; internal set; }
    }

    public sealed class ConcreteLedgerBridgeResult
    {
        public IReadOnlyList<ConcreteInputRow> Rows { get; internal set; }
        public int SelectedConcreteCount { get; internal set; }
        public int ExcludedUnknownCount { get; internal set; }
        public int ExcludedNonConcreteCount { get; internal set; }
        public decimal RawConcreteQuantityM3 { get; internal set; }
        public StructuralQuantityStatus Status { get; internal set; }
        public string Message { get; internal set; }
    }

    public sealed class ConcreteReconciliationRow
    {
        public string CommonKey { get; internal set; }
        public decimal? LeftQuantityM3 { get; internal set; }
        public decimal? RightQuantityM3 { get; internal set; }
        public decimal? DeltaM3 { get; internal set; }
        public StructuralQuantityStatus Status { get; internal set; }
        public string Message { get; internal set; }
    }

    public sealed class ConcreteReconciliationResult
    {
        public IReadOnlyList<ConcreteReconciliationRow> Rows { get; internal set; }
        public decimal? LeftTotalM3 { get; internal set; }
        public decimal? RightTotalM3 { get; internal set; }
        public decimal? TotalDeltaM3 { get; internal set; }
        public decimal? RowDeltaSumM3 { get; internal set; }
        public bool DeltasClose { get; internal set; }
        public StructuralQuantityStatus Status { get; internal set; }
    }

    public static class ConcreteTakeoff
    {
        public static RevitConcreteMappingResult MapRevitLedger(IEnumerable<ElementQuantityLedgerRow> ledger,
            RevitConcreteMappingBundle bundle, ConcreteRuleRegistry registry)
        {
            List<ElementQuantityLedgerRow> rows = (ledger ?? Enumerable.Empty<ElementQuantityLedgerRow>()).ToList();
            string error;
            if (!ValidRevitMappingBundle(bundle, out error)) return MappingResult(new ConcreteInputRow[0], 0, 0, 0, 0, 0, StructuralQuantityStatus.FAIL, error);
            if (bundle.Rules.Count == 0) return MappingResult(new ConcreteInputRow[0], 0, 0, 0, 0, 0, StructuralQuantityStatus.REVIEW, "승인할 Revit 콘크리트 매핑 규칙이 없습니다.");
            if (registry == null || !registry.Approves(bundle)) return MappingResult(new ConcreteInputRow[0], 0, 0, 0, 0, 0, StructuralQuantityStatus.REVIEW, "Revit 매핑 bundle 해시가 승인 registry와 일치하지 않습니다.");

            int selected = 0, zero = 0, excluded = 0, missing = 0, unmatched = 0;
            var output = new List<ConcreteInputRow>();
            foreach (ElementQuantityLedgerRow row in rows)
            {
                if (row == null) return MappingResult(output, selected, zero, excluded, missing, unmatched, StructuralQuantityStatus.FAIL, "Revit 요소 ledger에 null 행이 있습니다.");
                if (row.VolumeState == ElementVolumeState.ZERO) { zero++; continue; }
                if (row.VolumeState == ElementVolumeState.MISSING) { missing++; continue; }
                if (row.VolumeState != ElementVolumeState.COMPUTED || !row.VolumeM3.HasValue || row.VolumeM3.Value <= 0m)
                    return MappingResult(output, selected, zero, excluded, missing, unmatched, StructuralQuantityStatus.FAIL, "COMPUTED 체적 상태가 올바르지 않습니다: " + (row.ElementId ?? ""));
                selected++;
                List<RevitConcreteMappingRule> matches = bundle.Rules.Where(rule =>
                    string.Equals(rule.Category, row.Category, StringComparison.Ordinal) && string.Equals(rule.Family, row.Family, StringComparison.Ordinal) && string.Equals(rule.Type, row.Type, StringComparison.Ordinal)).ToList();
                if (matches.Count != 1) { unmatched++; continue; }
                RevitConcreteMappingRule match = matches[0];
                if (match.Decision == RevitConcreteMappingDecision.Exclude) { excluded++; continue; }
                string elementId;
                try { elementId = ElementQuantityLedger.CanonicalElementId(row.ElementId); }
                catch (InvalidDataException) { return MappingResult(output, selected, zero, excluded, missing, unmatched, StructuralQuantityStatus.FAIL, "Revit element_id가 올바르지 않습니다: " + (row.ElementId ?? "")); }
                var mapped = new ConcreteInputRow {
                    RowId = "revit/" + elementId,
                    SourceKind = ConcreteSourceKind.Revit,
                    Building = match.Building,
                    Floor = row.Level,
                    Member = match.Member,
                    Spec = match.Spec,
                    SignedQuantityM3 = row.VolumeM3.Value,
                    Operation = StructuralQuantityOperation.Normal
                };
                mapped.ElementIds.Add(elementId);
                output.Add(mapped);
            }
            StructuralQuantityStatus status = missing > 0 || unmatched > 0 ? StructuralQuantityStatus.REVIEW : StructuralQuantityStatus.PASS;
            return MappingResult(output, selected, zero, excluded, missing, unmatched, status,
                "COMPUTED=" + selected.ToString(CultureInfo.InvariantCulture) + "; COMPUTED_EXCLUDED=" + excluded.ToString(CultureInfo.InvariantCulture) + "; ZERO_EXCLUDED=" + zero.ToString(CultureInfo.InvariantCulture) +
                "; MISSING_REVIEW=" + missing.ToString(CultureInfo.InvariantCulture) + "; UNMATCHED_REVIEW=" + unmatched.ToString(CultureInfo.InvariantCulture));
        }

        public static string ComputeRevitMappingHash(RevitConcreteMappingBundle bundle)
        {
            if (bundle == null) throw new ArgumentNullException("bundle");
            var fields = new List<string> { bundle.BundleId ?? "", bundle.Version ?? "", bundle.SourceRef ?? "" };
            foreach (RevitConcreteMappingRule rule in bundle.Rules.OrderBy(rule => MappingKey(rule), StringComparer.Ordinal))
                fields.Add(string.Join("|", rule == null ? "" : rule.Category ?? "", rule == null ? "" : rule.Family ?? "", rule == null ? "" : rule.Type ?? "", rule == null ? "" : rule.Decision.ToString(), rule == null ? "" : rule.Building ?? "", rule == null ? "" : rule.Member ?? "", rule == null ? "" : rule.Spec ?? ""));
            string canonical = string.Join("", fields.Select(field => field.Length.ToString(CultureInfo.InvariantCulture) + ":" + field));
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(canonical))).Replace("-", "");
        }

        public static ConcreteLedgerBridgeResult FromStructuralLedger(StructuralLedgerWorkbookImportResult import,
            ConcreteSourceKind sourceKind, string building, string approvedRevision)
        {
            if (import == null) throw new ArgumentNullException("import");
            if (import.Status == StructuralQuantityStatus.FAIL)
                return BridgeResult(new ConcreteInputRow[0], 0, 0, 0, StructuralQuantityStatus.FAIL,
                    "FAIL 원시 ledger는 콘크리트 입력으로 변환하지 않았습니다: " + (import.Message ?? ""));
            bool expectedKind = sourceKind == ConcreteSourceKind.Zg && import.SchemaId == StructuralLedgerWorkbookAdapter.Zg04ASchemaId ||
                sourceKind == ConcreteSourceKind.Zj && import.SchemaId == StructuralLedgerWorkbookAdapter.Zj02SchemaId;
            if (!expectedKind || string.IsNullOrWhiteSpace(building) || string.IsNullOrWhiteSpace(approvedRevision))
                return BridgeResult(new ConcreteInputRow[0], 0, 0, import.Rows.Count, StructuralQuantityStatus.NOT_EVALUATED,
                    "source kind·building·승인 revision이 원시 ledger 스키마와 함께 명시되어야 합니다.");

            StructuralQuantityBucket[] concrete = { StructuralQuantityBucket.ConcreteBedding, StructuralQuantityBucket.ConcretePlain, StructuralQuantityBucket.ConcreteReinforced };
            List<StructuralLedgerRow> selected = import.Rows.Where(row => row != null && concrete.Contains(row.Bucket) && string.Equals(row.Unit, "m3", StringComparison.OrdinalIgnoreCase)).ToList();
            int unknown = import.Rows.Count(row => row != null && row.Bucket == StructuralQuantityBucket.Unknown);
            int nonConcrete = import.Rows.Count - selected.Count - unknown;
            var output = new List<ConcreteInputRow>();
            foreach (StructuralLedgerRow row in selected)
            {
                StructuralSourceEvidence source = row.Source == null ? null : new StructuralSourceEvidence {
                    SourceId = row.Source.SourceId,
                    Sha256 = row.Source.Sha256,
                    Revision = approvedRevision,
                    Sheet = row.Source.Sheet,
                    Cell = row.Source.Cell,
                    Row = row.Source.Row
                };
                output.Add(new ConcreteInputRow {
                    RowId = row.LedgerId,
                    SourceKind = sourceKind,
                    Building = building,
                    Floor = row.Floor,
                    Member = !string.IsNullOrWhiteSpace(row.MemberMark) ? row.MemberMark : row.MemberType,
                    Spec = row.Spec,
                    SignedQuantityM3 = row.SignedQuantity,
                    Operation = row.Operation,
                    SourceEvidence = source
                });
            }
            StructuralQuantityStatus status = selected.Count == 0 ? StructuralQuantityStatus.NOT_EVALUATED : StructuralQuantityStatus.REVIEW;
            return BridgeResult(output, selected.Count, unknown, nonConcrete, status,
                selected.Count == 0
                    ? "명시된 콘크리트 3버킷 m3 행이 없어 변환하지 않았습니다."
                    : "원시 콘크리트 행을 보존했습니다. Unknown=" + unknown.ToString(CultureInfo.InvariantCulture) +
                      ", 비콘크리트=" + nonConcrete.ToString(CultureInfo.InvariantCulture) +
                      "; raw→official 할증·공제 변환은 적용하지 않았으므로 REVIEW입니다.");
        }

        public static ConcreteTakeoffResult Calculate(IEnumerable<ConcreteInputRow> input, ConcreteRuleBundle bundle, ConcreteRuleRegistry registry)
        {
            if (input == null) throw new ArgumentNullException("input");
            List<ConcreteInputRow> rows = input.Where(row => row != null).ToList();
            if (rows.Count == 0)
                return new ConcreteTakeoffResult { Rows = new ConcreteTakeoffRow[0], Status = StructuralQuantityStatus.NOT_EVALUATED };

            string bundleError;
            bool validBundle = ValidBundle(bundle, out bundleError);
            bool approvedBundle = validBundle && registry != null && registry.Approves(bundle);
            var duplicateIds = new HashSet<string>(rows.Where(row => !string.IsNullOrWhiteSpace(row.RowId))
                .GroupBy(row => row.RowId, StringComparer.Ordinal).Where(group => group.Count() > 1).Select(group => group.Key), StringComparer.Ordinal);
            var ambiguousEvidenceRows = new HashSet<string>(rows.SelectMany(row => EvidenceTokens(row).Select(token => new { token, row.RowId }))
                .GroupBy(item => item.token, StringComparer.Ordinal).Where(group => group.Select(item => item.RowId).Distinct(StringComparer.Ordinal).Count() > 1)
                .SelectMany(group => group.Select(item => item.RowId)), StringComparer.Ordinal);
            var output = new List<ConcreteTakeoffRow>();

            foreach (var group in rows.GroupBy(row => SourceKey(row), StringComparer.Ordinal).OrderBy(group => group.Key, StringComparer.Ordinal))
            {
                List<ConcreteInputRow> members = group.OrderBy(row => row.RowId, StringComparer.Ordinal).ToList();
                ConcreteInputRow first = members[0];
                decimal raw = 0m;
                decimal deduction = 0m;
                bool quantitiesInRange = TrySum(members.Select(row => row.SignedQuantityM3), out raw) &&
                    TrySum(members.Where(row => row.Operation == StructuralQuantityOperation.Deduction).Select(row => row.SignedQuantityM3), out deduction);
                var result = new ConcreteTakeoffRow {
                    SourceKind = first.SourceKind, Building = first.Building ?? "", Floor = first.Floor ?? "", Member = first.Member ?? "", Spec = first.Spec ?? "",
                    RawQuantityM3 = raw, DeductionQuantityM3 = deduction,
                    ElementIds = CanonicalElementIds(members),
                    Source = string.Join(" | ", members.Select(SourceText).Distinct(StringComparer.Ordinal)),
                    RuleId = bundle == null ? "" : ConcreteRuleRegistry.BundleKey(bundle.BundleId, bundle.Version),
                    RuleHash = bundle == null ? "" : bundle.Sha256 ?? "", RuleSource = bundle == null ? "" : bundle.SourceRef ?? ""
                };

                string rowError;
                if (members.Any(row => !ValidInput(row, duplicateIds, ambiguousEvidenceRows, out rowError)))
                {
                    result.Status = StructuralQuantityStatus.NOT_EVALUATED;
                    result.Message = "입력 출처 또는 signed 공제 근거가 모호합니다: " + members.Select(row => { string error; ValidInput(row, duplicateIds, ambiguousEvidenceRows, out error); return error; }).First(error => !string.IsNullOrEmpty(error));
                }
                else if (!quantitiesInRange)
                {
                    result.Status = StructuralQuantityStatus.REVIEW;
                    result.Message = "signed 콘크리트 합계가 decimal 범위를 벗어났습니다.";
                }
                else if (members.Any(row => row.SourceKind != ConcreteSourceKind.Revit &&
                    (registry == null || !registry.Approves(row.SourceEvidence))))
                {
                    result.Status = StructuralQuantityStatus.REVIEW;
                    result.Message = "ZG/ZJ 원본 해시가 승인 registry와 일치하지 않습니다.";
                }
                else if (!validBundle || !approvedBundle)
                {
                    result.Status = StructuralQuantityStatus.REVIEW;
                    result.Message = !validBundle ? "규칙 묶음이 유효하지 않습니다: " + bundleError : "규칙 묶음 해시가 승인 registry와 일치하지 않습니다.";
                }
                else
                {
                    List<ConcreteAllowanceRule> matches = bundle.Rules.Where(rule => string.Equals(rule.Spec, first.Spec, StringComparison.Ordinal)).ToList();
                    if (matches.Count != 1)
                    {
                        result.Status = StructuralQuantityStatus.REVIEW;
                        result.Message = "규격에 대응하는 승인 규칙은 정확히 하나여야 합니다.";
                    }
                    else
                    {
                        try
                        {
                            decimal final = Apply(members, matches[0], out string formula);
                            result.FinalQuantityM3 = final;
                            result.AllowanceQuantityM3 = final - raw;
                            result.Formula = formula;
                            result.Status = StructuralQuantityStatus.PASS;
                            result.Message = "승인 규칙으로 signed 콘크리트 수량을 계산했습니다.";
                        }
                        catch (OverflowException)
                        {
                            result.Status = StructuralQuantityStatus.REVIEW;
                            result.Message = "콘크리트 계산이 decimal 범위를 벗어났습니다.";
                        }
                    }
                }
                output.Add(result);
            }
            return new ConcreteTakeoffResult { Rows = output.AsReadOnly(), Status = Overall(output.Select(row => row.Status)) };
        }

        public static ConcreteReconciliationResult Reconcile(ConcreteTakeoffResult left, ConcreteTakeoffResult right)
        {
            if (left == null) throw new ArgumentNullException("left");
            if (right == null) throw new ArgumentNullException("right");
            var leftGroups = Index(left.Rows);
            var rightGroups = Index(right.Rows);
            var keys = leftGroups.Keys.Concat(rightGroups.Keys).Distinct(StringComparer.Ordinal).OrderBy(key => key, StringComparer.Ordinal);
            var rows = new List<ConcreteReconciliationRow>();
            foreach (string key in keys)
            {
                ConcreteTakeoffRow l; ConcreteTakeoffRow r;
                bool hasLeft = leftGroups.TryGetValue(key, out l); bool hasRight = rightGroups.TryGetValue(key, out r);
                bool comparable = hasLeft && hasRight && l.Status == StructuralQuantityStatus.PASS && r.Status == StructuralQuantityStatus.PASS && l.FinalQuantityM3.HasValue && r.FinalQuantityM3.HasValue;
                decimal? delta = comparable ? r.FinalQuantityM3.Value - l.FinalQuantityM3.Value : (decimal?)null;
                rows.Add(new ConcreteReconciliationRow {
                    CommonKey = key,
                    LeftQuantityM3 = hasLeft ? l.FinalQuantityM3 : null,
                    RightQuantityM3 = hasRight ? r.FinalQuantityM3 : null,
                    DeltaM3 = delta,
                    Status = comparable && delta.Value == 0m ? StructuralQuantityStatus.PASS : comparable ? StructuralQuantityStatus.REVIEW : hasLeft && hasRight ? StructuralQuantityStatus.NOT_EVALUATED : StructuralQuantityStatus.REVIEW,
                    Message = comparable && delta.Value == 0m ? "공통 키의 수량이 정확히 일치합니다." : comparable ? "공통 키의 수량 차이를 검토해야 합니다." : hasLeft && hasRight ? "PASS 계산값이 아니어서 비교하지 않았습니다." : "한쪽 결과에 공통 키가 없습니다."
                });
            }
            bool allComparable = rows.Count > 0 && rows.All(row => row.DeltaM3.HasValue);
            decimal? leftTotal = allComparable ? rows.Sum(row => row.LeftQuantityM3.Value) : (decimal?)null;
            decimal? rightTotal = allComparable ? rows.Sum(row => row.RightQuantityM3.Value) : (decimal?)null;
            decimal? totalDelta = allComparable ? rightTotal.Value - leftTotal.Value : (decimal?)null;
            decimal? rowDelta = allComparable ? rows.Sum(row => row.DeltaM3.Value) : (decimal?)null;
            bool closes = allComparable && totalDelta.Value == rowDelta.Value;
            return new ConcreteReconciliationResult {
                Rows = rows.AsReadOnly(), LeftTotalM3 = leftTotal, RightTotalM3 = rightTotal,
                TotalDeltaM3 = totalDelta, RowDeltaSumM3 = rowDelta, DeltasClose = closes,
                Status = closes && totalDelta.Value == 0m && rows.All(row => row.Status == StructuralQuantityStatus.PASS)
                    ? StructuralQuantityStatus.PASS
                    : rows.Any(row => row.Status == StructuralQuantityStatus.REVIEW) ? StructuralQuantityStatus.REVIEW : StructuralQuantityStatus.NOT_EVALUATED
            };
        }

        public static void RequireReview(ConcreteTakeoffResult result, string reason)
        {
            if (result == null) throw new ArgumentNullException("result");
            foreach (ConcreteTakeoffRow row in result.Rows ?? new ConcreteTakeoffRow[0])
                if (row.Status == StructuralQuantityStatus.PASS)
                {
                    row.Status = StructuralQuantityStatus.REVIEW;
                    row.Message = (row.Message ?? "") + "; " + (reason ?? "운영 승인이 필요합니다.");
                }
            if (result.Status == StructuralQuantityStatus.PASS) result.Status = StructuralQuantityStatus.REVIEW;
        }

        public static string ComputeRuleHash(ConcreteRuleBundle bundle)
        {
            if (bundle == null) throw new ArgumentNullException("bundle");
            var fields = new List<string> { bundle.BundleId ?? "", bundle.Version ?? "", bundle.SourceRef ?? "" };
            foreach (ConcreteAllowanceRule rule in bundle.Rules.OrderBy(rule => rule.Spec, StringComparer.Ordinal))
                fields.Add(string.Join("|", rule.Spec ?? "", rule.AllowanceRate.ToString(CultureInfo.InvariantCulture), rule.ApplicationBasis,
                    rule.DeductionTiming, rule.RoundingMode, rule.RoundingScale.HasValue ? rule.RoundingScale.Value.ToString(CultureInfo.InvariantCulture) : ""));
            string canonical = string.Join("", fields.Select(field => field.Length.ToString(CultureInfo.InvariantCulture) + ":" + field));
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(canonical))).Replace("-", "");
        }

        internal static string CommonKey(string building, string floor, string member, string spec)
        {
            return string.Join("\u001f", building ?? "", floor ?? "", member ?? "", spec ?? "");
        }

        private static Dictionary<string, ConcreteTakeoffRow> Index(IEnumerable<ConcreteTakeoffRow> rows)
        {
            var result = new Dictionary<string, ConcreteTakeoffRow>(StringComparer.Ordinal);
            foreach (ConcreteTakeoffRow row in rows ?? Enumerable.Empty<ConcreteTakeoffRow>())
                if (result.ContainsKey(row.CommonKey))
                    result[row.CommonKey] = new ConcreteTakeoffRow { Building = row.Building, Floor = row.Floor, Member = row.Member, Spec = row.Spec, Status = StructuralQuantityStatus.NOT_EVALUATED, Message = "중복 공통 키입니다.", ElementIds = new string[0] };
                else result.Add(row.CommonKey, row);
            return result;
        }

        private static string SourceKey(ConcreteInputRow row) { return row.SourceKind + "\u001e" + CommonKey(row.Building, row.Floor, row.Member, row.Spec); }

        private static bool ValidInput(ConcreteInputRow row, HashSet<string> duplicateIds, HashSet<string> ambiguousEvidenceRows, out string error)
        {
            error = null;
            if (string.IsNullOrWhiteSpace(row.RowId) || duplicateIds.Contains(row.RowId)) error = "row_id가 없거나 중복됩니다.";
            else if (ambiguousEvidenceRows.Contains(row.RowId)) error = "같은 element ID 또는 원본 셀이 여러 행에 중복되었습니다.";
            else if (!Enum.IsDefined(typeof(ConcreteSourceKind), row.SourceKind) || row.SourceKind == ConcreteSourceKind.Unknown ||
                string.IsNullOrWhiteSpace(row.Building) || string.IsNullOrWhiteSpace(row.Floor) || string.IsNullOrWhiteSpace(row.Member) || string.IsNullOrWhiteSpace(row.Spec))
                error = "source kind와 building·floor·member·spec이 필요합니다.";
            else if (row.SignedQuantityM3 < 0m && row.Operation != StructuralQuantityOperation.Deduction || row.SignedQuantityM3 >= 0m && row.Operation == StructuralQuantityOperation.Deduction) error = "signed 수량과 operation이 일치하지 않습니다.";
            else if (row.Operation != StructuralQuantityOperation.Normal && row.Operation != StructuralQuantityOperation.Deduction) error = "콘크리트 operation은 normal 또는 deduction이어야 합니다.";
            else if (row.SourceKind == ConcreteSourceKind.Revit)
            {
                if (row.SourceEvidence != null || !ValidElementIds(row.ElementIds)) error = "Revit 행은 중복 없는 양의 element ID만 근거로 가져야 합니다.";
            }
            else if (row.ElementIds.Count != 0 || row.SourceEvidence == null || !row.SourceEvidence.IsSpecified()) error = "ZG/ZJ 행은 SHA·revision·sheet·cell 원본 근거만 가져야 합니다.";
            return error == null;
        }

        private static bool ValidElementIds(IEnumerable<string> values)
        {
            var parsed = new HashSet<long>();
            int count = 0;
            foreach (string value in values ?? Enumerable.Empty<string>())
            {
                long id;
                count++;
                if (!long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out id) || id <= 0 || !parsed.Add(id)) return false;
            }
            return count > 0;
        }

        private static IReadOnlyList<string> CanonicalElementIds(IEnumerable<ConcreteInputRow> rows)
        {
            return rows.SelectMany(row => row.ElementIds).Select(value => {
                long id;
                return long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out id)
                    ? id.ToString(CultureInfo.InvariantCulture) : value;
            }).Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal).ToArray();
        }

        private static IEnumerable<string> EvidenceTokens(ConcreteInputRow row)
        {
            if (row.SourceKind == ConcreteSourceKind.Revit)
            {
                foreach (string value in row.ElementIds)
                {
                    long id;
                    if (long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out id) && id > 0)
                        yield return "R:" + id.ToString(CultureInfo.InvariantCulture);
                }
            }
            else if (row.SourceEvidence != null && row.SourceEvidence.IsSpecified()) yield return "S:" + row.SourceEvidence.Key();
        }

        private static string SourceText(ConcreteInputRow row)
        {
            return row.SourceKind == ConcreteSourceKind.Revit ? "revit-elements=" + string.Join("|", row.ElementIds.OrderBy(id => id, StringComparer.Ordinal)) : row.SourceEvidence == null ? "" : row.SourceEvidence.ToString();
        }

        private static bool ValidBundle(ConcreteRuleBundle bundle, out string error)
        {
            error = null;
            if (bundle == null || string.IsNullOrWhiteSpace(bundle.BundleId) || string.IsNullOrWhiteSpace(bundle.Version) || string.IsNullOrWhiteSpace(bundle.SourceRef)) error = "id·version·source가 필요합니다.";
            else if (bundle.Rules.Count == 0 || bundle.Rules.Any(rule => rule == null) || bundle.Rules.GroupBy(rule => rule.Spec, StringComparer.Ordinal).Any(group => string.IsNullOrWhiteSpace(group.Key) || group.Count() != 1)) error = "spec별 규칙이 정확히 하나 필요합니다.";
            else if (bundle.Rules.Any(rule => rule.AllowanceRate < 0m || !Enum.IsDefined(typeof(ConcreteAllowanceBasis), rule.ApplicationBasis) || rule.ApplicationBasis == ConcreteAllowanceBasis.Unknown ||
                !Enum.IsDefined(typeof(ConcreteDeductionTiming), rule.DeductionTiming) || rule.DeductionTiming == ConcreteDeductionTiming.Unknown || !Enum.IsDefined(typeof(StructuralRoundingMode), rule.RoundingMode) ||
                rule.RoundingMode == StructuralRoundingMode.None && rule.RoundingScale.HasValue || rule.RoundingMode != StructuralRoundingMode.None && (!rule.RoundingScale.HasValue || rule.RoundingScale < 0 || rule.RoundingScale > 6))) error = "할증·적용기준·공제시점·반올림 설정이 올바르지 않습니다.";
            else if (!StructuralRuleEvidence.ValidSha(bundle.Sha256) || !string.Equals(bundle.Sha256, ComputeRuleHash(bundle), StringComparison.OrdinalIgnoreCase)) error = "규칙 묶음 SHA-256이 canonical 내용과 다릅니다.";
            return error == null;
        }

        private static RevitConcreteMappingResult MappingResult(IEnumerable<ConcreteInputRow> rows, int selected, int zero, int excluded, int missing, int unmatched, StructuralQuantityStatus status, string message)
        {
            return new RevitConcreteMappingResult { Rows = (rows ?? Enumerable.Empty<ConcreteInputRow>()).ToList().AsReadOnly(), ComputedSelectedCount = selected,
                ZeroExcludedCount = zero, ComputedExcludedCount = excluded, MissingReviewCount = missing, UnmatchedReviewCount = unmatched, Status = status, Message = message };
        }

        private static bool ValidRevitMappingBundle(RevitConcreteMappingBundle bundle, out string error)
        {
            error = null;
            if (bundle == null || string.IsNullOrWhiteSpace(bundle.BundleId) || string.IsNullOrWhiteSpace(bundle.Version) || string.IsNullOrWhiteSpace(bundle.SourceRef)) error = "Revit mapping bundle의 id·version·source가 필요합니다.";
            else if (bundle.Rules.Any(rule => rule == null || Wildcard(rule.Category) || Wildcard(rule.Family) || Wildcard(rule.Type) ||
                !Enum.IsDefined(typeof(RevitConcreteMappingDecision), rule.Decision) ||
                (rule.Decision == RevitConcreteMappingDecision.Include && (string.IsNullOrWhiteSpace(rule.Building) || string.IsNullOrWhiteSpace(rule.Member) || string.IsNullOrWhiteSpace(rule.Spec))) ||
                (rule.Decision == RevitConcreteMappingDecision.Exclude && (!string.IsNullOrEmpty(rule.Building) || !string.IsNullOrEmpty(rule.Member) || !string.IsNullOrEmpty(rule.Spec)))))
                error = "Revit 매핑은 category/family/type 정확 일치와 INCLUDE/EXCLUDE 판정이 필요하며 INCLUDE만 building/member/spec을 가져야 합니다.";
            else if (bundle.Rules.GroupBy(rule => MappingKey(rule), StringComparer.Ordinal).Any(group => group.Count() != 1)) error = "같은 category/family/type의 Revit 매핑 규칙이 중복됩니다.";
            else if (!StructuralRuleEvidence.ValidSha(bundle.Sha256) || !string.Equals(bundle.Sha256, ComputeRevitMappingHash(bundle), StringComparison.OrdinalIgnoreCase)) error = "Revit mapping bundle SHA-256이 canonical 내용과 다릅니다.";
            return error == null;
        }

        private static bool Wildcard(string value)
        {
            return string.IsNullOrWhiteSpace(value) || value.IndexOf('*') >= 0 || value.IndexOf('?') >= 0;
        }

        private static string MappingKey(RevitConcreteMappingRule rule)
        {
            return rule == null ? "" : (rule.Category ?? "") + "\u001f" + (rule.Family ?? "") + "\u001f" + (rule.Type ?? "");
        }

        private static decimal Apply(List<ConcreteInputRow> rows, ConcreteAllowanceRule rule, out string formula)
        {
            decimal normal = rows.Where(row => row.Operation == StructuralQuantityOperation.Normal).Sum(row => row.SignedQuantityM3);
            decimal deduction = rows.Where(row => row.Operation == StructuralQuantityOperation.Deduction).Sum(row => row.SignedQuantityM3);
            decimal value;
            if (rule.ApplicationBasis == ConcreteAllowanceBasis.Row)
                value = rows.Sum(row => Round(row.SignedQuantityM3 * (row.Operation == StructuralQuantityOperation.Deduction && rule.DeductionTiming == ConcreteDeductionTiming.AfterAllowance ? 1m : 1m + rule.AllowanceRate), rule));
            else
                value = rule.DeductionTiming == ConcreteDeductionTiming.BeforeAllowance ? Round((normal + deduction) * (1m + rule.AllowanceRate), rule) : Round(normal * (1m + rule.AllowanceRate) + deduction, rule);
            string rate = rule.AllowanceRate.ToString(CultureInfo.InvariantCulture);
            string scale = rule.RoundingMode == StructuralRoundingMode.None ? "NONE" : rule.RoundingScale.Value.ToString(CultureInfo.InvariantCulture) + "," + rule.RoundingMode.ToString().ToUpperInvariant();
            if (rule.ApplicationBasis == ConcreteAllowanceBasis.Row)
                formula = rule.DeductionTiming == ConcreteDeductionTiming.BeforeAllowance
                    ? "SUM(ROUND(q_signed*(1+" + rate + ")," + scale + "))"
                    : "SUM(ROUND(q_normal*(1+" + rate + ")," + scale + "))+SUM(ROUND(q_deduction," + scale + "))";
            else formula = rule.DeductionTiming == ConcreteDeductionTiming.BeforeAllowance
                ? "ROUND((SUM(q_normal)+SUM(q_deduction))*(1+" + rate + ")," + scale + ")"
                : "ROUND(SUM(q_normal)*(1+" + rate + ")+SUM(q_deduction)," + scale + ")";
            return value;
        }

        private static decimal Round(decimal value, ConcreteAllowanceRule rule)
        {
            if (rule.RoundingMode == StructuralRoundingMode.None) return value;
            decimal factor = 1m;
            for (int i = 0; i < rule.RoundingScale.Value; i++) factor *= 10m;
            if (rule.RoundingMode == StructuralRoundingMode.Truncate) return decimal.Truncate(value * factor) / factor;
            return decimal.Round(value, rule.RoundingScale.Value, MidpointRounding.AwayFromZero);
        }

        private static bool TrySum(IEnumerable<decimal> values, out decimal sum)
        {
            sum = 0m;
            try
            {
                foreach (decimal value in values) sum = checked(sum + value);
                return true;
            }
            catch (OverflowException) { sum = 0m; return false; }
        }

        private static StructuralQuantityStatus Overall(IEnumerable<StructuralQuantityStatus> statuses)
        {
            List<StructuralQuantityStatus> list = statuses.ToList();
            if (list.Count == 0) return StructuralQuantityStatus.NOT_EVALUATED;
            if (list.Any(status => status == StructuralQuantityStatus.NOT_EVALUATED)) return StructuralQuantityStatus.NOT_EVALUATED;
            if (list.Any(status => status == StructuralQuantityStatus.REVIEW)) return StructuralQuantityStatus.REVIEW;
            if (list.Any(status => status == StructuralQuantityStatus.FAIL)) return StructuralQuantityStatus.FAIL;
            return StructuralQuantityStatus.PASS;
        }

        private static ConcreteLedgerBridgeResult BridgeResult(IEnumerable<ConcreteInputRow> rows, int selected, int unknown,
            int nonConcrete, StructuralQuantityStatus status, string message)
        {
            List<ConcreteInputRow> list = rows.ToList();
            decimal total;
            if (!TrySum(list.Select(row => row.SignedQuantityM3), out total))
            {
                status = StructuralQuantityStatus.REVIEW;
                total = 0m;
                message = "원시 콘크리트 합계가 decimal 범위를 벗어났습니다.";
            }
            return new ConcreteLedgerBridgeResult {
                Rows = list.AsReadOnly(), SelectedConcreteCount = selected, ExcludedUnknownCount = unknown,
                ExcludedNonConcreteCount = nonConcrete, RawConcreteQuantityM3 = total, Status = status, Message = message
            };
        }
    }
}
