using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;

namespace Lukas.Qto.Core
{
    public sealed class SourceGateResult
    {
        private readonly Dictionary<string, string> selectedSourceIds = new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly List<Finding> findings = new List<Finding>();
        private bool passed;

        public string SelectedScopeId { get; internal set; }
        public IReadOnlyDictionary<string, string> SelectedSourceIds { get { return new ReadOnlyDictionary<string, string>(selectedSourceIds); } }
        public IReadOnlyList<Finding> Findings { get { return findings.AsReadOnly(); } }
        public bool Passed { get { return passed; } }

        internal void Select(string slot, string sourceId) { selectedSourceIds.Add(slot, sourceId); }
        internal void Add(Finding finding) { findings.Add(finding); }
        internal void Finish() { passed = findings.Count >= 5 && findings.All(x => x.Status != "FAIL"); }
    }

    public static class SourceGate
    {
        private static readonly string[] PreflightSlots = { "qto", "estimate", "mapping" };
        private static readonly string[] ProjectSlots = { "ifc", "qto", "estimate", "mapping" };
        private static readonly string[] TemplateSlots = { "qto", "estimate" };

        public static SourceGateResult Run(string manifestPath, string qtoPath, string estimatePath, string mappingPath)
        {
            return RunWithHashes(manifestPath, qtoPath, estimatePath, mappingPath, null, null, null);
        }

        public static SourceGateResult RunWithHashes(string manifestPath, string qtoPath, string estimatePath, string mappingPath, string qtoHash, string estimateHash, string mappingHash)
        {
            return RunInternal(manifestPath,
                new Dictionary<string, string>(StringComparer.Ordinal) { { "qto", qtoPath }, { "estimate", estimatePath }, { "mapping", mappingPath } },
                new Dictionary<string, string>(StringComparer.Ordinal) { { "qto", qtoHash }, { "estimate", estimateHash }, { "mapping", mappingHash } }, PreflightSlots);
        }

        public static SourceGateResult RunProject(string manifestPath, string ifcPath, string qtoPath, string estimatePath, string mappingPath)
        {
            return RunProjectWithHashes(manifestPath, ifcPath, qtoPath, estimatePath, mappingPath, null, null, null, null);
        }

        public static SourceGateResult RunProjectWithHashes(string manifestPath, string ifcPath, string qtoPath, string estimatePath, string mappingPath, string ifcHash, string qtoHash, string estimateHash, string mappingHash)
        {
            return RunInternal(manifestPath,
                new Dictionary<string, string>(StringComparer.Ordinal) { { "ifc", ifcPath }, { "qto", qtoPath }, { "estimate", estimatePath }, { "mapping", mappingPath } },
                new Dictionary<string, string>(StringComparer.Ordinal) { { "ifc", ifcHash }, { "qto", qtoHash }, { "estimate", estimateHash }, { "mapping", mappingHash } }, ProjectSlots);
        }

        public static SourceGateResult RunMappingTemplate(string manifestPath, string qtoPath, string estimatePath)
        {
            return RunMappingTemplateWithHashes(manifestPath, qtoPath, estimatePath, null, null);
        }

        public static SourceGateResult RunMappingTemplateWithHashes(string manifestPath, string qtoPath, string estimatePath, string qtoHash, string estimateHash)
        {
            return RunInternal(manifestPath,
                new Dictionary<string, string>(StringComparer.Ordinal) { { "qto", qtoPath }, { "estimate", estimatePath } },
                new Dictionary<string, string>(StringComparer.Ordinal) { { "qto", qtoHash }, { "estimate", estimateHash } }, TemplateSlots);
        }

