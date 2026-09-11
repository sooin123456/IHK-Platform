namespace DwgEngineQualification;

internal sealed record EntityInventory(
    string Handle,
    string Type,
    string Owner,
    string Layer,
    string Geometry,
    string? Text,
    string? Reference = null);

internal sealed record BlockInventory(
    string Handle,
    string Name,
    string? Layout,
    string Units,
    string Flags,
    string? ExternalReferencePath,
    IReadOnlyList<string> EntityHandles);

internal sealed record LayoutInventory(string Handle, string Name, string AssociatedBlock);

internal sealed record TextStyleInventory(string Handle, string Name, string FontFile, string BigFontFile);

internal sealed record CadInventory(
    IReadOnlyList<EntityInventory> Entities,
    string Units,
    string Version = "",
    IReadOnlyList<string>? Layers = null,
    IReadOnlyList<BlockInventory>? Blocks = null,
    IReadOnlyList<LayoutInventory>? Layouts = null,
    IReadOnlyList<TextStyleInventory>? TextStyles = null,
    IReadOnlyList<string>? Diagnostics = null);

internal sealed record ExpectedEdits(IReadOnlyDictionary<string, IReadOnlySet<string>> AllowedFields)
{
    public static ExpectedEdits None { get; } = new(
        new Dictionary<string, IReadOnlySet<string>>(StringComparer.Ordinal));

    public bool Allows(string handle, string field) =>
        AllowedFields.TryGetValue(handle, out var fields) && fields.Contains(field);
}

internal sealed record ComparisonResult(IReadOnlyList<string> Failures);

internal sealed record QualificationPaths(
    string InputPath,
    string OutputDirectory,
    string WorkingCopyPath,
    string NoEditDwgPath,
    string EditedDwgPath,
    string ReportPath,
    string EditRequestPath)
{
    private static readonly StringComparison PathComparison =
        OperatingSystem.IsLinux() ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase;

    public static QualificationPaths Create(string inputPath, string outputDirectory)
    {
        if (string.IsNullOrWhiteSpace(inputPath) || string.IsNullOrWhiteSpace(outputDirectory))
        {
            throw new ArgumentException("Input path and output directory are required.");
        }

        var input = CanonicalizeExistingComponents(inputPath);
        var output = CanonicalizeExistingComponents(outputDirectory);
        if (!File.Exists(input))
        {
            throw new FileNotFoundException("Input DWG does not exist.", input);
        }

        if (File.Exists(output))
        {
            throw new ArgumentException("Output directory resolves to a file.");
        }

        if (IsInside(input, output))
        {
            throw new ArgumentException("Input DWG must be outside the explicit output directory.");
        }

        var paths = new QualificationPaths(
            input,
            output,
            BoundedOutputPath(output, "input-working-copy.dwg"),
            BoundedOutputPath(output, "no-edit-roundtrip.dwg"),
            BoundedOutputPath(output, "edited-roundtrip.dwg"),
            BoundedOutputPath(output, "qualification-report.json"),
            BoundedOutputPath(output, "edit-request.json"));

        foreach (var candidate in new[] { paths.WorkingCopyPath, paths.NoEditDwgPath, paths.EditedDwgPath, paths.ReportPath, paths.EditRequestPath })
        {
            if (PathEquals(candidate, input))
            {
                throw new ArgumentException("An output path collides with the input DWG.");
            }
        }

        return paths;
    }

    public static string BoundedOutputPath(string outputDirectory, string fileName)
    {
        if (string.IsNullOrWhiteSpace(outputDirectory) || string.IsNullOrWhiteSpace(fileName))
        {
            throw new ArgumentException("Output directory and file name are required.");
        }

        if (Path.IsPathRooted(fileName))
        {
            throw new ArgumentException("Output file name must be relative to the explicit output directory.");
        }

        var output = CanonicalizeExistingComponents(outputDirectory);
        var candidate = Path.GetFullPath(fileName, output);
        if (!IsInside(candidate, output) || PathEquals(candidate, output))
        {
            throw new ArgumentException("Output path escapes the explicit output directory.");
        }

        return candidate;
    }

    private static bool IsInside(string candidate, string directory)
    {
        var relative = Path.GetRelativePath(directory, candidate);
        return !Path.IsPathRooted(relative)
            && relative != ".."
            && !relative.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal);
    }

    private static bool PathEquals(string left, string right) =>
        string.Equals(Path.GetFullPath(left), Path.GetFullPath(right), PathComparison);

    private static string CanonicalizeExistingComponents(string path) =>
        CanonicalizeExistingComponents(path, 0);

    private static string CanonicalizeExistingComponents(string path, int linkDepth)
    {
        if (linkDepth > 32)
            throw new ArgumentException("Path contains too many symbolic-link resolutions.", nameof(path));
        var fullPath = Path.GetFullPath(path);
        var root = Path.GetPathRoot(fullPath)
            ?? throw new ArgumentException("Path has no filesystem root.", nameof(path));
        var relative = Path.GetRelativePath(root, fullPath);
        var components = relative.Split(
            new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar },
            StringSplitOptions.RemoveEmptyEntries);
        var current = root;

        foreach (var component in components)
        {
            var candidate = Path.Combine(current, component);
            FileSystemInfo? info = Directory.Exists(candidate)
                ? new DirectoryInfo(candidate)
                : File.Exists(candidate)
                    ? new FileInfo(candidate)
                    : null;
            if (info is null)
            {
                var linkProbe = new FileInfo(candidate);
                if (linkProbe.LinkTarget is not null)
                    throw new ArgumentException($"Path contains a dangling symbolic link: {candidate}");
                current = candidate;
                continue;
            }

            var resolved = info.ResolveLinkTarget(returnFinalTarget: true);
            current = resolved is null
                ? candidate
                : CanonicalizeExistingComponents(resolved.FullName, linkDepth + 1);
        }

        return Path.GetFullPath(current);
    }
}

