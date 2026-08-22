using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Lukas.Qto.Core
{
    public static class Preflight
    {
        public static List<Finding> Run(IEnumerable<QtoRecord> qtoRows, IEnumerable<EstimateLine> lines, IEnumerable<Mapping> mappings, AuditPolicy policy, EstimateSummary summary = null)
        {
            var findings = new List<Finding>();
            try { RunCore(qtoRows, lines, mappings, policy, summary, findings); }
            catch (OverflowException)
            {
                findings.Add(WithEvidence(Note("R030", "FAIL", "ERROR", null, null, null, null, null, null,
                    "입력 산술이 decimal 범위를 벗어나 남은 검산을 중단했습니다."), "stage=preflight-arithmetic"));
            }
            return findings;
        }

        private static void RunCore(IEnumerable<QtoRecord> qtoRows, IEnumerable<EstimateLine> lines, IEnumerable<Mapping> mappings, AuditPolicy policy, EstimateSummary summary, List<Finding> findings)
        {
            if (qtoRows == null || lines == null || mappings == null || policy == null) throw new ArgumentNullException();
            if (policy.QuantityTolerance < 0 || policy.KrwTolerance < 0) throw new ArgumentException("허용오차는 음수일 수 없습니다.");
            var qtoList = qtoRows.ToList();
            if (qtoList.Any(row => row == null)) throw new ArgumentException("QTO 컬렉션에 null 행이 있습니다.");
            if (qtoList.Any(x => string.IsNullOrWhiteSpace(x.Id)) || qtoList.Select(x => x.Id).Distinct().Count() != qtoList.Count) throw new ArgumentException("QTO 검산키는 비어 있거나 중복될 수 없습니다.");
            var traceabilityErrors = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            var elementOwners = new Dictionary<long, List<string>>();
            foreach (var row in qtoList)
            {
                var errors = new List<string>();
                if (HasNegativeValue(row)) errors.Add("QTO 수량은 음수일 수 없습니다.");
                if (string.IsNullOrWhiteSpace(row.Category) || string.IsNullOrWhiteSpace(row.Family) || string.IsNullOrWhiteSpace(row.Type) || string.IsNullOrWhiteSpace(row.Level) ||
                    !string.Equals(row.Id, Input.ComputeQtoAuditKey(row.Category, row.Family, row.Type, row.Level), StringComparison.Ordinal))
                    errors.Add("검산키는 분류·패밀리·타입·레벨 SHA-256과 일치해야 합니다.");
                List<long> elementIds;
                string traceabilityError;
                if (!ValidQtoTraceability(row, out elementIds, out traceabilityError)) errors.Add(traceabilityError);
                foreach (long elementId in elementIds.Distinct())
                {
                    List<string> owners;
                    if (!elementOwners.TryGetValue(elementId, out owners)) elementOwners[elementId] = owners = new List<string>();
                    owners.Add(row.Id);
                }
                traceabilityErrors[row.Id] = errors;
            }
            foreach (var duplicate in elementOwners.Where(pair => pair.Value.Distinct(StringComparer.Ordinal).Count() > 1).OrderBy(pair => pair.Key))
                foreach (string owner in duplicate.Value.Distinct(StringComparer.Ordinal))
                    traceabilityErrors[owner].Add("같은 요소ID가 서로 다른 QTO 행에 중복됩니다: " + duplicate.Key.ToString(CultureInfo.InvariantCulture));
            var invalidQtoIds = new HashSet<string>(traceabilityErrors.Where(pair => pair.Value.Count > 0).Select(pair => pair.Key), StringComparer.Ordinal);
            foreach (var row in qtoList.Where(row => invalidQtoIds.Contains(row.Id)))
                findings.Add(WithEvidence(Note("R030", "FAIL", "ERROR", null, row.Id, null, null, null, null,
                    string.Join(" | ", traceabilityErrors[row.Id])), "qto=" + row.Id + ";row=" + row.SourceRow));
            var qto = qtoList.ToDictionary(x => x.Id);
            var estimateLines = lines.ToList();
            if (estimateLines.Any(line => line == null)) throw new ArgumentException("내역 컬렉션에 null 행이 있습니다.");
            var mappingList = mappings.ToList();
            if (mappingList.Any(mapping => mapping == null)) throw new ArgumentException("매핑 컬렉션에 null 행이 있습니다.");
            if (estimateLines.Count == 0)
            {
                findings.Add(WithEvidence(Note("R030", "FAIL", "ERROR", null, null, null, null, null, null,
                    "검산할 내역 항목이 없습니다."), "stage=input-scope"));
                return;
            }
            if (estimateLines.Any(x => string.IsNullOrWhiteSpace(x.Id)) || estimateLines.Select(x => x.Id).Distinct().Count() != estimateLines.Count) throw new ArgumentException("내역ID는 비어 있거나 중복될 수 없습니다.");
            var lineIds = new HashSet<string>(estimateLines.Select(x => x.Id));
            var lineById = estimateLines.ToDictionary(line => line.Id, StringComparer.Ordinal);
            var invalidMappingRows = new HashSet<Mapping>();
            foreach (var mapping in mappingList.Where(x => !lineIds.Contains(x.EstimateLineId)))
            {
                findings.Add(WithEvidence(Note("R030", "FAIL", "ERROR", mapping.EstimateLineId, mapping.QtoId, mapping.Unit, null, null, null, "매핑이 존재하지 않는 내역ID를 참조합니다."), "mapping-row=" + mapping.SourceRow));
                invalidMappingRows.Add(mapping);
            }
            foreach (var mapping in mappingList.Where(x => lineIds.Contains(x.EstimateLineId) &&
                (x.Multiplier <= 0m || !SupportedUnit(x.Unit) || string.IsNullOrWhiteSpace(x.QtoId) || !qto.ContainsKey(x.QtoId) ||
                 invalidQtoIds.Contains(x.QtoId) ||
                 !string.Equals(x.Unit, lineById[x.EstimateLineId].Unit, StringComparison.Ordinal))))
            {
                findings.Add(WithEvidence(Note("R020", "FAIL", "ERROR", mapping.EstimateLineId, mapping.QtoId, mapping.Unit, null, null, null, "매핑의 계수·단위·QTO 참조가 올바르지 않습니다."), "mapping-row=" + mapping.SourceRow));
                invalidMappingRows.Add(mapping);
            }
            foreach (var duplicate in mappingList.Where(mapping => lineIds.Contains(mapping.EstimateLineId))
                .GroupBy(mapping => mapping.EstimateLineId + "\u001F" + mapping.QtoId, StringComparer.Ordinal).Where(group => group.Count() > 1))
            {
                Mapping first = duplicate.First();
                findings.Add(WithEvidence(Note("R020", "FAIL", "ERROR", first.EstimateLineId, first.QtoId, first.Unit, null, null, null,
                    "같은 내역ID·QTO 집계행 매핑이 중복됩니다."), "mapping-rows=" + string.Join("|", duplicate.Select(mapping => mapping.SourceRow))));
                foreach (Mapping mapping in duplicate) invalidMappingRows.Add(mapping);
            }
            var mapped = mappingList.Where(mapping => !string.IsNullOrWhiteSpace(mapping.EstimateLineId))
                .GroupBy(mapping => mapping.EstimateLineId, StringComparer.Ordinal).ToDictionary(group => group.Key, group => group.ToList(), StringComparer.Ordinal);

            foreach (var line in estimateLines)
            {
                if (string.IsNullOrWhiteSpace(line.Unit))
                    findings.Add(WithEvidence(Note("R030", "FAIL", "ERROR", line.Id, null, line.Unit, null, null, null, "내역 단위 값이 없습니다."), "line=" + line.Id + ";row=" + line.SourceRow));
                if (HasNegativeValue(line))
                    findings.Add(WithEvidence(Note("R030", "FAIL", "ERROR", line.Id, null, line.Unit, null, null, null, "내역 수량·단가·금액은 음수일 수 없습니다."), "line=" + line.Id + ";row=" + line.SourceRow));
                try
                {
                    CheckUnitPrice(line, policy, findings);
                    CheckAmount(line, policy, findings);
                }
                catch (OverflowException)
                {
                    findings.Add(WithEvidence(Note("R030", "FAIL", "ERROR", line.Id, null, line.Unit, null, null, null,
                        "내역 산술이 decimal 범위를 벗어났습니다."), "line=" + line.Id + ";row=" + line.SourceRow + ";stage=line-arithmetic"));
                }
                if (IsValidAdjustment(line))
                {
                    AddSkippedMappingStatus(line, mapped, invalidMappingRows, findings);
                    findings.Add(WithEvidence(Note("R021", "NOT_EVALUATED", "INFO", line.Id, null, line.Unit, null, line.Quantity, null, "공제·환입 조정 행은 BIM 수량 대조에서 제외합니다."), "line=" + line.Id + ";row=" + line.SourceRow));
                    continue;
                }
                if (!SupportedUnit(line.Unit))
                {
                    AddSkippedMappingStatus(line, mapped, invalidMappingRows, findings);
                    findings.Add(WithEvidence(Note("R021", "NOT_EVALUATED", "INFO", line.Id, null, line.Unit, null, line.Quantity, null, "이 단위는 현재 BIM 수량 대조 범위 밖입니다."), "line=" + line.Id + ";row=" + line.SourceRow));
                    continue;
                }
                List<Mapping> lineMappings;
                if (!mapped.TryGetValue(line.Id, out lineMappings))
                {
                    findings.Add(WithEvidence(Note("R020", "NOT_EVALUATED", "INFO", line.Id, null, line.Unit, null, null, null, "승인된 QTO 매핑이 없습니다."), "line=" + line.Id + ";row=" + line.SourceRow));
                    findings.Add(WithEvidence(Note("R021", "NOT_EVALUATED", "INFO", line.Id, null, line.Unit, null, line.Quantity, null, "승인된 QTO 매핑이 없습니다."), "line=" + line.Id + ";row=" + line.SourceRow));
                    continue;
                }
                if (lineMappings.Any(invalidMappingRows.Contains))
                {
                    findings.Add(WithEvidence(Note("R021", "NOT_EVALUATED", "INFO", line.Id, null, line.Unit, null, line.Quantity, null,
                        "매핑 유효성 오류로 수량 대조를 수행하지 않았습니다."), "line=" + line.Id + ";row=" + line.SourceRow));
                    continue;
                }
                try { CheckBimQuantity(line, lineMappings, qto, invalidQtoIds, policy, findings); }
                catch (OverflowException)
                {
                    findings.Add(WithEvidence(Note("R030", "FAIL", "ERROR", line.Id, string.Join("|", lineMappings.Select(mapping => mapping.QtoId)), line.Unit, null, null, null,
                        "BIM 수량 산술이 decimal 범위를 벗어났습니다."), "line=" + line.Id + ";row=" + line.SourceRow + ";mapping-rows=" + string.Join("|", lineMappings.Select(mapping => mapping.SourceRow)) + ";stage=bim-arithmetic"));
                    findings.Add(WithEvidence(Note("R021", "NOT_EVALUATED", "INFO", line.Id, null, line.Unit, null, line.Quantity, null,
                        "수량 산술 범위 오류로 BIM 대조를 수행하지 않았습니다."), "line=" + line.Id + ";row=" + line.SourceRow));
                }
            }
            CheckCoverage(qtoList, estimateLines, mappingList, qto, invalidQtoIds, findings);
            if (summary != null)
            {
                try { CheckSummary(estimateLines, summary, policy, findings); }
                catch (OverflowException)
                {
                    findings.Add(WithEvidence(Note("R030", "FAIL", "ERROR", "SUMMARY", null, "KRW", null, null, null,
                        "원가계산서 합계 산술이 decimal 범위를 벗어났습니다."), "stage=summary-arithmetic"));
                }
            }
        }

        private static void AddSkippedMappingStatus(EstimateLine line, Dictionary<string, List<Mapping>> mapped,
            HashSet<Mapping> invalidMappingRows, List<Finding> findings)
        {
            List<Mapping> lineMappings;
            if (!mapped.TryGetValue(line.Id, out lineMappings)) return;
            foreach (Mapping mapping in lineMappings.Where(mapping => !invalidMappingRows.Contains(mapping)))
            {
                findings.Add(WithEvidence(Note("R020", "NOT_EVALUATED", "INFO", line.Id, mapping.QtoId, mapping.Unit, null, null, null,
                    "내역 행이 BIM 대조 대상이 아니어서 유효한 매핑도 적용하지 않았습니다."), "mapping-row=" + mapping.SourceRow));
            }
        }

        private static void CheckSummary(List<EstimateLine> lines, EstimateSummary summary, AuditPolicy policy, List<Finding> findings)
        {
            var incompleteRows = lines.Where(line => !CanTotalComponents(line) || HasNegativeValue(line)).Select(line => line.SourceRow).ToList();
            string detailRows = "input-detail-rows=" + string.Join("|", lines.Select(line => line.SourceRow));
            if (incompleteRows.Count > 0)
            {
                string incompleteEvidence = "incomplete-detail-rows=" + string.Join("|", incompleteRows);
                const string missingMessage = "품목 구성금액이 없어 비목 소계를 직접 대조하지 못했습니다.";
                AddSummaryNotEvaluated("AS", summary.MaterialSubtotal, summary, findings, incompleteEvidence, missingMessage);
                AddSummaryNotEvaluated("BS", summary.LaborSubtotal, summary, findings, incompleteEvidence + ";" + SummaryInputs(summary, "B2"), missingMessage);
                AddSummaryNotEvaluated("CS", summary.ExpenseSubtotal, summary, findings, incompleteEvidence + ";" + SummaryInputs(summary, "C4", "C5", "C6", "C7", "CA", "CB", "CG", "CH"), missingMessage);
            }
            else
            {
                decimal material = lines.Sum(line => ComponentAmount(line, line.MaterialAmountKrw, line.MaterialUnitPriceKrw));
                decimal labor = lines.Sum(line => ComponentAmount(line, line.LaborAmountKrw, line.LaborUnitPriceKrw));
                decimal expense = lines.Sum(line => ComponentAmount(line, line.ExpenseAmountKrw, line.ExpenseUnitPriceKrw));
                AddSubtotalFinding("AS", material, summary.MaterialSubtotal, summary, policy, findings, detailRows);
                AddSubtotalFinding("BS", labor + summary.IndirectLabor, summary.LaborSubtotal, summary, policy, findings, detailRows + ";" + SummaryInputs(summary, "B2"));
                AddSubtotalFinding("CS", expense + summary.ExpenseAdditions, summary.ExpenseSubtotal, summary, policy, findings, detailRows + ";" + SummaryInputs(summary, "C4", "C5", "C6", "C7", "CA", "CB", "CG", "CH"));
            }
            AddSummaryFinding("S1", summary.MaterialSubtotal + summary.LaborSubtotal + summary.ExpenseSubtotal, summary.DirectCost, summary, policy, findings, SummaryInputs(summary, "AS", "BS", "CS"));
            decimal supply = decimal.Truncate((summary.DirectCost + summary.GeneralAdmin + summary.Profit + summary.SupplyAdditions) / 10000m) * 10000m;
            AddSummaryFinding("D9", supply, summary.SupplyAmount, summary, policy, findings, SummaryInputs(summary, "S1", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"));
            AddSummaryFinding("DB", decimal.Truncate(summary.SupplyAmount * 0.1m), summary.Vat, summary, policy, findings, SummaryInputs(summary, "D9"));
            AddSummaryFinding("DH", summary.SupplyAmount + summary.Vat, summary.ContractAmount, summary, policy, findings, SummaryInputs(summary, "D9", "DB"));
            AddSummaryFinding("S2", summary.ContractAmount + summary.FinalAdditions, summary.TotalAmount, summary, policy, findings, SummaryInputs(summary, "DH", "DK", "DL", "DM"));
        }

        private static void AddSummaryNotEvaluated(string code, decimal actual, EstimateSummary summary, List<Finding> findings, string inputs, string message = "관급·별도 금액의 구성비 배분 근거가 없어 품목 합계와 비목 소계를 직접 대조하지 않았습니다.")
        {
            int row;
            summary.SourceRows.TryGetValue(code, out row);
            findings.Add(WithEvidence(Note("R012", "NOT_EVALUATED", "INFO", "SUMMARY-" + code, null, "KRW", null, actual, null, message), "sheet=원가계산서;output-row=" + row + ";code=" + code + ";" + inputs + ";" + SummaryInputs(summary, "DK", "DL", "DM")));
        }

        private static void AddSubtotalFinding(string code, decimal expected, decimal actual, EstimateSummary summary, AuditPolicy policy, List<Finding> findings, string inputs)
        {
            if (summary.HasFinalAdditions && Math.Abs(actual - expected) > policy.KrwTolerance)
                AddSummaryNotEvaluated(code, actual, summary, findings, inputs);
            else
                AddSummaryFinding(code, expected, actual, summary, policy, findings, inputs);
        }

        private static bool CanTotalComponents(EstimateLine line)
        {
            return line.MaterialAmountKrw.HasValue && line.LaborAmountKrw.HasValue && line.ExpenseAmountKrw.HasValue ||
                   line.Quantity.HasValue && line.MaterialUnitPriceKrw.HasValue && line.LaborUnitPriceKrw.HasValue && line.ExpenseUnitPriceKrw.HasValue;
        }

        private static decimal ComponentAmount(EstimateLine line, decimal? sourceAmount, decimal? unitPrice)
        {
            return sourceAmount.HasValue ? sourceAmount.Value : decimal.Truncate(line.Quantity.Value * unitPrice.Value);
        }

        private static void AddSummaryFinding(string code, decimal expected, decimal actual, EstimateSummary summary, AuditPolicy policy, List<Finding> findings, string inputs)
        {
            decimal delta = actual - expected;
            int row;
            summary.SourceRows.TryGetValue(code, out row);
            findings.Add(WithEvidence(Note("R012", Math.Abs(delta) <= policy.KrwTolerance ? "PASS" : "FAIL", Math.Abs(delta) <= policy.KrwTolerance ? "INFO" : "ERROR", "SUMMARY-" + code, null, "KRW", expected, actual, delta, "원가계산서 비목 합계와 최종금액 산술을 대조했습니다."), "sheet=원가계산서;output-row=" + row + ";code=" + code + ";" + inputs));
        }

        private static string SummaryInputs(EstimateSummary summary, params string[] codes)
        {
            return "input-summary-rows=" + string.Join("|", codes.Where(summary.SourceRows.ContainsKey).Select(code => code + ":" + summary.SourceRows[code]));
        }

        private static void CheckCoverage(List<QtoRecord> qtoRows, List<EstimateLine> lines, List<Mapping> mappings, Dictionary<string, QtoRecord> qto, HashSet<string> invalidQtoIds, List<Finding> findings)
        {
            var lineById = lines.ToDictionary(x => x.Id);
            var duplicateMappings = new HashSet<string>(mappings.GroupBy(x => x.EstimateLineId + "\u001f" + x.QtoId).Where(x => x.Count() > 1).Select(x => x.Key));
            var valid = mappings.Where(mapping =>
            {
                EstimateLine line;
                QtoRecord record;
                return mapping.Multiplier > 0 && SupportedUnit(mapping.Unit) && !string.IsNullOrWhiteSpace(mapping.EstimateLineId) && !string.IsNullOrWhiteSpace(mapping.QtoId) &&
                    lineById.TryGetValue(mapping.EstimateLineId, out line) && line.Unit == mapping.Unit && qto.TryGetValue(mapping.QtoId, out record) &&
                    !invalidQtoIds.Contains(record.Id) && !duplicateMappings.Contains(mapping.EstimateLineId + "\u001f" + mapping.QtoId);
            }).ToList();
            var grouped = valid.GroupBy(x => x.QtoId).ToDictionary(x => x.Key, x => x.ToList());
            foreach (var record in qtoRows)
            {
                if (!grouped.ContainsKey(record.Id))
                    findings.Add(WithEvidence(Note("R022", "REVIEW", "INFO", null, record.Id, null, null, null, null, "승인된 내역 매핑이 없는 BIM 집계행입니다."), "qto=" + record.Id + ";row=" + record.SourceRow));
            }
            foreach (var group in grouped.Where(x => x.Value.Select(m => m.EstimateLineId).Distinct().Count() > 1))
                findings.Add(WithEvidence(Note("R023", "REVIEW", "INFO", string.Join("|", group.Value.Select(x => x.EstimateLineId).Distinct()), group.Key, null, null, null, null, "하나의 BIM 집계행이 여러 내역에 연결되었습니다. 배분 근거를 확인하십시오."), "qto=" + group.Key + ";mapping-rows=" + string.Join("|", group.Value.Select(x => x.SourceRow))));
        }

        private static void CheckAmount(EstimateLine line, AuditPolicy policy, List<Finding> findings)
        {
            if (!line.Quantity.HasValue || !line.AmountKrw.HasValue || HasNegativeValue(line))
            {
                findings.Add(WithEvidence(Note("R011", "NOT_EVALUATED", "INFO", line.Id, null, "KRW", null, line.AmountKrw, null, "수량·단가·금액 중 값이 없습니다."), "line=" + line.Id + ";row=" + line.SourceRow));
                return;
            }
            decimal expected;
            string componentEvidence = "";
            if (line.UseComponentTruncation)
            {
                if (!line.MaterialUnitPriceKrw.HasValue || !line.LaborUnitPriceKrw.HasValue || !line.ExpenseUnitPriceKrw.HasValue)
                {
                    findings.Add(WithEvidence(Note("R011", "NOT_EVALUATED", "INFO", line.Id, null, "KRW", null, line.AmountKrw, null, "EMS 구성단가 값이 없어 금액을 검산하지 못했습니다."), "line=" + line.Id + ";row=" + line.SourceRow));
                    return;
                }
                decimal expectedMaterial = decimal.Truncate(line.Quantity.Value * line.MaterialUnitPriceKrw.Value);
                decimal expectedLabor = decimal.Truncate(line.Quantity.Value * line.LaborUnitPriceKrw.Value);
                decimal expectedExpense = decimal.Truncate(line.Quantity.Value * line.ExpenseUnitPriceKrw.Value);
                expected = expectedMaterial + expectedLabor + expectedExpense;
                decimal?[] sourceComponents = { line.MaterialAmountKrw, line.LaborAmountKrw, line.ExpenseAmountKrw };
                decimal[] expectedComponents = { expectedMaterial, expectedLabor, expectedExpense };
                for (int componentIndex = 0; componentIndex < sourceComponents.Length; componentIndex++)
                {
                    if (sourceComponents[componentIndex].HasValue && Math.Abs(sourceComponents[componentIndex].Value - expectedComponents[componentIndex]) > policy.KrwTolerance)
                    {
                        decimal componentDelta = sourceComponents[componentIndex].Value - expectedComponents[componentIndex];
                        findings.Add(WithEvidence(Note("R011", "FAIL", "ERROR", line.Id, null, "KRW", expectedComponents[componentIndex], sourceComponents[componentIndex], componentDelta, "EMS 구성금액이 구성단가별 절사식과 일치하지 않습니다."), "line=" + line.Id + ";row=" + line.SourceRow + ";component=" + new[] { "material", "labor", "expense" }[componentIndex]));
                        return;
                    }
                }
                componentEvidence = ";expected-components=" + expectedMaterial + "|" + expectedLabor + "|" + expectedExpense + ";actual-components=" + line.MaterialAmountKrw + "|" + line.LaborAmountKrw + "|" + line.ExpenseAmountKrw;
                if (sourceComponents.All(x => x.HasValue))
                {
                    decimal componentTotal = sourceComponents.Sum(x => x.Value);
                    if (Math.Abs(line.AmountKrw.Value - componentTotal) > policy.KrwTolerance)
                    {
                        decimal componentDelta = line.AmountKrw.Value - componentTotal;
                        findings.Add(WithEvidence(Note("R011", "FAIL", "ERROR", line.Id, null, "KRW", componentTotal, line.AmountKrw, componentDelta, "EMS 총금액이 저장된 구성금액 합계와 일치하지 않습니다."), "line=" + line.Id + ";row=" + line.SourceRow + componentEvidence));
                        return;
                    }
                }
            }
            else if (line.UnitPriceKrw.HasValue) expected = Math.Round(line.Quantity.Value * line.UnitPriceKrw.Value, 0, MidpointRounding.AwayFromZero);
            else
            {
                findings.Add(WithEvidence(Note("R011", "NOT_EVALUATED", "INFO", line.Id, null, "KRW", null, line.AmountKrw, null, "단가 값이 없습니다."), "line=" + line.Id + ";row=" + line.SourceRow));
                return;
            }
            decimal delta = line.AmountKrw.Value - expected;
            findings.Add(WithEvidence(Note("R011", Math.Abs(delta) <= policy.KrwTolerance ? "PASS" : "FAIL", Math.Abs(delta) <= policy.KrwTolerance ? "INFO" : "ERROR", line.Id, null, "KRW", expected, line.AmountKrw, delta, line.UseComponentTruncation ? "금액 = 구성단가별 수량 곱의 절사 합계." : "금액 = 수량 × 단가."), "line=" + line.Id + ";row=" + line.SourceRow + componentEvidence));
        }

        private static void CheckUnitPrice(EstimateLine line, AuditPolicy policy, List<Finding> findings)
        {
            if (!line.UseComponentTruncation) return;
            if (!line.MaterialUnitPriceKrw.HasValue || !line.LaborUnitPriceKrw.HasValue || !line.ExpenseUnitPriceKrw.HasValue || !line.UnitPriceKrw.HasValue || HasNegativeValue(line))
            {
                findings.Add(WithEvidence(Note("R010", "NOT_EVALUATED", "INFO", line.Id, null, "KRW", null, line.UnitPriceKrw, null, "구성단가 또는 총단가 값이 없습니다."), "line=" + line.Id + ";row=" + line.SourceRow));
                return;
            }
            decimal expected = line.MaterialUnitPriceKrw.Value + line.LaborUnitPriceKrw.Value + line.ExpenseUnitPriceKrw.Value;
            decimal delta = line.UnitPriceKrw.Value - expected;
            findings.Add(WithEvidence(Note("R010", Math.Abs(delta) <= policy.KrwTolerance ? "PASS" : "FAIL", Math.Abs(delta) <= policy.KrwTolerance ? "INFO" : "ERROR", line.Id, null, "KRW", expected, line.UnitPriceKrw, delta, "총단가 = 재료단가 + 노무단가 + 경비단가."), "line=" + line.Id + ";row=" + line.SourceRow));
        }

        private static void CheckBimQuantity(EstimateLine line, List<Mapping> mappings, Dictionary<string, QtoRecord> qto, HashSet<string> invalidQtoIds, AuditPolicy policy, List<Finding> findings)
        {
            if (mappings.GroupBy(x => x.QtoId).Any(x => x.Count() > 1))
            {
                findings.Add(WithEvidence(Note("R020", "FAIL", "ERROR", line.Id, null, line.Unit, null, null, null, "같은 QTO 집계행이 두 번 이상 매핑되었습니다."), "line=" + line.Id + ";row=" + line.SourceRow + ";mapping-rows=" + string.Join("|", mappings.Select(x => x.SourceRow))));
                findings.Add(WithEvidence(Note("R021", "NOT_EVALUATED", "INFO", line.Id, null, line.Unit, null, line.Quantity, null, "매핑 유효성 오류로 수량 대조를 수행하지 않았습니다."), "line=" + line.Id + ";row=" + line.SourceRow));
                return;
            }
            var records = new List<QtoRecord>();
            foreach (var mapping in mappings)
            {
                QtoRecord record;
                if (mapping.Multiplier <= 0 || !SupportedUnit(mapping.Unit) || string.IsNullOrWhiteSpace(mapping.QtoId) || !qto.TryGetValue(mapping.QtoId, out record) || mapping.Unit != line.Unit || invalidQtoIds.Contains(record.Id))
                {
                    findings.Add(WithEvidence(Note("R020", "FAIL", "ERROR", line.Id, mapping.QtoId, mapping.Unit, null, null, null, "매핑·단위가 올바르지 않거나 QTO 추적 근거가 없습니다."), "line=" + line.Id + ";row=" + line.SourceRow + ";mapping-row=" + mapping.SourceRow));
                    findings.Add(WithEvidence(Note("R021", "NOT_EVALUATED", "INFO", line.Id, mapping.QtoId, line.Unit, null, line.Quantity, null, "매핑 유효성 오류로 수량 대조를 수행하지 않았습니다."), "line=" + line.Id + ";row=" + line.SourceRow + ";mapping-row=" + mapping.SourceRow));
                    return;
                }
                records.Add(record);
            }
            if (!line.Quantity.HasValue || line.Quantity.Value < 0)
            {
                findings.Add(WithEvidence(Note("R021", "NOT_EVALUATED", "INFO", line.Id, null, line.Unit, null, null, null, "내역 수량 값이 없습니다."), "line=" + line.Id + ";row=" + line.SourceRow));
                return;
            }
            decimal expected = 0;
            var qtoIds = new List<string>();
            for (int i = 0; i < mappings.Count; i++)
            {
                expected += records[i].Measure(mappings[i].Unit) * mappings[i].Multiplier;
                qtoIds.Add(records[i].Id);
            }
            decimal delta = line.Quantity.Value - expected;
            findings.Add(WithEvidence(Note("R021", Math.Abs(delta) <= policy.QuantityTolerance ? "PASS" : "FAIL", Math.Abs(delta) <= policy.QuantityTolerance ? "INFO" : "WARNING", line.Id, string.Join("|", qtoIds), line.Unit, expected, line.Quantity, delta, "내역 수량과 매핑된 BIM 수량을 대조했습니다."), "line=" + line.Id + ";row=" + line.SourceRow + ";qto-rows=" + string.Join("|", records.Select(x => x.SourceRow))));
        }

        private static bool SupportedUnit(string unit)
        {
            return unit == "EA" || unit == "m" || unit == "m2" || unit == "m3";
        }

        private static bool ValidQtoTraceability(QtoRecord row, out List<long> elementIds, out string error)
        {
            elementIds = new List<long>();
            error = null;
            if (row == null || row.Count <= 0m || row.Count != decimal.Truncate(row.Count) || row.Count != row.ElementIds.Count)
            {
                error = "QTO 수량은 요소ID 개수와 같은 1 이상의 정수여야 합니다.";
            }
            var local = new HashSet<long>();
            foreach (string raw in row.ElementIds)
            {
                long elementId;
                if (string.IsNullOrWhiteSpace(raw) || !long.TryParse(raw.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out elementId) || elementId <= 0)
                {
                    if (error == null) error = "요소ID는 행 안에서 중복되지 않는 양의 정수여야 합니다.";
                    continue;
                }
                elementIds.Add(elementId);
                if (!local.Add(elementId) && error == null)
                {
                    error = "요소ID는 행 안에서 중복되지 않는 양의 정수여야 합니다.";
                }
            }
            return error == null;
        }

        private static bool HasNegativeValue(EstimateLine line)
        {
            return (line.Quantity.HasValue && line.Quantity.Value < 0 && !IsValidAdjustment(line)) ||
                   (line.MaterialUnitPriceKrw.HasValue && line.MaterialUnitPriceKrw.Value < 0) ||
                   (line.LaborUnitPriceKrw.HasValue && line.LaborUnitPriceKrw.Value < 0) ||
                   (line.ExpenseUnitPriceKrw.HasValue && line.ExpenseUnitPriceKrw.Value < 0) ||
                   (line.MaterialAmountKrw.HasValue && line.MaterialAmountKrw.Value < 0 && !IsValidAdjustment(line)) ||
                   (line.LaborAmountKrw.HasValue && line.LaborAmountKrw.Value < 0 && !IsValidAdjustment(line)) ||
                   (line.ExpenseAmountKrw.HasValue && line.ExpenseAmountKrw.Value < 0 && !IsValidAdjustment(line)) ||
                   (line.UnitPriceKrw.HasValue && line.UnitPriceKrw.Value < 0) ||
                   (line.AmountKrw.HasValue && line.AmountKrw.Value < 0 && !IsValidAdjustment(line));
        }

        private static bool IsValidAdjustment(EstimateLine line)
        {
            return line.IsEmsSource && line.IsAdjustment && line.UseComponentTruncation && line.Quantity.HasValue && line.Quantity.Value < 0 && line.AmountKrw.HasValue && line.AmountKrw.Value < 0;
        }

        private static bool HasNegativeValue(QtoRecord row)
        {
            return row.Count < 0 || row.VolumeM3 < 0 || row.AreaM2 < 0 || row.LengthM < 0;
        }

        private static Finding Note(string rule, string status, string severity, string lineId, string qtoId, string unit, decimal? expected, decimal? actual, decimal? delta, string message)
        {
            return new Finding { Rule = rule, Status = status, Severity = severity, LineId = lineId, QtoId = qtoId, Unit = unit, Expected = expected, Actual = actual, Delta = delta, Evidence = "line=" + lineId + ";qto=" + (qtoId ?? ""), Message = message };
        }

        private static Finding WithEvidence(Finding finding, string evidence)
        {
            finding.Evidence = evidence;
            return finding;
        }
    }
}
