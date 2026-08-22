using Lukas.Qto.Core;

namespace Lukas.Qto.Desktop;

/// <summary>
/// Creates a new, additive source-manifest revision.  It never edits the
/// manifest the user selected: the old ACTIVE row is copied as SUPERSEDED and
/// a new manifest is published alongside it.
/// </summary>
public sealed class RevisionRegistrationRequest
{
    public required string SourceManifestPath { get; init; }
    public required string CurrentActivePath { get; init; }
    public required string ReplacementPath { get; init; }
    public required string Slot { get; init; }
}

public sealed class RevisionRegistrationResult
{
    public required string SourceManifestPath { get; init; }
    public required string RegisteredFilePath { get; init; }
    public required string SourceId { get; init; }
    public required string ScopeId { get; init; }
    public required int Revision { get; init; }
    public required string Slot { get; init; }
}

public static class RevisionRegistration
{
    private static readonly string[] Headers =
    {
        "source_id", "path", "sha256", "slot", "scope_id", "revision", "status", "related_source_id"
    };

    public static RevisionRegistrationResult Register(RevisionRegistrationRequest request)
    {
        if (request == null) throw new ArgumentNullException(nameof(request));
        if (request.Slot is not "estimate" and not "mapping")
            throw new ArgumentException("새 개정 등록은 estimate 또는 mapping만 지원합니다.", nameof(request));

        string manifestPath = RequiredFile(request.SourceManifestPath, "소스 매니페스트");
        string projectDirectory = Path.GetDirectoryName(manifestPath) ?? throw new DirectoryNotFoundException("프로젝트 폴더를 찾을 수 없습니다.");
        string manifestHash = RunManifest.Hash(manifestPath);
        SourceManifestDocument document = SourceManifest.Read(manifestPath);
        EnsureHash(manifestPath, manifestHash, "등록 중 현재 소스 매니페스트가 변경되었습니다.");
        if (document.IntegrityErrors.Count > 0 || document.RevisionErrors.Count > 0)
            throw new InvalidDataException("현재 소스 매니페스트가 유효하지 않아 개정을 등록할 수 없습니다.");

        string current = RequiredFile(request.CurrentActivePath, "현재 활성 파일");
        string replacement = RequiredFile(request.ReplacementPath, "새 개정 파일");
        if (IsInside(replacement, projectDirectory))
            throw new InvalidDataException("새 개정 파일은 프로젝트 폴더 밖에서 선택해야 합니다.");
        string extension = AllowedExtension(replacement, request.Slot);
        string currentHash = RunManifest.Hash(current);
        SourceManifestEntry[] currentMatches = document.Entries.Where(x =>
            x.Slot == request.Slot && x.Status == "ACTIVE" &&
            string.Equals(x.Sha256, currentHash, StringComparison.OrdinalIgnoreCase)).ToArray();
        if (currentMatches.Length != 1)
            throw new InvalidDataException("현재 선택 파일은 이 매니페스트의 유일한 ACTIVE " + request.Slot + " 파일이어야 합니다.");
        SourceManifestEntry old = currentMatches[0];
        string registeredCurrent = Path.GetFullPath(Path.Combine(projectDirectory, old.Path));
        if (!string.Equals(registeredCurrent, current, PathComparison()))
            throw new InvalidDataException("현재 활성 파일은 프로젝트에 등록된 파일을 선택해야 합니다.");

        string replacementHash = RunManifest.Hash(replacement);
        if (string.Equals(replacementHash, old.Sha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("새 개정 파일의 SHA-256이 현재 ACTIVE 파일과 같습니다.");
        int revision = checked(old.Revision + 1);
        string sourceId = UniqueSourceId(document, old.ScopeId + "-" + request.Slot + "-r" + revision);
        string fileName = UniqueFileName(projectDirectory, request.Slot + "-r" + revision + "-" + replacementHash[..12].ToLowerInvariant(), extension);
        string destination = Path.Combine(projectDirectory, fileName);
        string manifestOutput = UniqueManifestPath(projectDirectory, request.Slot, revision, replacementHash);
        string partial = manifestOutput + "." + Guid.NewGuid().ToString("N") + ".partial";

        bool copied = false;
        try
        {
            File.Copy(replacement, destination, false);
            copied = true;
            EnsureHash(replacement, replacementHash, "등록 중 새 개정 원본 파일이 변경되었습니다.");
            EnsureHash(destination, replacementHash, "등록한 프로젝트 복사본 SHA-256이 원본과 다릅니다.");

            List<string[]> rows = Csv.Read(manifestPath).Select(x => x.ToArray()).ToList();
            EnsureHash(manifestPath, manifestHash, "등록 중 현재 소스 매니페스트가 변경되었습니다.");
            if (rows.Count == 0 || !rows[0].SequenceEqual(Headers, StringComparer.Ordinal))
                throw new FormatException("소스 매니페스트 헤더가 올바르지 않습니다.");
            string[] oldRow = rows.Skip(1).Single(x => x.Length == Headers.Length && x[0] == old.SourceId);
            oldRow[6] = "SUPERSEDED";
            oldRow[7] = sourceId;
            rows.Add(new[] { sourceId, fileName, replacementHash.ToLowerInvariant(), request.Slot, old.ScopeId,
                revision.ToString(System.Globalization.CultureInfo.InvariantCulture), "ACTIVE", "" });
            Csv.Write(partial, rows);
            SourceManifestDocument updated = SourceManifest.Read(partial);
            if (updated.IntegrityErrors.Count > 0 || updated.RevisionErrors.Count > 0)
                throw new InvalidDataException("새 개정 매니페스트 검증에 실패했습니다.");
            EnsureHash(replacement, replacementHash, "등록 중 새 개정 원본 파일이 변경되었습니다.");
            EnsureHash(destination, replacementHash, "등록한 프로젝트 복사본 SHA-256이 원본과 다릅니다.");
            File.Move(partial, manifestOutput);
            return new RevisionRegistrationResult
            {
                SourceManifestPath = manifestOutput,
                RegisteredFilePath = destination,
                SourceId = sourceId,
                ScopeId = old.ScopeId,
                Revision = revision,
                Slot = request.Slot
            };
        }
        catch
        {
            if (File.Exists(partial)) File.Delete(partial);
            if (copied) DeleteOwnedCopy(destination, replacementHash);
            throw;
        }
    }

    private static string RequiredFile(string path, string label)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException(label + " 경로가 없습니다.");
        string full = Path.GetFullPath(path);
        if (!File.Exists(full)) throw new FileNotFoundException(label + " 파일을 찾을 수 없습니다.", full);
        if ((File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0) throw new IOException(label + " 파일은 심볼릭 링크일 수 없습니다.");
        return full;
    }

    private static string AllowedExtension(string path, string slot)
    {
        string extension = Path.GetExtension(path).ToLowerInvariant();
        if (extension is not ".csv" and not ".xlsx")
            throw new InvalidDataException(slot + " 새 개정 파일은 CSV 또는 XLSX여야 합니다.");
        return extension;
    }

    private static bool IsInside(string candidate, string directory)
    {
        string root = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        return candidate.StartsWith(root, PathComparison());
    }

    private static StringComparison PathComparison() => OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;

    private static void EnsureHash(string path, string expected, string message)
    {
        if (!string.Equals(RunManifest.Hash(path), expected, StringComparison.OrdinalIgnoreCase)) throw new IOException(message);
    }

    private static void DeleteOwnedCopy(string path, string expectedHash)
    {
        try
        {
            if (File.Exists(path) && string.Equals(RunManifest.Hash(path), expectedHash, StringComparison.OrdinalIgnoreCase)) File.Delete(path);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static string UniqueSourceId(SourceManifestDocument document, string seed)
    {
        var existing = new HashSet<string>(document.Entries.Select(x => x.SourceId), StringComparer.Ordinal);
        if (!existing.Contains(seed)) return seed;
        for (int suffix = 2; ; suffix++)
        {
            string candidate = seed + "-" + suffix;
            if (!existing.Contains(candidate)) return candidate;
        }
    }

    private static string UniqueFileName(string directory, string seed, string extension)
    {
        for (int suffix = 1; ; suffix++)
        {
            string name = seed + (suffix == 1 ? "" : "-" + suffix) + extension;
            if (!File.Exists(Path.Combine(directory, name))) return name;
        }
    }

    private static string UniqueManifestPath(string directory, string slot, int revision, string hash)
    {
        string seed = "source-manifest." + slot + "-r" + revision + "-" + hash[..12].ToLowerInvariant();
        for (int suffix = 1; ; suffix++)
        {
            string name = seed + (suffix == 1 ? "" : "-" + suffix) + ".csv";
            string path = Path.Combine(directory, name);
            if (!File.Exists(path) && !Directory.Exists(path)) return path;
        }
    }
}