        private static SourceGateResult RunInternal(string manifestPath, IDictionary<string, string> selectedPaths, IDictionary<string, string> frozenHashes, string[] requiredSlots)
        {
            var result = new SourceGateResult();
            SourceManifestDocument manifest;
            try { manifest = SourceManifest.Read(manifestPath); }
            catch (Exception ex)
            {
                result.Add(Note("S001", "FAIL", "ERROR", "소스 매니페스트를 읽지 못했습니다: " + ex.Message, "manifest=" + (manifestPath ?? "")));
                result.Add(Note("S002", "NOT_EVALUATED", "INFO", "매니페스트 오류로 선택 소스를 확인하지 못했습니다.", ""));
                result.Add(Note("S003", "NOT_EVALUATED", "INFO", "매니페스트 오류로 범위를 확인하지 못했습니다.", ""));
                result.Add(Note("S004", "NOT_EVALUATED", "INFO", "매니페스트 오류로 개정을 확인하지 못했습니다.", ""));
                result.Add(Note("S005", "NOT_EVALUATED", "INFO", "매니페스트 오류로 수식 원본성을 확인하지 못했습니다.", ""));
                if (requiredSlots.Contains("ifc")) result.Add(Note("S006", "NOT_EVALUATED", "INFO", "매니페스트 오류로 IFC-QTO provenance를 확인하지 못했습니다.", ""));
                result.Finish();
                return result;
            }

            result.Add(manifest.IntegrityErrors.Count == 0
                ? Note("S001", "PASS", "INFO", "소스 매니페스트와 파일 SHA-256을 확인했습니다.", "manifest=" + manifest.ManifestPath)
                : Note("S001", "FAIL", "ERROR", string.Join(" | ", manifest.IntegrityErrors), "manifest=" + manifest.ManifestPath));

            var selectionErrors = new List<string>();
            var selectedEntries = new Dictionary<string, SourceManifestEntry>(StringComparer.Ordinal);
            foreach (string slot in requiredSlots)
            {
                string selectedPath;
                if (selectedPaths == null || !selectedPaths.TryGetValue(slot, out selectedPath) || string.IsNullOrWhiteSpace(selectedPath) || !File.Exists(selectedPath))
                {
                    selectionErrors.Add(slot + " 선택 파일이 없습니다.");
                    continue;
                }
                string hash;
                try { hash = SourceManifest.HashFile(selectedPath); }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is ArgumentException || ex is NotSupportedException)
                {
                    selectionErrors.Add(slot + " 선택 파일을 읽지 못했습니다: " + ex.Message);
                    continue;
                }
                string frozenHash;
                if (frozenHashes != null && frozenHashes.TryGetValue(slot, out frozenHash) && !string.IsNullOrWhiteSpace(frozenHash) && !string.Equals(hash, frozenHash, StringComparison.OrdinalIgnoreCase))
                {
                    selectionErrors.Add(slot + " 선택 파일이 사전 해시 이후 변경되었습니다.");
                    continue;
                }
                var matches = manifest.Entries.Where(x => string.Equals(x.Sha256, hash, StringComparison.OrdinalIgnoreCase)).ToList();
                if (matches.Count != 1)
                {
                    selectionErrors.Add(slot + " 선택 파일의 SHA-256과 일치하는 매니페스트 행이 " + matches.Count + "개입니다.");
                    continue;
                }
                SourceManifestEntry entry = matches[0];
                if (entry.Slot != slot)
                {
                    selectionErrors.Add(slot + " 선택 파일이 매니페스트에서는 " + entry.Slot + " slot입니다.");
                    continue;
                }
                selectedEntries.Add(slot, entry);
                result.Select(slot, entry.SourceId);
            }

            result.Add(selectionErrors.Count == 0
                ? Note("S002", "PASS", "INFO", "필수 선택 파일을 SHA-256과 slot으로 확인했습니다.", SelectedEvidence(result))
                : Note("S002", "FAIL", "ERROR", string.Join(" | ", selectionErrors), SelectedEvidence(result)));

            string[] scopes = selectedEntries.Values.Select(x => x.ScopeId).Distinct(StringComparer.Ordinal).OrderBy(x => x, StringComparer.Ordinal).ToArray();
            if (selectionErrors.Count > 0)
                result.Add(Note("S003", "NOT_EVALUATED", "INFO", "선택 소스 오류로 공사 범위를 확인하지 못했습니다.", ScopeEvidence(selectedEntries)));
            else if (scopes.Length == 1)
            {
                result.SelectedScopeId = scopes[0];
                result.Add(Note("S003", "PASS", "INFO", "선택 소스의 scope_id가 일치합니다.", "scope_id=" + scopes[0]));
            }
            else result.Add(Note("S003", "FAIL", "ERROR", "서로 다른 공사 범위의 소스를 함께 사용할 수 없습니다.", "scope_id=" + string.Join("|", scopes)));

