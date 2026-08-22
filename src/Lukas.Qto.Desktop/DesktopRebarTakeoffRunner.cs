using Lukas.Qto.Core;

namespace Lukas.Qto.Desktop;

public sealed class DesktopRebarTakeoffRequest
{
    public required string LengthLedgerPath { get; init; }
    public required string RuleBundlePath { get; init; }
    public string? OfficialTargetPath { get; init; }
    public required string RegistryPath { get; init; }
    public required string ReportPath { get; init; }
}

public sealed class DesktopRebarTakeoffResult
{
    public required RebarTakeoffResult Takeoff { get; init; }
    public required TakeoffReportArtifact Artifact { get; init; }
    public required IReadOnlyDictionary<string, string> InputSha256 { get; init; }
}

public static class DesktopRebarTakeoffRunner
{
    public static DesktopRebarTakeoffResult Run(DesktopRebarTakeoffRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        string length = Required(request.LengthLedgerPath, "철근 길이 ledger"), rules = Required(request.RuleBundlePath, "철근 rule bundle"), registry = Required(request.RegistryPath, "철근 registry"), report = Output(request.ReportPath);
        string? official = string.IsNullOrWhiteSpace(request.OfficialTargetPath) ? null : Required(request.OfficialTargetPath, "독립 공식 kg target");
        string[] paths = official == null ? new[] { length, rules, registry } : new[] { length, rules, official, registry };
        string[] hashes = paths.Select(RunManifest.Hash).ToArray();
        IReadOnlyList<RebarLengthRow> lengths = RebarBundleCsv.ReadLengths(length);
        RebarRuleBundle bundle = RebarBundleCsv.ReadRules(rules);
        RebarOfficialTarget? target = official == null ? null : RebarBundleCsv.ReadOfficial(official);
        StructuralEvidenceRegistry approvals = RebarBundleCsv.ReadRegistry(registry);
        Ensure(paths, hashes);
        RebarTakeoffResult takeoff = RebarTakeoff.Evaluate(lengths, bundle, target, bundle.ApprovedToleranceKg, approvals);
        if (!DesktopApprovalTrust.IsTrustedRegistryHash(hashes[^1]))
            RebarTakeoff.RequireReview(takeoff, "로컬 승인표의 일관성만 확인했습니다. 관리자 trust store 승인이 없습니다.");
        Ensure(paths, hashes);
        var evidence = new Dictionary<string, string>(StringComparer.Ordinal) { ["length_ledger"] = hashes[0], ["rule_bundle"] = hashes[1], ["registry"] = hashes[^1] };
        if (official != null) evidence["official_target"] = hashes[2];
        TakeoffReportArtifact artifact = RebarTakeoffReport.Write(report, takeoff, evidence);
        return new DesktopRebarTakeoffResult { Takeoff = takeoff, Artifact = artifact, InputSha256 = evidence };
    }
    private static string Required(string path, string label) { if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) throw new FileNotFoundException(label + " 파일을 찾을 수 없습니다.", path); return Path.GetFullPath(path); }
    private static string Output(string path) { if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("철근 report 경로가 없습니다."); string full = Path.GetFullPath(path); if (File.Exists(full) || File.Exists(full + ".manifest.csv")) throw new IOException("기존 철근 report를 덮어쓰지 않습니다."); return full; }
    private static void Ensure(IReadOnlyList<string> paths, IReadOnlyList<string> hashes) { for (int i = 0; i < paths.Count; i++) if (!string.Equals(RunManifest.Hash(paths[i]), hashes[i], StringComparison.OrdinalIgnoreCase)) throw new IOException("실행 중 철근 입력이 변경되었습니다."); }
}
