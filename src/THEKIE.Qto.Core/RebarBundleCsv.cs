using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace THEKIE.Qto.Core
{
    public static class RebarBundleCsv
    {
        private static readonly string[] LengthHeader = { "row_id", "spec", "signed_length_m", "source_id", "source_sha256", "revision", "sheet", "cell", "included_components" };
        private static readonly string[] RuleHeader = { "bundle_id", "version", "bundle_sha256", "bundle_rule_id", "bundle_source_ref", "approved_tolerance_kg", "tolerance_source_id", "tolerance_source_sha256", "tolerance_revision", "tolerance_sheet", "tolerance_cell", "spec", "unit_mass_kg_per_m", "unit_mass_source_id", "unit_mass_source_sha256", "unit_mass_revision", "unit_mass_sheet", "unit_mass_cell", "loss_rate", "loss_source_id", "loss_source_sha256", "loss_revision", "loss_sheet", "loss_cell", "rounding_stage", "rounding_mode", "rounding_scale", "rounding_source_id", "rounding_source_sha256", "rounding_revision", "rounding_sheet", "rounding_cell" };
        private static readonly string[] OfficialHeader = { "mass_kg", "source_id", "source_sha256", "revision", "sheet", "cell" };
        private static readonly string[] RegistryHeader = { "kind", "id", "sha256" };

        public static IReadOnlyList<RebarLengthRow> ReadLengths(string path)
        {
            List<string[]> rows = Read(path, LengthHeader, "rebar length");
            var result = new List<RebarLengthRow>();
            foreach (string[] row in rows.Skip(1))
            {
                if (!decimal.TryParse(row[2], NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out decimal length) || !Enum.TryParse(row[8], false, out RebarLengthComponent components)) throw new InvalidDataException("rebar length CSV 숫자 또는 component가 올바르지 않습니다.");
                result.Add(new RebarLengthRow { RowId = row[0], Spec = row[1], SignedLengthM = length, Source = Source(row, 3), IncludedComponents = components });
            }
            return result.AsReadOnly();
        }

        public static RebarRuleBundle ReadRules(string path)
        {
            List<string[]> rows = Read(path, RuleHeader, "rebar rule");
            if (rows.Count < 2) throw new InvalidDataException("rebar rule CSV에는 적어도 하나의 규격 규칙이 필요합니다.");
            string[] first = rows[1];
            var result = new RebarRuleBundle { BundleId = first[0], Version = first[1], Evidence = new StructuralRuleEvidence { RuleId = first[3], Sha256 = first[2], SourceRef = first[4] } };
            if (!decimal.TryParse(first[5], NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out decimal tolerance)) throw new InvalidDataException("rebar tolerance가 올바르지 않습니다.");
            result.ApprovedToleranceKg = tolerance; result.ToleranceSource = Source(first, 6);
            foreach (string[] row in rows.Skip(1))
            {
                if (row[0] != result.BundleId || row[1] != result.Version || row[2] != result.Evidence.Sha256 || row[3] != result.Evidence.RuleId || row[4] != result.Evidence.SourceRef || row[5] != first[5] || !SameSource(row, 6, first, 6)) throw new InvalidDataException("rebar rule bundle metadata가 모든 행에서 같아야 합니다.");
                if (!decimal.TryParse(row[12], NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out decimal unitMass) || !decimal.TryParse(row[18], NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out decimal loss) || !Enum.TryParse(row[24], false, out RebarRoundingStage stage) || !Enum.TryParse(row[25], false, out StructuralRoundingMode mode) || !int.TryParse(row[26], NumberStyles.None, CultureInfo.InvariantCulture, out int scale)) throw new InvalidDataException("rebar rule CSV 숫자 또는 enum이 올바르지 않습니다.");
                result.Specifications.Add(new RebarSpecificationRule { Spec = row[11], UnitMassKgPerM = unitMass, UnitMassSource = Source(row, 13), LossRate = loss, LossSource = Source(row, 19), RoundingStage = stage, RoundingMode = mode, RoundingScale = scale, RoundingSource = Source(row, 27) });
            }
            if (!string.Equals(result.Evidence.Sha256, RebarTakeoff.ComputeRuleHash(result), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("rebar rule bundle_sha256이 canonical 내용과 다릅니다.");
            return result;
        }

        public static RebarOfficialTarget ReadOfficial(string path)
        {
            List<string[]> rows = Read(path, OfficialHeader, "rebar official target");
            if (rows.Count != 2 || !decimal.TryParse(rows[1][0], NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out decimal mass)) throw new InvalidDataException("rebar official target CSV는 정확히 하나의 kg target이어야 합니다.");
            return new RebarOfficialTarget { MassKg = mass, Source = Source(rows[1], 1) };
        }

        public static StructuralEvidenceRegistry ReadRegistry(string path)
        {
            List<string[]> rows = Read(path, RegistryHeader, "rebar registry"); var result = new StructuralEvidenceRegistry();
            foreach (string[] row in rows.Skip(1))
            {
                if (!StructuralRuleEvidence.ValidSha(row[2]) || string.IsNullOrWhiteSpace(row[1])) throw new InvalidDataException("rebar registry ID/SHA가 올바르지 않습니다.");
                Dictionary<string, string> target = row[0] == "source" ? result.ApprovedSourceHashes : row[0] == "rule" ? result.ApprovedRuleHashes : throw new InvalidDataException("rebar registry kind는 source 또는 rule이어야 합니다.");
                if (target.ContainsKey(row[1])) throw new InvalidDataException("rebar registry ID가 중복됩니다."); target.Add(row[1], row[2]);
            }
            return result;
        }

        private static StructuralSourceEvidence Source(string[] row, int start) => new StructuralSourceEvidence { SourceId = row[start], Sha256 = row[start + 1], Revision = row[start + 2], Sheet = row[start + 3], Cell = row[start + 4] };
        private static bool SameSource(string[] left, int l, string[] right, int r) => Enumerable.Range(0, 5).All(i => left[l + i] == right[r + i]);
        private static List<string[]> Read(string path, string[] header, string label) { if (string.IsNullOrWhiteSpace(path) || !File.Exists(path) || !string.Equals(Path.GetExtension(path), ".csv", StringComparison.OrdinalIgnoreCase)) throw new FileNotFoundException(label + " CSV 파일을 찾을 수 없습니다.", path); List<string[]> rows = Csv.Read(path); if (rows.Count == 0 || !rows[0].SequenceEqual(header, StringComparer.Ordinal) || rows.Skip(1).Any(row => row.Length != header.Length)) throw new InvalidDataException(label + " CSV 계약이 올바르지 않습니다."); return rows; }
    }
}
