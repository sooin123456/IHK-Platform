using Lukas.Qto.Core;

namespace Lukas.Qto.Desktop;

public sealed class DesktopConcreteTakeoffRequest
{
    public required string ExportManifestPath { get; init; }
    public required string ElementLedgerPath { get; init; }
    public required string RevitMappingPath { get; init; }
    public required string ConcreteRulesPath { get; init; }
    public required string RegistryPath { get; init; }
    public required string ReportPath { get; init; }
}

public sealed class DesktopConcreteTakeoffResult
{
    public required StructuralQuantityStatus Status { get; init; }
    public required RevitConcreteMappingResult Mapping { get; init; }
    public required ConcreteTakeoffResult Takeoff { get; init; }
    public required TakeoffReportArtifact Artifact { get; init; }
    public required string ExportManifestSha256 { get; init; }
    public required string ElementLedgerSha256 { get; init; }
    public required string IfcSha256 { get; init; }
    public required string QtoSha256 { get; init; }
}

public static class DesktopConcreteTakeoffRunner
{
    public static DesktopConcreteTakeoffResult Run(DesktopConcreteTakeoffRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        string manifest = RequiredFile(request.ExportManifestPath, "export-manifest");
        string ledger = RequiredFile(request.ElementLedgerPath, "element ledger");
        string mapping = RequiredFile(request.RevitMappingPath, "Revit mapping");
        string rules = RequiredFile(request.ConcreteRulesPath, "concrete rules");
        string registry = RequiredFile(request.RegistryPath, "registry");
        string report = RequiredOutput(request.ReportPath);
        RevitExportPackageResult binding = RevitExportPackage.Verify(manifest);
        if (!string.Equals(binding.ElementLedgerPath, ledger, PathComparison()))
            throw new InvalidDataException("선택한 element-ledger는 export-manifest와 같은 패키지 파일이어야 합니다.");
        string[] input = { manifest, binding.IfcPath, binding.QtoPath, ledger, mapping, rules, registry };
        string[] hashes = input.Select(RunManifest.Hash).ToArray();
        RevitConcreteMappingBundle mappingBundle = ConcreteBundleCsv.ReadRevitMapping(mapping);
        ConcreteRuleBundle ruleBundle = ConcreteBundleCsv.ReadConcreteRules(rules);
        ConcreteRuleRegistry approvals = ConcreteBundleCsv.ReadRegistry(registry);
        EnsureHashes(input, hashes);

        IReadOnlyList<ElementQuantityLedgerRow> elements = ElementQuantityLedger.Read(ledger);
        RevitConcreteMappingResult mapped = ConcreteTakeoff.MapRevitLedger(elements, mappingBundle, approvals);
        ConcreteTakeoffResult takeoff = ConcreteTakeoff.Calculate(mapped.Rows, ruleBundle, approvals);
        bool trustedRegistry = DesktopApprovalTrust.IsTrustedRegistryHash(hashes[6]);
        if (!trustedRegistry) ConcreteTakeoff.RequireReview(takeoff, "로컬 승인표의 일관성만 확인했습니다. 관리자 trust store 승인이 없습니다.");
        StructuralQuantityStatus status = mapped.Status == StructuralQuantityStatus.FAIL || takeoff.Status == StructuralQuantityStatus.FAIL ? StructuralQuantityStatus.FAIL :
            mapped.Status == StructuralQuantityStatus.PASS && takeoff.Status == StructuralQuantityStatus.PASS ? StructuralQuantityStatus.PASS : StructuralQuantityStatus.REVIEW;
        EnsureHashes(input, hashes);
        var reportEvidence = new Dictionary<string, string>(StringComparer.Ordinal) {
            ["export_manifest"] = hashes[0], ["ifc"] = hashes[1], ["qto"] = hashes[2], ["element_ledger"] = hashes[3],
            ["revit_mapping"] = hashes[4], ["concrete_rules"] = hashes[5], ["registry"] = hashes[6]
        };
        TakeoffReportArtifact artifact = TakeoffReport.WriteTakeoff(report, takeoff, reportEvidence);
        return new DesktopConcreteTakeoffResult { Status = status, Mapping = mapped, Takeoff = takeoff, Artifact = artifact,
            ExportManifestSha256 = hashes[0], ElementLedgerSha256 = hashes[3], IfcSha256 = binding.IfcSha256, QtoSha256 = binding.QtoSha256 };
    }

    private static string RequiredFile(string path, string label)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException(label + " 경로가 없습니다.");
        string full = Path.GetFullPath(path);
        if (!File.Exists(full)) throw new FileNotFoundException(label + " 파일을 찾을 수 없습니다.", full);
        return full;
    }

    private static string RequiredOutput(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("콘크리트 report 경로가 없습니다.");
        string full = Path.GetFullPath(path);
        if (File.Exists(full) || Directory.Exists(full) || File.Exists(full + ".manifest.csv")) throw new IOException("기존 콘크리트 report를 덮어쓰지 않습니다.");
        return full;
    }

    private static void EnsureHashes(IReadOnlyList<string> paths, IReadOnlyList<string> expected)
    {
        for (int index = 0; index < paths.Count; index++) if (!string.Equals(RunManifest.Hash(paths[index]), expected[index], StringComparison.OrdinalIgnoreCase)) throw new IOException("실행 중 입력 파일이 변경되었습니다.");
    }

    private static StringComparison PathComparison() => OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
}

internal static class DesktopApprovalTrust
{
    internal static bool IsTrustedRegistryHash(string registrySha256)
    {
        if (!OperatingSystem.IsWindows() || string.IsNullOrWhiteSpace(registrySha256)) return false;
        try
        {
            using Microsoft.Win32.RegistryKey? key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Lukas QTO\Approvals", false);
            string? approved = key?.GetValue("TrustedRegistrySha256") as string;
            return approved != null && approved.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries).Select(value => value.Trim()).Any(value =>
                value.Length == 64 && string.Equals(value, registrySha256, StringComparison.OrdinalIgnoreCase));
        }
        catch { return false; }
    }
}
