using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace Lukas.Qto.Core
{
    // Strict interchange for approved, content-addressed Revit mapping and allowance bundles.
    public static class ConcreteBundleCsv
    {
        private static readonly string[] MappingHeader = { "bundle_id", "version", "bundle_sha256", "source_ref", "category", "family", "type", "decision", "building", "member", "spec" };
        private static readonly string[] RuleHeader = { "bundle_id", "version", "bundle_sha256", "source_ref", "spec", "allowance_rate", "application_basis", "deduction_timing", "rounding_mode", "rounding_scale" };
        private static readonly string[] RegistryHeader = { "kind", "bundle_id", "version", "sha256" };

        public static RevitConcreteMappingBundle ReadRevitMapping(string path)
        {
            List<string[]> rows = Read(path, MappingHeader, "Revit mapping");
            if (rows.Count < 2) throw new InvalidDataException("Revit mapping CSV에는 적어도 하나의 정확 매핑 규칙이 필요합니다.");
            RevitConcreteMappingBundle result = MappingMeta(rows[1]);
            foreach (string[] row in rows.Skip(1))
            {
                SameMeta(result.BundleId, result.Version, result.Sha256, result.SourceRef, row, "Revit mapping");
                if (!Enum.TryParse(row[7], false, out RevitConcreteMappingDecision decision) || !Enum.IsDefined(typeof(RevitConcreteMappingDecision), decision))
                    throw new InvalidDataException("Revit mapping decision은 Include 또는 Exclude여야 합니다.");
                result.Rules.Add(new RevitConcreteMappingRule { Category = row[4], Family = row[5], Type = row[6], Decision = decision, Building = row[8], Member = row[9], Spec = row[10] });
            }
            if (!string.Equals(result.Sha256, ConcreteTakeoff.ComputeRevitMappingHash(result), StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Revit mapping CSV의 bundle_sha256이 canonical 내용과 다릅니다.");
            return result;
        }

        public static ConcreteRuleBundle ReadConcreteRules(string path)
        {
            List<string[]> rows = Read(path, RuleHeader, "concrete rule");
            if (rows.Count < 2) throw new InvalidDataException("콘크리트 rule CSV에는 적어도 하나의 규칙이 필요합니다.");
            ConcreteRuleBundle result = new ConcreteRuleBundle { BundleId = rows[1][0], Version = rows[1][1], Sha256 = rows[1][2], SourceRef = rows[1][3] };
            foreach (string[] row in rows.Skip(1))
            {
                SameMeta(result.BundleId, result.Version, result.Sha256, result.SourceRef, row, "concrete rule");
                decimal rate;
                int? scale = null;
                if (!decimal.TryParse(row[5], NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out rate) ||
                    !Enum.TryParse(row[6], false, out ConcreteAllowanceBasis basis) || !Enum.TryParse(row[7], false, out ConcreteDeductionTiming timing) || !Enum.TryParse(row[8], false, out StructuralRoundingMode rounding) ||
                    (!string.IsNullOrEmpty(row[9]) && (!int.TryParse(row[9], NumberStyles.None, CultureInfo.InvariantCulture, out int parsedScale) || (scale = parsedScale) == null)))
                    throw new InvalidDataException("콘크리트 rule CSV 숫자 또는 enum 값이 올바르지 않습니다.");
                result.Rules.Add(new ConcreteAllowanceRule { Spec = row[4], AllowanceRate = rate, ApplicationBasis = basis, DeductionTiming = timing, RoundingMode = rounding, RoundingScale = scale });
            }
            if (!string.Equals(result.Sha256, ConcreteTakeoff.ComputeRuleHash(result), StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("콘크리트 rule CSV의 bundle_sha256이 canonical 내용과 다릅니다.");
            return result;
        }

        public static ConcreteRuleRegistry ReadRegistry(string path)
        {
            List<string[]> rows = Read(path, RegistryHeader, "registry");
            var result = new ConcreteRuleRegistry();
            foreach (string[] row in rows.Skip(1))
            {
                if (!StructuralRuleEvidence.ValidSha(row[3])) throw new InvalidDataException("registry sha256은 64자리 hex여야 합니다.");
                string key = ConcreteRuleRegistry.BundleKey(row[1], row[2]);
                Dictionary<string, string> target;
                if (row[0] == "revit_mapping") target = result.ApprovedRevitMappingHashes;
                else if (row[0] == "concrete_rules") target = result.ApprovedHashes;
                else throw new InvalidDataException("registry kind는 revit_mapping 또는 concrete_rules여야 합니다.");
                if (string.IsNullOrWhiteSpace(row[1]) || string.IsNullOrWhiteSpace(row[2]) || target.ContainsKey(key)) throw new InvalidDataException("registry bundle key가 비었거나 중복됩니다.");
                target.Add(key, row[3]);
            }
            return result;
        }

        private static RevitConcreteMappingBundle MappingMeta(string[] row)
        {
            return new RevitConcreteMappingBundle { BundleId = row[0], Version = row[1], Sha256 = row[2], SourceRef = row[3] };
        }

        private static void SameMeta(string id, string version, string sha, string source, string[] row, string label)
        {
            if (row[0] != id || row[1] != version || row[2] != sha || row[3] != source) throw new InvalidDataException(label + " CSV의 bundle metadata가 모든 행에서 정확히 같아야 합니다.");
        }

        private static List<string[]> Read(string path, string[] header, string label)
        {
            if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) throw new FileNotFoundException(label + " CSV 파일을 찾을 수 없습니다.", path);
            if (!string.Equals(Path.GetExtension(path), ".csv", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException(label + "은 CSV만 허용합니다.");
            List<string[]> rows = Csv.Read(path);
            if (rows.Count == 0 || !rows[0].SequenceEqual(header, StringComparer.Ordinal) || rows.Skip(1).Any(row => row.Length != header.Length)) throw new InvalidDataException(label + " CSV header 또는 열 수가 계약과 다릅니다.");
            return rows;
        }
    }
}
