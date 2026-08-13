using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;

namespace THEKIE.Qto.Core
{
    public sealed class SourceManifestEntry
    {
        public string SourceId { get; internal set; }
        public string Path { get; internal set; }
        public string Sha256 { get; internal set; }
        public string Slot { get; internal set; }
        public string ScopeId { get; internal set; }
        public int Revision { get; internal set; }
        public string Status { get; internal set; }
        public string RelatedSourceId { get; internal set; }
        public int SourceRow { get; internal set; }
        internal string ResolvedPath { get; set; }
    }

    public sealed class SourceManifestDocument
    {
        public string ManifestPath { get; internal set; }
        public List<SourceManifestEntry> Entries { get; } = new List<SourceManifestEntry>();
        public List<string> IntegrityErrors { get; } = new List<string>();
        public List<string> RevisionErrors { get; } = new List<string>();
        internal Dictionary<string, List<string>> RevisionErrorsByGroup { get; } = new Dictionary<string, List<string>>(StringComparer.Ordinal);
    }

    public static class SourceManifest
    {
        private static readonly string[] Headers = { "source_id", "path", "sha256", "slot", "scope_id", "revision", "status", "related_source_id" };
        private static readonly HashSet<string> Slots = new HashSet<string>(new[] { "ifc", "qto", "estimate", "mapping" }, StringComparer.Ordinal);
        private static readonly HashSet<string> Statuses = new HashSet<string>(new[] { "ACTIVE", "SUPERSEDED", "DERIVATIVE", "UNRESOLVED", "REFERENCE" }, StringComparer.Ordinal);

        public static SourceManifestDocument Read(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("소스 매니페스트 경로가 없습니다.", "path");
            string manifestPath = System.IO.Path.GetFullPath(path);
            string manifestDirectory = System.IO.Path.GetDirectoryName(manifestPath) ?? Directory.GetCurrentDirectory();
            if (IsReparsePoint(manifestPath) || IsReparsePoint(manifestDirectory)) throw new FormatException("소스 매니페스트 파일과 기준 폴더는 심볼릭 링크일 수 없습니다.");
            var rows = Csv.Read(manifestPath);
            if (rows.Count == 0) throw new FormatException("소스 매니페스트가 비어 있습니다.");
            var index = HeaderIndex(rows[0]);
            var result = new SourceManifestDocument { ManifestPath = manifestPath };

            for (int rowIndex = 1; rowIndex < rows.Count; rowIndex++)
            {
                string[] row = rows[rowIndex];
                if (row.All(string.IsNullOrWhiteSpace)) continue;
                int rowNumber = rowIndex + 1;
                if (row.Length != Headers.Length) result.IntegrityErrors.Add(rowNumber + "행: 열 수가 " + Headers.Length + "개가 아닙니다.");
                var entry = new SourceManifestEntry
                {
                    SourceId = Value(row, index["source_id"]),
                    Path = Value(row, index["path"]),
                    Sha256 = Value(row, index["sha256"]).ToLowerInvariant(),
                    Slot = Value(row, index["slot"]),
                    ScopeId = Value(row, index["scope_id"]),
                    Status = Value(row, index["status"]),
                    RelatedSourceId = Value(row, index["related_source_id"]),
                    SourceRow = rowNumber
                };
                int revision;
                string revisionText = Value(row, index["revision"]);
                if (!int.TryParse(revisionText, NumberStyles.None, CultureInfo.InvariantCulture, out revision) || revision <= 0)
                    result.IntegrityErrors.Add(rowNumber + "행: revision은 양의 정수여야 합니다.");
                else entry.Revision = revision;
                ValidateFields(entry, result.IntegrityErrors);
                result.Entries.Add(entry);
            }

            ValidateUniqueness(result);
            ValidateFiles(result);
            ValidateRevisions(result);
            return result;
        }

        internal static bool IsSlot(string value) { return Slots.Contains(value); }

