using Lukas.Qto.Core;

namespace Lukas.Qto.Desktop;

public sealed class DesktopFormworkTakeoffRequest
{
    public required string LedgerPath { get; init; }
    public string? LedgerManifestPath { get; init; }
    public required string ApprovalPath { get; init; }
    public required string RegistryPath { get; init; }
    public required string ReportPath { get; init; }
}

public sealed class DesktopFormworkTakeoffResult
{
    public required FormworkFaceLedgerImport Import { get; init; }
    public required FormworkTakeoffResult Takeoff { get; init; }
    public required FormworkTakeoffReportArtifact Artifact { get; init; }
    public required IReadOnlyDictionary<string, string> InputSha256 { get; init; }
}

public static class DesktopFormworkTakeoffRunner
{
    // This is also the non-UI review entry point: it validates an exported ledger
    // and returns its Unknown/Review rows before an approval CSV even exists.
    public static FormworkFaceLedgerImport Inspect(string ledgerPath, string? manifestPath = null) => FormworkFaceLedgerCsv.ReadExport(ledgerPath, manifestPath);

    public static DesktopFormworkTakeoffResult Run(DesktopFormworkTakeoffRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        FormworkFaceLedgerImport imported = FormworkFaceLedgerCsv.ReadExport(request.LedgerPath, request.LedgerManifestPath);
        string approval = Required(request.ApprovalPath, "거푸집 승인 CSV"), registryPath = Required(request.RegistryPath, "거푸집 승인표");
        string approvalHash = RunManifest.Hash(approval), registryHash = RunManifest.Hash(registryPath);
        IReadOnlyList<FormworkFaceRow> faces = FormworkFaceLedgerCsv.ApplyApprovals(imported, approval);
        StructuralEvidenceRegistry registry = FormworkFaceLedgerCsv.ReadRegistry(registryPath);
        Ensure(approval, approvalHash); Ensure(registryPath, registryHash); Ensure(imported.LedgerPath, imported.LedgerSha256); Ensure(imported.ManifestPath, imported.ManifestSha256);
        FormworkTakeoffResult takeoff = FormworkTakeoff.Calculate(faces, Array.Empty<FormworkAccessoryRow>(), registry);
        if (!DesktopApprovalTrust.IsTrustedRegistryHash(registryHash)) FormworkTakeoff.RequireReview(takeoff, "로컬 승인표의 일관성만 확인했습니다. 관리자 trust store 승인이 없습니다.");
        Ensure(approval, approvalHash); Ensure(registryPath, registryHash); Ensure(imported.LedgerPath, imported.LedgerSha256); Ensure(imported.ManifestPath, imported.ManifestSha256);
        var hashes = new Dictionary<string, string>(StringComparer.Ordinal) { ["face_ledger"] = imported.LedgerSha256, ["face_ledger_manifest"] = imported.ManifestSha256, ["approval"] = approvalHash, ["registry"] = registryHash };
        FormworkTakeoffReportArtifact artifact = FormworkTakeoffReport.Write(request.ReportPath, takeoff, hashes);
        return new DesktopFormworkTakeoffResult { Import = imported, Takeoff = takeoff, Artifact = artifact, InputSha256 = hashes };
    }
    private static string Required(string path, string label) { if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) throw new FileNotFoundException(label + " 파일을 찾을 수 없습니다.", path); return Path.GetFullPath(path); }
    private static void Ensure(string path, string expected) { if (!string.Equals(RunManifest.Hash(path), expected, StringComparison.OrdinalIgnoreCase)) throw new IOException("실행 중 거푸집 입력이 변경되었습니다."); }
}
