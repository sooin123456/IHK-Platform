using THEKIE.Qto.Core;

namespace Lukas.Qto.Desktop;

public sealed class ProjectCreationResult
{
    public required string ProjectDirectory { get; init; }
    public required string SourceManifestPath { get; init; }
    public required string IfcPath { get; init; }
    public required string QtoPath { get; init; }
    public required string ElementLedgerPath { get; init; }
    public required string EstimatePath { get; init; }
    public required string MappingPath { get; init; }
}

public static class ProjectManifestBuilder
{
    private static readonly string[] ExportHeaders =
    {
        "product_version", "exported_at_utc", "revit_version", "document_title", "ifc_configuration",
        "ifc_file", "ifc_sha256", "qto_file", "qto_sha256", "qto_row_count", "element_count",
        "element_ledger_file", "element_ledger_sha256", "element_ledger_row_count", "status", "failure_reason"
    };

    public static ProjectCreationResult Create(string exportManifestPath, string estimatePath, string mappingPath, string outputDirectory)
    {
        string exportManifest = RequiredFile(exportManifestPath, "export manifest");
        string estimate = RequiredFile(estimatePath, "내역");
        string mapping = RequiredFile(mappingPath, "매핑");
        string finalDirectory = RequiredOutputDirectory(outputDirectory);
        string partialDirectory = finalDirectory + "." + Guid.NewGuid().ToString("N") + ".partial";
        if (Directory.Exists(finalDirectory) || File.Exists(finalDirectory))
            throw new IOException("기존 프로젝트를 덮어쓰지 않습니다.");

        string exportManifestHash = RunManifest.Hash(exportManifest);
        List<string[]> exportRows = Csv.Read(exportManifest);
        EnsureHash(exportManifest, exportManifestHash, "export manifest를 읽는 중 파일이 변경되었습니다.");
        if (exportRows.Count != 2 || !exportRows[0].SequenceEqual(ExportHeaders, StringComparer.Ordinal) || exportRows[1].Length != ExportHeaders.Length)
            throw new FormatException("export-manifest.csv 형식이 올바르지 않습니다.");
        var values = ExportHeaders.Select((name, index) => new { name, value = exportRows[1][index].Trim() })
            .ToDictionary(x => x.name, x => x.value, StringComparer.Ordinal);
        if (!string.Equals(values["status"], "COMPLETE", StringComparison.Ordinal))
            throw new InvalidDataException("COMPLETE export manifest만 프로젝트로 만들 수 있습니다.");
        if (!string.Equals(values["ifc_file"], "model.ifc", StringComparison.Ordinal) ||
            !string.Equals(values["qto_file"], "qto.csv", StringComparison.Ordinal) ||
            !string.Equals(values["element_ledger_file"], "element-ledger.csv", StringComparison.Ordinal))
            throw new InvalidDataException("내보내기 패키지는 같은 폴더의 model.ifc, qto.csv, element-ledger.csv를 가리켜야 합니다.");

        string packageDirectory = Path.GetDirectoryName(exportManifest)!;
        string ifc = RequiredFile(Path.Combine(packageDirectory, "model.ifc"), "IFC");
        string qto = RequiredFile(Path.Combine(packageDirectory, "qto.csv"), "QTO");
        string elementLedger = RequiredFile(Path.Combine(packageDirectory, "element-ledger.csv"), "요소별 수량 원장");
        string[] inputs = { exportManifest, ifc, qto, elementLedger, estimate, mapping };
        string[] hashes = { exportManifestHash, RunManifest.Hash(ifc), RunManifest.Hash(qto), RunManifest.Hash(elementLedger), RunManifest.Hash(estimate), RunManifest.Hash(mapping) };
        if (!string.Equals(hashes[1], values["ifc_sha256"], StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(hashes[2], values["qto_sha256"], StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(hashes[3], values["element_ledger_sha256"], StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("IFC, QTO 또는 요소별 원장 SHA-256이 export manifest와 다릅니다.");
        List<QtoRecord> qtoRows = Input.ReadQto(qto);
        IReadOnlyList<ElementQuantityLedgerRow> ledgerRows = ElementQuantityLedger.Read(elementLedger);
        int qtoRowCount = PositiveInt(values["qto_row_count"], "qto_row_count");
        int elementCount = PositiveInt(values["element_count"], "element_count");
        int ledgerRowCount = PositiveInt(values["element_ledger_row_count"], "element_ledger_row_count");
        var qtoIds = new HashSet<string>(qtoRows.SelectMany(row => row.ElementIds), StringComparer.Ordinal);
        var ledgerIds = new HashSet<string>(ledgerRows.Select(row => row.ElementId), StringComparer.Ordinal);
        if (qtoRows.Count != qtoRowCount || qtoIds.Count != elementCount || ledgerRows.Count != ledgerRowCount ||
            ledgerRows.Count != elementCount || !qtoIds.SetEquals(ledgerIds))
            throw new InvalidDataException("manifest, QTO, 요소별 원장의 행 수 또는 요소ID 집합이 일치하지 않습니다.");

        string estimateName = "estimate" + AllowedExtension(estimate, "내역");
        string mappingName = "mapping" + AllowedExtension(mapping, "매핑");
        try
        {
            Directory.CreateDirectory(partialDirectory);
            string copiedExport = Copy(exportManifest, partialDirectory, "export-manifest.csv");
            string copiedIfc = Copy(ifc, partialDirectory, "model.ifc");
            string copiedQto = Copy(qto, partialDirectory, "qto.csv");
            string copiedElementLedger = Copy(elementLedger, partialDirectory, "element-ledger.csv");
            string copiedEstimate = Copy(estimate, partialDirectory, estimateName);
            string copiedMapping = Copy(mapping, partialDirectory, mappingName);
            string[] copies = { copiedExport, copiedIfc, copiedQto, copiedElementLedger, copiedEstimate, copiedMapping };

            EnsureHashes(inputs, hashes, "프로젝트 생성 중 입력 파일이 변경되었습니다.");
            EnsureHashes(copies, hashes, "프로젝트 복사본 SHA-256이 입력과 다릅니다.");

            string scope = "pkg-" + hashes[1][..16].ToLowerInvariant();
            string ifcId = scope + "-ifc-r1";
            string sourceManifest = Path.Combine(partialDirectory, "source-manifest.csv");
            Csv.Write(sourceManifest, new[]
            {
                new[] { "source_id", "path", "sha256", "slot", "scope_id", "revision", "status", "related_source_id" },
                new[] { ifcId, "model.ifc", hashes[1].ToLowerInvariant(), "ifc", scope, "1", "ACTIVE", "" },
                new[] { scope + "-qto-r1", "qto.csv", hashes[2].ToLowerInvariant(), "qto", scope, "1", "ACTIVE", ifcId },
                new[] { scope + "-estimate-r1", estimateName, hashes[4].ToLowerInvariant(), "estimate", scope, "1", "ACTIVE", "" },
                new[] { scope + "-mapping-r1", mappingName, hashes[5].ToLowerInvariant(), "mapping", scope, "1", "ACTIVE", "" }
            });
            SourceGateResult gate = SourceGate.RunProject(sourceManifest, copiedIfc, copiedQto, copiedEstimate, copiedMapping);
            if (!gate.Passed) throw new InvalidDataException("생성된 프로젝트가 소스 게이트를 통과하지 못했습니다: " + string.Join(" | ", gate.Findings.Where(x => x.Status == "FAIL").Select(x => x.Message)));
            EnsureHashes(inputs, hashes, "프로젝트 생성 중 입력 파일이 변경되었습니다.");

            Directory.Move(partialDirectory, finalDirectory);
            return new ProjectCreationResult
            {
                ProjectDirectory = finalDirectory,
                SourceManifestPath = Path.Combine(finalDirectory, "source-manifest.csv"),
                IfcPath = Path.Combine(finalDirectory, "model.ifc"),
                QtoPath = Path.Combine(finalDirectory, "qto.csv"),
                ElementLedgerPath = Path.Combine(finalDirectory, "element-ledger.csv"),
                EstimatePath = Path.Combine(finalDirectory, estimateName),
                MappingPath = Path.Combine(finalDirectory, mappingName)
            };
        }
        catch
        {
            if (Directory.Exists(partialDirectory)) Directory.Delete(partialDirectory, true);
            throw;
        }
    }

    private static int PositiveInt(string value, string name)
    {
        if (!int.TryParse(value, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out int parsed) || parsed <= 0)
            throw new InvalidDataException(name + "은 양의 정수여야 합니다.");
        return parsed;
    }

    private static string Copy(string source, string directory, string name)
    {
        string destination = Path.Combine(directory, name);
        File.Copy(source, destination, false);
        return destination;
    }

    private static void EnsureHashes(IReadOnlyList<string> paths, IReadOnlyList<string> expected, string message)
    {
        for (int i = 0; i < paths.Count; i++)
            if (!string.Equals(RunManifest.Hash(paths[i]), expected[i], StringComparison.OrdinalIgnoreCase)) throw new IOException(message);
    }

    private static void EnsureHash(string path, string expected, string message)
    {
        if (!string.Equals(RunManifest.Hash(path), expected, StringComparison.OrdinalIgnoreCase)) throw new IOException(message);
    }

    private static string AllowedExtension(string path, string label)
    {
        string extension = Path.GetExtension(path).ToLowerInvariant();
        if (extension is not ".csv" and not ".xlsx") throw new InvalidDataException(label + " 파일은 CSV 또는 XLSX여야 합니다.");
        return extension;
    }

    private static string RequiredFile(string path, string label)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException(label + " 경로가 없습니다.");
        string fullPath = Path.GetFullPath(path);
        if (!File.Exists(fullPath)) throw new FileNotFoundException(label + " 파일을 찾을 수 없습니다.", fullPath);
        if ((File.GetAttributes(fullPath) & FileAttributes.ReparsePoint) != 0) throw new IOException(label + " 파일은 심볼릭 링크일 수 없습니다.");
        return fullPath;
    }

    private static string RequiredOutputDirectory(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("새 프로젝트 폴더 경로가 없습니다.");
        string fullPath = Path.GetFullPath(path);
        string? parent = Path.GetDirectoryName(fullPath);
        if (string.IsNullOrEmpty(parent) || !Directory.Exists(parent)) throw new DirectoryNotFoundException("새 프로젝트의 상위 폴더를 찾을 수 없습니다.");
        return fullPath;
    }
}