        internal static string HashFile(string path)
        {
            using (var stream = File.OpenRead(path))
            using (var sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        }

        private static Dictionary<string, int> HeaderIndex(string[] header)
        {
            if (!header.SequenceEqual(Headers, StringComparer.Ordinal))
                throw new FormatException("소스 매니페스트 헤더는 다음 8개 열이어야 합니다: " + string.Join(",", Headers));
            return Headers.ToDictionary(x => x, x => Array.IndexOf(header, x), StringComparer.Ordinal);
        }

        private static string Value(string[] row, int index)
        {
            return index < row.Length ? (row[index] ?? "").Trim() : "";
        }

        private static void ValidateFields(SourceManifestEntry entry, List<string> errors)
        {
            string prefix = entry.SourceRow + "행: ";
            if (!ValidId(entry.SourceId)) errors.Add(prefix + "source_id가 올바르지 않습니다.");
            if (string.IsNullOrWhiteSpace(entry.Path)) errors.Add(prefix + "path가 없습니다.");
            else if (System.IO.Path.IsPathRooted(entry.Path)) errors.Add(prefix + "path는 매니페스트 기준 상대 경로여야 합니다.");
            else if (entry.Path.Split(new[] { '/', '\\' }, StringSplitOptions.RemoveEmptyEntries).Any(x => x == "..")) errors.Add(prefix + "path에 상위 폴더(..)를 사용할 수 없습니다.");
            if (!ValidSha(entry.Sha256)) errors.Add(prefix + "sha256은 64자리 16진수여야 합니다.");
            if (!Slots.Contains(entry.Slot)) errors.Add(prefix + "slot은 ifc, qto, estimate, mapping 중 하나여야 합니다.");
            if (entry.Slot == "ifc" && !string.Equals(System.IO.Path.GetExtension(entry.Path), ".ifc", StringComparison.OrdinalIgnoreCase)) errors.Add(prefix + "ifc slot은 .ifc 파일이어야 합니다.");
            if (!ValidId(entry.ScopeId)) errors.Add(prefix + "scope_id가 올바르지 않습니다.");
            if (!Statuses.Contains(entry.Status)) errors.Add(prefix + "status가 올바르지 않습니다.");
            if (!string.IsNullOrEmpty(entry.RelatedSourceId) && !ValidId(entry.RelatedSourceId)) errors.Add(prefix + "related_source_id가 올바르지 않습니다.");
        }

        private static void ValidateUniqueness(SourceManifestDocument document)
        {
            foreach (var group in document.Entries.Where(x => !string.IsNullOrEmpty(x.SourceId)).GroupBy(x => x.SourceId, StringComparer.Ordinal).Where(x => x.Count() > 1).OrderBy(x => x.Key, StringComparer.Ordinal))
                document.IntegrityErrors.Add("source_id가 중복됩니다: " + group.Key + ".");
            foreach (var group in document.Entries.Where(x => ValidSha(x.Sha256)).GroupBy(x => x.Sha256, StringComparer.OrdinalIgnoreCase).Where(x => x.Count() > 1).OrderBy(x => x.Key, StringComparer.Ordinal))
                document.IntegrityErrors.Add("sha256이 중복됩니다: " + group.Key + ".");
        }

        private static void ValidateFiles(SourceManifestDocument document)
        {
            string directory = System.IO.Path.GetDirectoryName(document.ManifestPath) ?? Directory.GetCurrentDirectory();
            string root = System.IO.Path.GetFullPath(directory).TrimEnd(System.IO.Path.DirectorySeparatorChar, System.IO.Path.AltDirectorySeparatorChar) + System.IO.Path.DirectorySeparatorChar;
            StringComparison pathComparison = System.IO.Path.DirectorySeparatorChar == '\\' ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
            foreach (SourceManifestEntry entry in document.Entries.OrderBy(x => x.SourceRow))
            {
                if (string.IsNullOrWhiteSpace(entry.Path) || System.IO.Path.IsPathRooted(entry.Path) || entry.Path.Split(new[] { '/', '\\' }, StringSplitOptions.RemoveEmptyEntries).Any(x => x == "..") || !ValidSha(entry.Sha256)) continue;
                try
                {
                    string fullPath = System.IO.Path.GetFullPath(System.IO.Path.Combine(directory, entry.Path));
                    if (!fullPath.StartsWith(root, pathComparison))
                    {
                        document.IntegrityErrors.Add(entry.SourceRow + "행: path가 매니페스트 폴더 밖을 가리킵니다: " + entry.Path + ".");
                        continue;
                    }
                    if (HasReparsePointBetween(fullPath, directory))
                    {
                        document.IntegrityErrors.Add(entry.SourceRow + "행: 심볼릭 링크 경로는 사용할 수 없습니다: " + entry.Path + ".");
                        continue;
                    }
                    entry.ResolvedPath = fullPath;
                    if (!File.Exists(fullPath)) document.IntegrityErrors.Add(entry.SourceRow + "행: 파일이 없습니다: " + entry.Path + ".");
                    else if (!string.Equals(HashFile(fullPath), entry.Sha256, StringComparison.OrdinalIgnoreCase))
                        document.IntegrityErrors.Add(entry.SourceRow + "행: 파일 SHA-256이 매니페스트와 다릅니다: " + entry.SourceId + ".");
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is ArgumentException || ex is NotSupportedException)
                {
                    document.IntegrityErrors.Add(entry.SourceRow + "행: 파일을 검증하지 못했습니다: " + ex.Message);
                }
            }
        }

        private static void ValidateRevisions(SourceManifestDocument document)
        {
            var byId = document.Entries.GroupBy(x => x.SourceId, StringComparer.Ordinal).Where(x => !string.IsNullOrEmpty(x.Key) && x.Count() == 1).ToDictionary(x => x.Key, x => x.Single(), StringComparer.Ordinal);
            foreach (SourceManifestEntry entry in document.Entries.OrderBy(x => x.SourceRow))
            {
                bool needsRelated = entry.Status == "SUPERSEDED" || entry.Status == "DERIVATIVE";
                if (needsRelated && string.IsNullOrEmpty(entry.RelatedSourceId))
                {
                    AddRevisionError(document, entry, entry.SourceId + ": " + entry.Status + "에는 related_source_id가 필요합니다.");
                    continue;
                }
                bool qtoIfcProvenance = entry.Slot == "qto" && entry.Status == "ACTIVE" && !string.IsNullOrEmpty(entry.RelatedSourceId);
                bool allowsRelated = needsRelated || entry.Status == "REFERENCE" || qtoIfcProvenance;
                if (!allowsRelated && !string.IsNullOrEmpty(entry.RelatedSourceId))
                    AddRevisionError(document, entry, entry.SourceId + ": " + entry.Status + "에는 related_source_id를 지정할 수 없습니다.");
                if (!allowsRelated || string.IsNullOrEmpty(entry.RelatedSourceId)) continue;
                SourceManifestEntry related;
                if (!byId.TryGetValue(entry.RelatedSourceId, out related))
                    AddRevisionError(document, entry, entry.SourceId + ": related_source_id를 찾을 수 없습니다: " + entry.RelatedSourceId + ".");
                else if (ReferenceEquals(entry, related))
                    AddRevisionError(document, entry, entry.SourceId + ": 자기 자신을 related_source_id로 지정할 수 없습니다.");
                else if (qtoIfcProvenance && (entry.Status != "ACTIVE" || related.Status != "ACTIVE" || related.Slot != "ifc" || entry.ScopeId != related.ScopeId || entry.Revision != related.Revision))
                    AddRevisionError(document, entry, entry.SourceId + ": QTO provenance는 같은 scope/revision의 ACTIVE IFC를 가리켜야 합니다.");
                else if (!qtoIfcProvenance && (entry.ScopeId != related.ScopeId || entry.Slot != related.Slot))
                    AddRevisionError(document, entry, entry.SourceId + ": 관련 소스의 scope_id와 slot이 같아야 합니다.");
                else if (entry.Status == "SUPERSEDED" && (related.Status == "DERIVATIVE" || related.Status == "REFERENCE" || related.Revision <= entry.Revision))
                    AddRevisionError(document, entry, entry.SourceId + ": SUPERSEDED는 더 높은 revision의 원본 소스를 가리켜야 합니다.");
                else if ((entry.Status == "DERIVATIVE" || entry.Status == "REFERENCE") && (related.Status == "DERIVATIVE" || related.Status == "REFERENCE" || related.Revision != entry.Revision))
                    AddRevisionError(document, entry, entry.SourceId + ": 파생·참조 소스는 같은 revision의 원본 소스를 가리켜야 합니다.");
            }
            foreach (var group in document.Entries.Where(x => !string.IsNullOrEmpty(x.ScopeId) && Slots.Contains(x.Slot)).GroupBy(x => GroupKey(x.ScopeId, x.Slot), StringComparer.Ordinal).OrderBy(x => x.Key, StringComparer.Ordinal))
            {
                SourceManifestEntry first = group.First();
                SourceManifestEntry[] primary = group.Where(x => x.Status == "ACTIVE" || x.Status == "SUPERSEDED" || x.Status == "UNRESOLVED").ToArray();
                foreach (var duplicate in primary.GroupBy(x => x.Revision).Where(x => x.Count() > 1))
                    AddRevisionError(document, first, "같은 scope_id/slot의 원본 revision이 중복됩니다: " + first.ScopeId + "/" + first.Slot + "/" + duplicate.Key + ".");
                SourceManifestEntry[] active = primary.Where(x => x.Status == "ACTIVE").ToArray();
                if (active.Length > 1)
                    AddRevisionError(document, first, "같은 scope_id/slot에 ACTIVE가 둘 이상입니다: " + first.ScopeId + "/" + first.Slot + ".");
                if (primary.Any(x => x.Status == "UNRESOLVED"))
                    AddRevisionError(document, first, "미결정 개정(UNRESOLVED)이 있습니다: " + first.ScopeId + "/" + first.Slot + ".");
                if (primary.Length > 0 && active.Length == 0 && !primary.Any(x => x.Status == "UNRESOLVED"))
                    AddRevisionError(document, first, "원본 개정 계보에 ACTIVE가 없습니다: " + first.ScopeId + "/" + first.Slot + ".");
                if (active.Length == 1 && primary.Any(x => x.Revision > active[0].Revision))
                    AddRevisionError(document, first, "ACTIVE가 최신 원본 revision이 아닙니다: " + first.ScopeId + "/" + first.Slot + ".");
            }
        }

        internal static string GroupKey(string scopeId, string slot) { return (scopeId ?? "") + "\u001f" + (slot ?? ""); }

        private static void AddRevisionError(SourceManifestDocument document, SourceManifestEntry entry, string message)
        {
            document.RevisionErrors.Add(message);
            string key = GroupKey(entry.ScopeId, entry.Slot);
            List<string> errors;
            if (!document.RevisionErrorsByGroup.TryGetValue(key, out errors)) document.RevisionErrorsByGroup[key] = errors = new List<string>();
            errors.Add(message);
        }

        private static bool HasReparsePointBetween(string path, string boundary)
        {
            string current = System.IO.Path.GetFullPath(path);
            string stop = System.IO.Path.GetFullPath(boundary).TrimEnd(System.IO.Path.DirectorySeparatorChar, System.IO.Path.AltDirectorySeparatorChar);
            while (!string.IsNullOrEmpty(current))
            {
                if (IsReparsePoint(current)) return true;
                if (string.Equals(current.TrimEnd(System.IO.Path.DirectorySeparatorChar, System.IO.Path.AltDirectorySeparatorChar), stop, StringComparison.Ordinal)) break;
                string parent = System.IO.Path.GetDirectoryName(current);
                if (string.Equals(parent, current, StringComparison.Ordinal)) break;
                current = parent;
            }
            return false;
        }

        private static bool IsReparsePoint(string path)
        {
            return (File.Exists(path) || Directory.Exists(path)) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0;
        }

        private static bool ValidId(string value)
        {
            if (string.IsNullOrEmpty(value) || !AsciiLetterOrDigit(value[0])) return false;
            return value.All(c => AsciiLetterOrDigit(c) || c == '.' || c == '_' || c == '-');
        }

        private static bool AsciiLetterOrDigit(char c)
        {
            return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9';
        }

        private static bool ValidSha(string value)
        {
            return value != null && value.Length == 64 && value.All(c => c >= '0' && c <= '9' || c >= 'a' && c <= 'f');
        }
    }
}