            var revisionErrors = new List<string>();
            if (selectionErrors.Count == 0)
            {
                foreach (string key in selectedEntries.Values.Select(x => SourceManifest.GroupKey(x.ScopeId, x.Slot)).Distinct(StringComparer.Ordinal))
                {
                    List<string> groupErrors;
                    if (manifest.RevisionErrorsByGroup.TryGetValue(key, out groupErrors)) revisionErrors.AddRange(groupErrors);
                }
                foreach (var pair in selectedEntries.OrderBy(x => x.Key, StringComparer.Ordinal))
                    if (pair.Value.Status != "ACTIVE") revisionErrors.Add(pair.Key + " 선택 소스는 ACTIVE가 아닙니다: " + pair.Value.SourceId + "/" + pair.Value.Status + ".");
            }
            if (selectionErrors.Count > 0)
                result.Add(Note("S004", "NOT_EVALUATED", "INFO", "선택 소스 오류로 활성 개정을 확인하지 못했습니다.", SelectedEvidence(result)));
            else if (revisionErrors.Count > 0)
                result.Add(Note("S004", "FAIL", "ERROR", string.Join(" | ", revisionErrors.Distinct()), SelectedEvidence(result)));
            else result.Add(Note("S004", "PASS", "INFO", "선택 소스가 각 범위와 slot의 유일한 최신 ACTIVE 개정입니다.", SelectedEvidence(result)));

            bool prerequisitesPassed = selectionErrors.Count == 0 && scopes.Length == 1 && revisionErrors.Count == 0 && manifest.IntegrityErrors.Count == 0;
            AddFormulaFinding(result, manifest, selectedEntries, prerequisitesPassed);
            if (requiredSlots.Contains("ifc")) AddIfcProvenanceFinding(result, selectedEntries, prerequisitesPassed);
            result.Finish();
            return result;
        }

        private static void AddIfcProvenanceFinding(SourceGateResult result, Dictionary<string, SourceManifestEntry> selectedEntries, bool prerequisitesPassed)
        {
            SourceManifestEntry ifc;
            SourceManifestEntry qto;
            if (!prerequisitesPassed || !selectedEntries.TryGetValue("ifc", out ifc) || !selectedEntries.TryGetValue("qto", out qto))
            {
                result.Add(Note("S006", "NOT_EVALUATED", "INFO", "선행 소스 검증 오류로 IFC-QTO provenance를 확인하지 못했습니다.", ""));
                return;
            }
            bool linked = qto.RelatedSourceId == ifc.SourceId && qto.ScopeId == ifc.ScopeId && qto.Revision == ifc.Revision;
            result.Add(linked
                ? Note("S006", "PASS", "INFO", "소스 매니페스트에서 QTO가 선택 IFC와 같은 범위·개정으로 연결되어 있습니다. 같은 export run의 증명은 원본 export-manifest 해시 검증이 필요합니다.", "ifc:" + ifc.SourceId + "->qto:" + qto.SourceId)
                : Note("S006", "FAIL", "ERROR", "QTO related_source_id가 선택 IFC를 가리켜야 하며 scope_id와 revision이 같아야 합니다.", "ifc:" + ifc.SourceId + "|qto:" + qto.SourceId + "|related:" + qto.RelatedSourceId));
        }

