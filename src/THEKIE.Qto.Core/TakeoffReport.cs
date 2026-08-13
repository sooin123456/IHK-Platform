using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace THEKIE.Qto.Core
{
    public sealed class TakeoffReportArtifact
    {
        public string ReportPath { get; internal set; }
        public string ManifestPath { get; internal set; }
        public string ReportSha256 { get; internal set; }
    }

    public sealed class TakeoffReportRecord
    {
        public string RecordType { get; internal set; }
        public string Status { get; internal set; }
        public string SourceKind { get; internal set; }
        public string Building { get; internal set; }
        public string Floor { get; internal set; }
        public string Member { get; internal set; }
        public string Spec { get; internal set; }
        public decimal? RawM3 { get; internal set; }
        public decimal? DeductionM3 { get; internal set; }
        public decimal? AllowanceM3 { get; internal set; }
        public decimal? FinalM3 { get; internal set; }
        public string Formula { get; internal set; }
        public string RuleId { get; internal set; }
        public string RuleHash { get; internal set; }
        public string RuleSource { get; internal set; }
        public string SourceEvidence { get; internal set; }
        public string ElementIds { get; internal set; }
        public string Message { get; internal set; }
        public decimal? LeftM3 { get; internal set; }
        public decimal? RightM3 { get; internal set; }
        public decimal? DeltaM3 { get; internal set; }
    }

    public static class TakeoffReport
    {
        public const string FormatVersion = "CONCRETE_TAKEOFF_CSV_V1";
        private static readonly string[] Header = {
            "record_type", "status", "source_kind", "building", "floor", "member", "spec",
            "raw_m3", "deduction_m3", "allowance_m3", "final_m3", "formula", "rule_id", "rule_hash",
            "rule_source", "source_evidence", "element_ids", "message", "left_m3", "right_m3", "delta_m3"
        };

        public static TakeoffReportArtifact WriteBridge(string path, ConcreteLedgerBridgeResult result)
        {
            if (result == null) throw new ArgumentNullException("result");
            var records = new List<TakeoffReportRecord> {
                new TakeoffReportRecord {
                    RecordType = "BRIDGE_SUMMARY", Status = result.Status.ToString(), RawM3 = result.RawConcreteQuantityM3,
                    Message = "selected=" + result.SelectedConcreteCount.ToString(CultureInfo.InvariantCulture) +
                        ";excluded_unknown=" + result.ExcludedUnknownCount.ToString(CultureInfo.InvariantCulture) +
                        ";excluded_non_concrete=" + result.ExcludedNonConcreteCount.ToString(CultureInfo.InvariantCulture) + ";" + (result.Message ?? "")
                }
            };
            records.AddRange(result.Rows.Select(row => new TakeoffReportRecord {
                RecordType = "BRIDGE_ROW", Status = result.Status.ToString(), SourceKind = row.SourceKind.ToString(),
                Building = row.Building, Floor = row.Floor, Member = row.Member, Spec = row.Spec,
                RawM3 = row.SignedQuantityM3,
                DeductionM3 = row.Operation == StructuralQuantityOperation.Deduction ? row.SignedQuantityM3 : 0m,
                SourceEvidence = row.SourceEvidence == null ? "" : row.SourceEvidence.ToString(),
                ElementIds = string.Join("|", row.ElementIds), Message = result.Message
            }));
            return Write(path, records);
        }

        public static TakeoffReportArtifact WriteTakeoff(string path, ConcreteTakeoffResult result)
        {
            return WriteTakeoff(path, result, null);
        }

        public static TakeoffReportArtifact WriteTakeoff(string path, ConcreteTakeoffResult result, IDictionary<string, string> inputSha256)
        {
            if (result == null) throw new ArgumentNullException("result");
            List<TakeoffReportRecord> records = result.Rows.Select(row => new TakeoffReportRecord {
                RecordType = "TAKEOFF", Status = row.Status.ToString(), SourceKind = row.SourceKind.ToString(),
                Building = row.Building, Floor = row.Floor, Member = row.Member, Spec = row.Spec,
                RawM3 = row.RawQuantityM3, DeductionM3 = row.DeductionQuantityM3, AllowanceM3 = row.AllowanceQuantityM3,
                FinalM3 = row.FinalQuantityM3, Formula = row.Formula, RuleId = row.RuleId, RuleHash = row.RuleHash,
                RuleSource = row.RuleSource, SourceEvidence = row.Source, ElementIds = string.Join("|", row.ElementIds ?? new string[0]),
                Message = row.Message
            }).ToList();
            if (records.Count == 0) records.Add(new TakeoffReportRecord {
                RecordType = "TAKEOFF_SUMMARY", Status = result.Status.ToString(), Message = "selected_takeoff_rows=0"
            });
            return Write(path, records, inputSha256);
        }

        public static TakeoffReportArtifact WriteReconciliation(string path, ConcreteReconciliationResult result)
        {
            if (result == null) throw new ArgumentNullException("result");
            var records = result.Rows.Select(row => {
                string[] key = (row.CommonKey ?? "").Split(new[] { '\u001f' }, StringSplitOptions.None);
                return new TakeoffReportRecord {
                    RecordType = "RECONCILIATION", Status = row.Status.ToString(), SourceKind = "RECONCILIATION",
                    Building = At(key, 0), Floor = At(key, 1), Member = At(key, 2), Spec = At(key, 3),
                    RawM3 = row.LeftQuantityM3, FinalM3 = row.RightQuantityM3,
                    Formula = "right_m3-left_m3", LeftM3 = row.LeftQuantityM3, RightM3 = row.RightQuantityM3,
                    DeltaM3 = row.DeltaM3, Message = row.Message
                };
            }).ToList();
            records.Insert(0, new TakeoffReportRecord {
                RecordType = "RECONCILIATION_SUMMARY", Status = result.Status.ToString(), SourceKind = "RECONCILIATION",
                LeftM3 = result.LeftTotalM3, RightM3 = result.RightTotalM3, DeltaM3 = result.TotalDeltaM3,
                Formula = "SUM(delta_m3)=right_total-left_total", Message = "deltas_close=" + (result.DeltasClose ? "true" : "false") +
                    ";row_delta_sum=" + Number(result.RowDeltaSumM3)
            });
            return Write(path, records);
        }

        public static IReadOnlyList<TakeoffReportRecord> Read(string path)
        {
            List<string[]> rows = Csv.Read(path);
            if (rows.Count == 0 || !rows[0].SequenceEqual(Header, StringComparer.Ordinal))
                throw new InvalidDataException("콘크리트 report 헤더가 " + FormatVersion + " 계약과 다릅니다.");
            var result = new List<TakeoffReportRecord>();
            for (int index = 1; index < rows.Count; index++)
            {
                string[] row = rows[index];
                if (row.Length != Header.Length) throw new InvalidDataException((index + 1).ToString(CultureInfo.InvariantCulture) + "행 열 수가 올바르지 않습니다.");
                result.Add(new TakeoffReportRecord {
                    RecordType = Original(row[0]), Status = Original(row[1]), SourceKind = Original(row[2]),
                    Building = Original(row[3]), Floor = Original(row[4]), Member = Original(row[5]), Spec = Original(row[6]),
                    RawM3 = Decimal(row[7], "raw_m3", index + 1), DeductionM3 = Decimal(row[8], "deduction_m3", index + 1),
                    AllowanceM3 = Decimal(row[9], "allowance_m3", index + 1), FinalM3 = Decimal(row[10], "final_m3", index + 1),
                    Formula = Original(row[11]), RuleId = Original(row[12]), RuleHash = Original(row[13]), RuleSource = Original(row[14]),
                    SourceEvidence = Original(row[15]), ElementIds = Original(row[16]), Message = Original(row[17]),
                    LeftM3 = Decimal(row[18], "left_m3", index + 1), RightM3 = Decimal(row[19], "right_m3", index + 1),
                    DeltaM3 = Decimal(row[20], "delta_m3", index + 1)
                });
            }
            return result.AsReadOnly();
        }

        public static TakeoffReportArtifact Verify(string path)
        {
            string report = Path.GetFullPath(path);
            string manifest = report + ".manifest.csv";
            if (!File.Exists(report) || !File.Exists(manifest)) throw new FileNotFoundException("콘크리트 report bundle이 완전하지 않습니다.");
            List<string[]> rows = Csv.Read(manifest);
            if (rows.Count < 5 || rows[0].Length != 2 || rows[0][0] != "key" || rows[0][1] != "value")
                throw new InvalidDataException("콘크리트 report manifest 형식이 올바르지 않습니다.");
            var values = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (string[] row in rows.Skip(1))
                if (row.Length != 2 || values.ContainsKey(row[0])) throw new InvalidDataException("콘크리트 report manifest 키가 잘못되거나 중복됩니다.");
                else values.Add(row[0], row[1]);
            foreach (KeyValuePair<string, string> pair in values.Where(pair => pair.Key.StartsWith("input_", StringComparison.Ordinal)))
                if (!ValidSha(pair.Value)) throw new InvalidDataException("콘크리트 report 입력 SHA-256이 올바르지 않습니다: " + pair.Key);
            int count;
            string hash = RunManifest.Hash(report);
            IReadOnlyList<TakeoffReportRecord> reportRows = Read(report);
            if (reportRows.Any(row => row.RecordType == "TAKEOFF" || row.RecordType == "TAKEOFF_SUMMARY"))
            {
                string[] requiredInputs = { "export_manifest", "ifc", "qto", "element_ledger", "revit_mapping", "concrete_rules", "registry" };
                if (!requiredInputs.All(name => values.ContainsKey("input_" + name)) ||
                    values.Keys.Count(key => key.StartsWith("input_", StringComparison.Ordinal)) != requiredInputs.Length)
                    throw new InvalidDataException("콘크리트 TAKEOFF report에는 정확한 7개 입력 SHA-256이 필요합니다.");
            }
            ValidateSemantics(reportRows);
            string verifiedHash = RunManifest.Hash(report);
            if (!string.Equals(hash, verifiedHash, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("검증 중 콘크리트 report 내용이 변경되었습니다.");
            if (!values.TryGetValue("format_version", out string version) || version != FormatVersion ||
                !values.TryGetValue("report_file", out string file) || Original(file) != Path.GetFileName(report) ||
                !values.TryGetValue("report_sha256", out string expectedHash) || !string.Equals(expectedHash, hash, StringComparison.OrdinalIgnoreCase) ||
                !values.TryGetValue("row_count", out string rowCount) || !int.TryParse(rowCount, NumberStyles.None, CultureInfo.InvariantCulture, out count) || count != reportRows.Count)
                throw new InvalidDataException("콘크리트 report가 manifest의 버전·파일명·SHA-256·행 수와 일치하지 않습니다.");
            return new TakeoffReportArtifact { ReportPath = report, ManifestPath = manifest, ReportSha256 = hash };
        }

        private static void ValidateSemantics(IReadOnlyList<TakeoffReportRecord> rows)
        {
            if (rows.Count == 0) throw new InvalidDataException("콘크리트 report에 검증할 행이 없습니다.");
            foreach (TakeoffReportRecord row in rows)
            {
                StructuralQuantityStatus status;
                if (!Enum.TryParse(row.Status, false, out status) || !Enum.IsDefined(typeof(StructuralQuantityStatus), status))
                    throw new InvalidDataException("콘크리트 report에 정의되지 않은 status가 있습니다.");
                if (row.RecordType == "TAKEOFF" && status == StructuralQuantityStatus.PASS)
                {
                    if (!row.RawM3.HasValue || !row.DeductionM3.HasValue || !row.AllowanceM3.HasValue || !row.FinalM3.HasValue ||
                        string.IsNullOrWhiteSpace(row.Building) || string.IsNullOrWhiteSpace(row.Floor) || string.IsNullOrWhiteSpace(row.Member) ||
                        string.IsNullOrWhiteSpace(row.Spec) || string.IsNullOrWhiteSpace(row.Formula) || string.IsNullOrWhiteSpace(row.RuleId) ||
                        !ValidSha(row.RuleHash) || string.IsNullOrWhiteSpace(row.RuleSource) ||
                        (string.IsNullOrWhiteSpace(row.SourceEvidence) && string.IsNullOrWhiteSpace(row.ElementIds)))
                        throw new InvalidDataException("PASS TAKEOFF 행에는 수량·공식·승인 규칙·원본 근거가 모두 필요합니다.");
                }
                else if (row.RecordType == "RECONCILIATION" && status == StructuralQuantityStatus.PASS)
                {
                    if (!row.LeftM3.HasValue || !row.RightM3.HasValue || !row.DeltaM3.HasValue ||
                        row.DeltaM3.Value != row.RightM3.Value - row.LeftM3.Value || row.DeltaM3.Value != 0m)
                        throw new InvalidDataException("PASS RECONCILIATION 행은 좌우 수량과 차이 0이 정확히 일치해야 합니다.");
                }
                else if (row.RecordType == "RECONCILIATION_SUMMARY" && status == StructuralQuantityStatus.PASS &&
                    (!row.DeltaM3.HasValue || row.DeltaM3.Value != 0m))
                    throw new InvalidDataException("PASS RECONCILIATION summary의 총차는 0이어야 합니다.");
                else if (row.RecordType != "TAKEOFF" && row.RecordType != "TAKEOFF_SUMMARY" && row.RecordType != "BRIDGE_SUMMARY" && row.RecordType != "BRIDGE_ROW" &&
                    row.RecordType != "RECONCILIATION" && row.RecordType != "RECONCILIATION_SUMMARY")
                    throw new InvalidDataException("콘크리트 report에 정의되지 않은 record_type이 있습니다.");
            }
        }

        private static bool ValidSha(string value)
        {
            return value != null && value.Length == 64 && value.All(character =>
                character >= '0' && character <= '9' || character >= 'a' && character <= 'f' || character >= 'A' && character <= 'F');
        }

        private static TakeoffReportArtifact Write(string path, IEnumerable<TakeoffReportRecord> records, IDictionary<string, string> inputSha256 = null)
        {
            if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("콘크리트 report 경로가 없습니다.", "path");
            string report = Path.GetFullPath(path);
            string manifest = report + ".manifest.csv";
            if (File.Exists(report) || Directory.Exists(report) || File.Exists(manifest) || Directory.Exists(manifest))
                throw new IOException("기존 콘크리트 report 또는 manifest를 덮어쓰지 않습니다.");
            string parent = Path.GetDirectoryName(report);
            if (string.IsNullOrEmpty(parent)) throw new IOException("콘크리트 report 상위 폴더가 없습니다.");
            Directory.CreateDirectory(parent);
            RejectReparsePath(parent);
            string staging = Path.Combine(parent, "." + Path.GetFileName(report) + "." + Guid.NewGuid().ToString("N") + ".tmp");
            string stagedReport = Path.Combine(staging, Path.GetFileName(report));
            string stagedManifest = Path.Combine(staging, Path.GetFileName(manifest));
            var published = new List<string>();
            try
            {
                Directory.CreateDirectory(staging);
                List<TakeoffReportRecord> list = records.ToList();
                Csv.Write(stagedReport, new[] { Header }.Concat(list.Select(Fields)));
                string hash = RunManifest.Hash(stagedReport);
                var manifestRows = new List<string[]> {
                    new[] { "key", "value" }, new[] { "format_version", FormatVersion },
                    new[] { "report_file", Protect(Path.GetFileName(report)) }, new[] { "report_sha256", hash },
                    new[] { "row_count", list.Count.ToString(CultureInfo.InvariantCulture) }
                };
                if (inputSha256 != null)
                    foreach (KeyValuePair<string, string> pair in inputSha256.OrderBy(pair => pair.Key, StringComparer.Ordinal))
                    {
                        if (string.IsNullOrWhiteSpace(pair.Key) || pair.Key.Any(character => !(character >= 'a' && character <= 'z' || character >= '0' && character <= '9' || character == '_')) || !ValidSha(pair.Value))
                            throw new InvalidDataException("콘크리트 report 입력 증거 key 또는 SHA-256이 올바르지 않습니다.");
                        manifestRows.Add(new[] { "input_" + pair.Key, pair.Value });
                    }
                Csv.Write(stagedManifest, manifestRows);
                if (File.Exists(report) || Directory.Exists(report) || File.Exists(manifest) || Directory.Exists(manifest))
                    throw new IOException("게시 중 같은 이름의 결과가 생성되었습니다.");
                Publish(stagedReport, report, published);
                Publish(stagedManifest, manifest, published);
                return new TakeoffReportArtifact { ReportPath = report, ManifestPath = manifest, ReportSha256 = hash };
            }
            catch
            {
                foreach (string publishedPath in published) try { File.Delete(publishedPath); } catch { }
                throw;
            }
            finally { try { if (Directory.Exists(staging)) Directory.Delete(staging, true); } catch { } }
        }

        private static string[] Fields(TakeoffReportRecord row)
        {
            return new[] {
                Protect(row.RecordType), Protect(row.Status), Protect(row.SourceKind), Protect(row.Building), Protect(row.Floor),
                Protect(row.Member), Protect(row.Spec), Number(row.RawM3), Number(row.DeductionM3), Number(row.AllowanceM3),
                Number(row.FinalM3), Protect(row.Formula), Protect(row.RuleId), Protect(row.RuleHash), Protect(row.RuleSource),
                Protect(row.SourceEvidence), Protect(row.ElementIds), Protect(row.Message), Number(row.LeftM3), Number(row.RightM3), Number(row.DeltaM3)
            };
        }

        private static string Number(decimal? value) { return value.HasValue ? value.Value.ToString(CultureInfo.InvariantCulture) : ""; }

        private static decimal? Decimal(string value, string field, int row)
        {
            if (string.IsNullOrEmpty(value)) return null;
            decimal parsed;
            if (!decimal.TryParse(value, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out parsed))
                throw new InvalidDataException(row.ToString(CultureInfo.InvariantCulture) + "행 " + field + "가 lossless decimal 형식이 아닙니다.");
            return parsed;
        }

        private static string Protect(string value)
        {
            value = value ?? "";
            int index = FirstText(value);
            if (index < value.Length && value[index] == '\'') return value.Insert(index, "'");
            return Csv.SpreadsheetText(value);
        }

        private static string Original(string value)
        {
            value = value ?? "";
            int index = FirstText(value);
            if (index >= value.Length || value[index] != '\'' || index + 1 >= value.Length) return value;
            char next = value[index + 1];
            return next == '\'' || next == '=' || next == '+' || next == '-' || next == '@' ? value.Remove(index, 1) : value;
        }

        private static int FirstText(string value)
        {
            int index = 0;
            while (index < value.Length && (value[index] == ' ' || value[index] == '\t' || value[index] == '\r' || value[index] == '\n')) index++;
            return index;
        }

        private static string At(string[] values, int index) { return index < values.Length ? values[index] : ""; }

        private static void Publish(string sourcePath, string finalPath, ICollection<string> published)
        {
            bool created = false;
            try
            {
                using (var source = File.OpenRead(sourcePath))
                using (var destination = new FileStream(finalPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    created = true;
                    source.CopyTo(destination);
                    destination.Flush(true);
                }
                published.Add(finalPath);
                File.Delete(sourcePath);
            }
            catch
            {
                if (created) try { File.Delete(finalPath); } catch { }
                throw;
            }
        }

        private static void RejectReparsePath(string path)
        {
            string parent = Path.GetFullPath(path);
            if ((File.GetAttributes(parent) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("콘크리트 report 상위 폴더는 심볼릭 링크일 수 없습니다: " + parent);
        }
    }
}