internal static class SemanticComparer
{
    public static ComparisonResult Compare(
        CadInventory before,
        CadInventory after,
        ExpectedEdits expectedEdits,
        double coordinateTolerance)
    {
        if (coordinateTolerance < 0 || double.IsNaN(coordinateTolerance))
        {
            throw new ArgumentOutOfRangeException(nameof(coordinateTolerance));
        }

        var failures = new List<string>();
        var beforeByHandle = UniqueEntities(before.Entities, "before", failures);
        var afterByHandle = UniqueEntities(after.Entities, "after", failures);

        foreach (var entity in before.Entities)
        {
            if (!afterByHandle.TryGetValue(entity.Handle, out var candidate))
            {
                failures.Add($"untouched entity {entity.Handle} was removed");
                continue;
            }

            CompareField(entity.Handle, "type", entity.Type, candidate.Type, expectedEdits, failures);
            CompareField(entity.Handle, "owner", entity.Owner, candidate.Owner, expectedEdits, failures);
            CompareField(entity.Handle, "layer", entity.Layer, candidate.Layer, expectedEdits, failures);
            CompareField(entity.Handle, "text", entity.Text, candidate.Text, expectedEdits, failures);
            CompareField(entity.Handle, "reference", entity.Reference, candidate.Reference, expectedEdits, failures);
            if (!GeometryEquals(entity.Geometry, candidate.Geometry, coordinateTolerance)
                && !expectedEdits.Allows(entity.Handle, "geometry"))
            {
                failures.Add($"untouched entity {entity.Handle} geometry changed");
            }
        }

        foreach (var entity in after.Entities.Where(entity => !beforeByHandle.ContainsKey(entity.Handle)))
        {
            failures.Add($"unexpected entity {entity.Handle} was added");
        }

        if (!string.Equals(before.Units, after.Units, StringComparison.Ordinal))
        {
            failures.Add($"document units changed from {before.Units} to {after.Units}");
        }

        CompareDocumentField("version", before.Version, after.Version, failures);
        CompareDocumentField("layers", before.Layers ?? [], after.Layers ?? [], failures);
        CompareDocumentField("blocks", BlockSignatures(before.Blocks), BlockSignatures(after.Blocks), failures);
        CompareDocumentField("layouts", before.Layouts ?? [], after.Layouts ?? [], failures);
        CompareDocumentField("text styles", before.TextStyles ?? [], after.TextStyles ?? [], failures);

        return new ComparisonResult(failures);
    }

    private static IReadOnlyDictionary<string, EntityInventory> UniqueEntities(
        IReadOnlyList<EntityInventory> entities,
        string side,
        ICollection<string> failures)
    {
        var result = new Dictionary<string, EntityInventory>(StringComparer.Ordinal);
        foreach (var group in entities.GroupBy(entity => entity.Handle, StringComparer.Ordinal))
        {
            if (group.Count() > 1)
                failures.Add($"{side} inventory contains duplicate entity handle {group.Key}");
            result[group.Key] = group.First();
        }

        return result;
    }

    private static IReadOnlyList<string> BlockSignatures(IReadOnlyList<BlockInventory>? blocks) =>
        (blocks ?? [])
            .Select(block => $"{block.Handle}|{block.Name}|{block.Layout}|{block.Units}|{block.Flags}|{block.ExternalReferencePath}|{string.Join(",", block.EntityHandles)}")
            .ToArray();

    private static void CompareDocumentField<T>(
        string field,
        T before,
        T after,
        ICollection<string> failures)
    {
        var left = System.Text.Json.JsonSerializer.Serialize(before);
        var right = System.Text.Json.JsonSerializer.Serialize(after);
        if (!string.Equals(left, right, StringComparison.Ordinal))
        {
            failures.Add($"document {field} changed");
        }
    }

    private static void CompareField(
        string handle,
        string field,
        string? before,
        string? after,
        ExpectedEdits expectedEdits,
        ICollection<string> failures)
    {
        if (!expectedEdits.Allows(handle, field) && !string.Equals(before, after, StringComparison.Ordinal))
        {
            failures.Add($"untouched entity {handle} {field} changed");
        }
    }

    private static bool GeometryEquals(string before, string after, double tolerance)
    {
        var left = ExtractNumbers(before);
        var right = ExtractNumbers(after);
        if (left.Count != right.Count)
        {
            return false;
        }

        for (var i = 0; i < left.Count; i++)
        {
            if (Math.Abs(left[i] - right[i]) > tolerance)
            {
                return false;
            }
        }

        return StripNumbers(before) == StripNumbers(after);
    }

    private static IReadOnlyList<double> ExtractNumbers(string value) =>
        System.Text.RegularExpressions.Regex.Matches(value, @"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")
            .Select(match => double.Parse(match.Value, System.Globalization.CultureInfo.InvariantCulture))
            .ToArray();

    private static string StripNumbers(string value) =>
        System.Text.RegularExpressions.Regex.Replace(value, @"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?", "#");
}