        private static void AddFormulaFinding(SourceGateResult result, SourceManifestDocument manifest, Dictionary<string, SourceManifestEntry> selectedEntries, bool prerequisitesPassed)
        {
            if (!prerequisitesPassed)
            {
                result.Add(Note("S005", "NOT_EVALUATED", "INFO", "선행 소스 검증 오류로 수식 원본성을 확인하지 못했습니다.", ""));
                return;
            }
            var selectedGroups = new HashSet<string>(selectedEntries.Values.Select(x => SourceManifest.GroupKey(x.ScopeId, x.Slot)), StringComparer.Ordinal);
            var claims = manifest.Entries.Where(x => selectedGroups.Contains(SourceManifest.GroupKey(x.ScopeId, x.Slot)) && (x.Status == "DERIVATIVE" || x.Status == "REFERENCE") && !string.IsNullOrEmpty(x.RelatedSourceId)).OrderBy(x => x.SourceId, StringComparer.Ordinal).ToList();
            if (claims.Count == 0)
            {
                result.Add(Note("S005", "PASS", "INFO", "검증할 수식 파생·동등본 관계가 없습니다.", ""));
                return;
            }
            var byId = manifest.Entries.GroupBy(x => x.SourceId, StringComparer.Ordinal).Where(x => x.Count() == 1).ToDictionary(x => x.Key, x => x.Single(), StringComparer.Ordinal);
            var failures = new List<string>();
            var evidence = new List<string>();
            foreach (SourceManifestEntry claim in claims)
            {
                SourceManifestEntry origin;
                if (!byId.TryGetValue(claim.RelatedSourceId, out origin) || string.IsNullOrEmpty(claim.ResolvedPath) || string.IsNullOrEmpty(origin.ResolvedPath))
                {
                    failures.Add(claim.SourceId + ": 비교할 원본 파일이 없습니다.");
                    continue;
                }
                if (!string.Equals(Path.GetExtension(claim.ResolvedPath), ".xlsx", StringComparison.OrdinalIgnoreCase) || !string.Equals(Path.GetExtension(origin.ResolvedPath), ".xlsx", StringComparison.OrdinalIgnoreCase))
                {
                    failures.Add(claim.SourceId + ": related_source_id를 사용한 DERIVATIVE·REFERENCE 관계는 XLSX만 허용합니다.");
                    continue;
                }
                try
                {
                    string claimBefore = SourceManifest.HashFile(claim.ResolvedPath);
                    string originBefore = SourceManifest.HashFile(origin.ResolvedPath);
                    if (!string.Equals(claimBefore, claim.Sha256, StringComparison.OrdinalIgnoreCase) || !string.Equals(originBefore, origin.Sha256, StringComparison.OrdinalIgnoreCase))
                    {
                        failures.Add(claim.SourceId + ": 수식 비교 전에 파일 SHA-256이 변경되었습니다.");
                        continue;
                    }
                    FormulaComparison comparison = FormulaProvenance.Compare(claim.ResolvedPath, origin.ResolvedPath);
                    string claimAfter = SourceManifest.HashFile(claim.ResolvedPath);
                    string originAfter = SourceManifest.HashFile(origin.ResolvedPath);
                    if (!string.Equals(claimBefore, claimAfter, StringComparison.OrdinalIgnoreCase) || !string.Equals(originBefore, originAfter, StringComparison.OrdinalIgnoreCase))
                    {
                        failures.Add(claim.SourceId + ": 수식 비교 중 파일이 변경되었습니다.");
                        continue;
                    }
                    evidence.Add(claim.SourceId + "->" + origin.SourceId + ":" + comparison.Classification + ":sheets=" + comparison.DerivativeCoreSheetCount + "/" + comparison.OriginCoreSheetCount + ":values=" + comparison.DerivativeValueCount + "/" + comparison.OriginValueCount + ":formulas=" + comparison.DerivativeFormulaCount + "/" + comparison.OriginFormulaCount + ":unresolved=" + comparison.DerivativeUnresolvedSharedFormulaCount + "/" + comparison.OriginUnresolvedSharedFormulaCount);
                    string expected = claim.Status == "DERIVATIVE" ? "FLATTENED_DERIVATIVE" : "EXACT_EQUIVALENT";
                    if (comparison.Classification != expected)
                        failures.Add(claim.SourceId + ": 선언 " + claim.Status + "과 실제 수식 관계 " + comparison.Classification + "가 다릅니다.");
                }
                catch (Exception ex)
                {
                    failures.Add(claim.SourceId + ": 수식 관계를 읽지 못했습니다: " + ex.Message);
                }
            }
            if (failures.Count > 0)
                result.Add(Note("S005", "FAIL", "ERROR", string.Join(" | ", failures), string.Join(" | ", evidence)));
            else result.Add(Note("S005", "PASS", "INFO", "선언된 수식 파생·동등본 관계를 확인했습니다.", string.Join(" | ", evidence)));
        }

        private static Finding Note(string rule, string status, string severity, string message, string evidence)
        {
            return new Finding { Rule = rule, Status = status, Severity = severity, LineId = "SOURCE", Evidence = evidence, Message = message };
        }

        private static string SelectedEvidence(SourceGateResult result)
        {
            return "selected=" + string.Join("|", result.SelectedSourceIds.OrderBy(x => x.Key, StringComparer.Ordinal).Select(x => x.Key + ":" + x.Value));
        }

        private static string ScopeEvidence(Dictionary<string, SourceManifestEntry> selected)
        {
            return "scope_id=" + string.Join("|", selected.Values.Select(x => x.ScopeId).Distinct(StringComparer.Ordinal).OrderBy(x => x, StringComparer.Ordinal));
        }
    }
}
