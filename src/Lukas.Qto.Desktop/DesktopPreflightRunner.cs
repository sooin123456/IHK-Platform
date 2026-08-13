using THEKIE.Qto.Core;

namespace Lukas.Qto.Desktop;

public sealed class DesktopPreflightRequest
{
    public required string SourceManifestPath { get; init; }
    public string? IfcPath { get; init; }
    public required string QtoPath { get; init; }
    public required string EstimatePath { get; init; }
    public required string MappingPath { get; init; }
    public required string ReportPath { get; init; }
    public decimal QuantityTolerance { get; init; }
    public decimal KrwTolerance { get; init; }
}

public sealed class DesktopPreflightResult
{
    public required bool SourceGatePassed { get; init; }
    public required string? ScopeId { get; init; }
    public required IReadOnlyList<Finding> Findings { get; init; }
    public required string ReportPath { get; init; }
    public required string HtmlPath { get; init; }
    public required string ManifestPath { get; init; }
}

public static class DesktopPreflightRunner
{
    public static DesktopPreflightResult Run(DesktopPreflightRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.QuantityTolerance < 0m || request.KrwTolerance < 0m)
            throw new ArgumentOutOfRangeException(nameof(request), "허용오차는 음수일 수 없습니다.");

        string sourceManifest = RequiredFile(request.SourceManifestPath, "source manifest");
        string? ifc = string.IsNullOrWhiteSpace(request.IfcPath) ? null : RequiredFile(request.IfcPath, "IFC");
        string qto = RequiredFile(request.QtoPath, "QTO");
        string estimate = RequiredFile(request.EstimatePath, "내역");
        string mapping = RequiredFile(request.MappingPath, "매핑");
        string report = RequiredPath(request.ReportPath, "결과 CSV");
        string html = report + ".html";
        string manifest = report + ".manifest.csv";
        string[] inputs = ifc == null
            ? new[] { sourceManifest, qto, estimate, mapping }
            : new[] { sourceManifest, ifc, qto, estimate, mapping };
        string[] outputs = { report, html, manifest };
        RejectOutputCollision(outputs, inputs);

        string[] hashes = inputs.Select(RunManifest.Hash).ToArray();
        int offset = ifc == null ? 1 : 2;
        SourceGateResult gate = ifc == null
            ? SourceGate.RunWithHashes(sourceManifest, qto, estimate, mapping, hashes[1], hashes[2], hashes[3])
            : SourceGate.RunProjectWithHashes(sourceManifest, ifc, qto, estimate, mapping, hashes[1], hashes[2], hashes[3], hashes[4]);
        var findings = gate.Findings.ToList();
        var policy = new AuditPolicy { QuantityTolerance = request.QuantityTolerance, KrwTolerance = request.KrwTolerance };

        // Source-gate failure is a hard boundary: no R rule is evaluated.
        if (gate.Passed)
        {
            var estimateLines = Input.ReadEstimate(estimate);
            findings.AddRange(Preflight.Run(Input.ReadQto(qto), estimateLines, Input.ReadMappings(mapping), policy, Input.ReadEstimateSummary(estimate)));
        }

        EnsureUnchanged(inputs, hashes);
        string? runnerLocation = typeof(DesktopPreflightRunner).Assembly.Location;
        string parent = Path.GetDirectoryName(report)!;
        string staging = Path.Combine(parent, "." + Path.GetFileName(report) + "." + Guid.NewGuid().ToString("N") + ".tmp");
        string stagedReport = Path.Combine(staging, Path.GetFileName(report));
        string stagedHtml = Path.Combine(staging, Path.GetFileName(html));
        string stagedManifest = Path.Combine(staging, Path.GetFileName(manifest));
        var published = new List<string>();
        try
        {
            Directory.CreateDirectory(staging);
            Report.Write(stagedReport, findings);
            RunManifest.Write(stagedManifest, qto, estimate, mapping, policy, hashes[offset], hashes[offset + 1], hashes[offset + 2],
                sourceManifest, hashes[0], gate, false,
                string.IsNullOrEmpty(runnerLocation) || !File.Exists(runnerLocation) ? null : RunManifest.Hash(runnerLocation),
                ifc, ifc == null ? null : hashes[1], stagedReport, RunManifest.Hash(stagedReport));
            Report.WriteHtml(stagedHtml, findings, Path.GetFileName(manifest));

            // A second instance may have published after the first check.
            RejectOutputCollision(outputs, inputs);
            Publish(stagedReport, report, published);
            Publish(stagedHtml, html, published);
            Publish(stagedManifest, manifest, published);
        }
        catch
        {
            foreach (string path in published)
                try { File.Delete(path); } catch { }
            throw;
        }
        finally
        {
            try { if (Directory.Exists(staging)) Directory.Delete(staging, true); } catch { }
        }

        return new DesktopPreflightResult
        {
            SourceGatePassed = gate.Passed,
            ScopeId = gate.SelectedScopeId,
            Findings = findings.AsReadOnly(),
            ReportPath = report,
            HtmlPath = html,
            ManifestPath = manifest
        };
    }

    private static string RequiredFile(string path, string name)
    {
        string fullPath = RequiredPath(path, name);
        if (!File.Exists(fullPath)) throw new FileNotFoundException(name + " 파일을 찾을 수 없습니다.", fullPath);
        return fullPath;
    }

    private static string RequiredPath(string path, string name)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException(name + " 경로가 없습니다.");
        return Path.GetFullPath(path);
    }

    private static void EnsureUnchanged(IReadOnlyList<string> paths, IReadOnlyList<string> initialHashes)
    {
        for (int i = 0; i < paths.Count; i++)
            if (!string.Equals(RunManifest.Hash(paths[i]), initialHashes[i], StringComparison.Ordinal))
                throw new IOException("검산 중 입력 파일이 변경되었습니다. 다시 실행하십시오.");
    }

    private static void RejectOutputCollision(IEnumerable<string> outputs, IEnumerable<string> inputs)
    {
        string[] outputPaths = outputs.Select(Path.GetFullPath).ToArray();
        if (outputPaths.Distinct(StringComparer.OrdinalIgnoreCase).Count() != outputPaths.Length)
            throw new IOException("결과 파일 경로는 서로 달라야 합니다.");
        if (outputPaths.Any(path => File.Exists(path) || Directory.Exists(path)))
            throw new IOException("기존 결과 파일을 덮어쓰지 않습니다. 다른 결과 경로를 지정하십시오.");
        var inputPaths = new HashSet<string>(inputs.Select(Path.GetFullPath), StringComparer.OrdinalIgnoreCase);
        if (outputPaths.Any(inputPaths.Contains))
            throw new IOException("결과 파일 경로는 입력 파일과 같을 수 없습니다.");
        foreach (string output in outputPaths)
        {
            string? parent = Path.GetDirectoryName(output);
            if (string.IsNullOrEmpty(parent)) continue;
            Directory.CreateDirectory(parent);
        }
    }

    private static void Publish(string stagedPath, string finalPath, ICollection<string> published)
    {
        File.Move(stagedPath, finalPath);
        published.Add(finalPath);
    }
}
