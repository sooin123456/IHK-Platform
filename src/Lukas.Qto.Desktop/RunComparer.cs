using Lukas.Qto.Core;

namespace Lukas.Qto.Desktop;

public sealed class RunComparisonRequest
{
    public required string PreviousReportPath { get; init; }
    public required string PreviousManifestPath { get; init; }
    public required string CurrentReportPath { get; init; }
    public required string CurrentManifestPath { get; init; }
    public required string OutputPath { get; init; }
}

public sealed class RunComparisonRow
{
    public required string Status { get; init; }
    public required string Rule { get; init; }
    public required string LineId { get; init; }
    public required string QtoId { get; init; }
    public required string Unit { get; init; }
    public required string PreviousStatus { get; init; }
    public required string CurrentStatus { get; init; }
    public required string Message { get; init; }
}

public sealed class RunComparisonResult
{
    public required IReadOnlyList<RunComparisonRow> Rows { get; init; }
    public required bool ConditionsChanged { get; init; }
    public required string OutputPath { get; init; }
}

public static class RunComparer
{
    private static readonly string[] ReportHeader =
        { "규칙", "상태", "심각도", "내역ID", "검산키", "단위", "기대값", "실제값", "차이", "근거", "설명" };
    private static readonly string[] ConditionKeys = { "규칙버전", "수량허용오차", "KRW허용오차", "공사범위_ID", "소스게이트" };

    public static RunComparisonResult Compare(RunComparisonRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        string previousReport = RequiredFile(request.PreviousReportPath, "이전 결과 CSV");
        string previousManifest = RequiredFile(request.PreviousManifestPath, "이전 실행 manifest");
        string currentReport = RequiredFile(request.CurrentReportPath, "현재 결과 CSV");
        string currentManifest = RequiredFile(request.CurrentManifestPath, "현재 실행 manifest");
        string output = Path.GetFullPath(request.OutputPath);
        if (File.Exists(output) || Directory.Exists(output))
            throw new IOException("기존 비교 결과를 덮어쓰지 않습니다. 다른 경로를 지정하십시오.");
        var inputs = new HashSet<string>(new[] { previousReport, previousManifest, currentReport, currentManifest }, StringComparer.OrdinalIgnoreCase);
        if (inputs.Contains(output)) throw new IOException("비교 결과 경로는 입력 파일과 같을 수 없습니다.");
        string[] inputPaths = { previousReport, previousManifest, currentReport, currentManifest };
        string[] inputHashes = inputPaths.Select(RunManifest.Hash).ToArray();

        Dictionary<string, string> previousConditions = ReadManifest(previousManifest);
        Dictionary<string, string> currentConditions = ReadManifest(currentManifest);
        VerifyReportBinding(previousConditions, previousReport, inputHashes[0], previousManifest);
        VerifyReportBinding(currentConditions, currentReport, inputHashes[2], currentManifest);
        bool invalidScopeOrGate = string.IsNullOrWhiteSpace(Get(previousConditions, "공사범위_ID")) ||
            string.IsNullOrWhiteSpace(Get(currentConditions, "공사범위_ID")) ||
            !string.Equals(Get(previousConditions, "공사범위_ID"), Get(currentConditions, "공사범위_ID"), StringComparison.Ordinal) ||
            Get(previousConditions, "소스게이트") != "PASS" || Get(currentConditions, "소스게이트") != "PASS";
        bool conditionsChanged = invalidScopeOrGate || ConditionKeys.Take(3).Any(key =>
            !string.Equals(Get(previousConditions, key), Get(currentConditions, key), StringComparison.Ordinal));
        string conditionMessage = conditionsChanged
            ? string.Join("; ", ConditionKeys.Where(key => !string.Equals(Get(previousConditions, key), Get(currentConditions, key), StringComparison.Ordinal) ||
                    (key == "공사범위_ID" && string.IsNullOrWhiteSpace(Get(previousConditions, key))) ||
                    (key == "소스게이트" && (Get(previousConditions, key) != "PASS" || Get(currentConditions, key) != "PASS")))
                .Select(key => key + ": " + Display(Get(previousConditions, key)) + " -> " + Display(Get(currentConditions, key))))
            : "";

        Dictionary<ComparisonKey, List<ReportItem>> previous = ReadReport(previousReport);
        Dictionary<ComparisonKey, List<ReportItem>> current = ReadReport(currentReport);
        var keys = previous.Keys.Concat(current.Keys).Distinct().OrderBy(x => x.Rule, StringComparer.Ordinal)
            .ThenBy(x => x.LineId, StringComparer.Ordinal).ThenBy(x => x.QtoId, StringComparer.Ordinal).ThenBy(x => x.Unit, StringComparer.Ordinal);
        var rows = new List<RunComparisonRow>();
        foreach (ComparisonKey key in keys)
        {
            previous.TryGetValue(key, out List<ReportItem>? oldItems);
            current.TryGetValue(key, out List<ReportItem>? newItems);
            oldItems ??= new List<ReportItem>();
            newItems ??= new List<ReportItem>();
            string status;
            string message;
            if (oldItems.Count > 1 || newItems.Count > 1)
            {
                status = "REVIEW_DUPLICATE";
                message = $"안정 비교 키가 중복되었습니다. 이전 {oldItems.Count}건, 현재 {newItems.Count}건을 개별 판정하지 않았습니다.";
            }
            else if (conditionsChanged)
            {
                status = "CONDITION_CHANGED";
                message = "실행 조건이 달라 해결/신규 오류로 판정하지 않았습니다. " + conditionMessage;
            }
            else if (oldItems.Count == 0)
            {
                status = newItems[0].Status == "FAIL" ? "NEW_FAIL" : "NOT_COMPARABLE";
                message = status == "NEW_FAIL" ? "이전 결과에 없던 실패입니다." : "이전 결과에 같은 비교 키가 없습니다.";
            }
            else if (newItems.Count == 0)
            {
                status = "NOT_COMPARABLE";
                message = "현재 결과에서 비교 키가 사라졌습니다. 해결로 계산하지 않습니다.";
            }
            else
            {
                string oldStatus = oldItems[0].Status;
                string newStatus = newItems[0].Status;
                if (oldStatus == "FAIL" && newStatus == "PASS") { status = "RESOLVED"; message = "이전 실패가 같은 조건에서 통과했습니다."; }
                else if (oldStatus == "FAIL" && newStatus == "FAIL") { status = "UNCHANGED_FAIL"; message = "이전 실패가 계속됩니다."; }
                else if (oldStatus != "FAIL" && newStatus == "FAIL") { status = "NEW_FAIL"; message = "같은 비교 키가 새로 실패했습니다."; }
                else if (oldStatus == newStatus) { status = "UNCHANGED"; message = "상태가 같습니다."; }
                else { status = "CHANGED"; message = "실패 이외의 상태가 변경되었습니다."; }
            }

            rows.Add(new RunComparisonRow
            {
                Status = status, Rule = key.Rule, LineId = key.LineId, QtoId = key.QtoId, Unit = key.Unit,
                PreviousStatus = oldItems.Count == 1 ? oldItems[0].Status : oldItems.Count == 0 ? "" : "DUPLICATE",
                CurrentStatus = newItems.Count == 1 ? newItems[0].Status : newItems.Count == 0 ? "" : "DUPLICATE",
                Message = message
            });
        }

        string? parent = Path.GetDirectoryName(output);
        if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
        string staging = output + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            Write(staging, rows);
            EnsureUnchanged(inputPaths, inputHashes);
            if (File.Exists(output) || Directory.Exists(output))
                throw new IOException("기존 비교 결과를 덮어쓰지 않습니다. 다른 경로를 지정하십시오.");
            File.Move(staging, output);
        }
        finally
        {
            try { if (File.Exists(staging)) File.Delete(staging); } catch { }
        }
        return new RunComparisonResult { Rows = rows.AsReadOnly(), ConditionsChanged = conditionsChanged, OutputPath = output };
    }

    private static Dictionary<ComparisonKey, List<ReportItem>> ReadReport(string path)
    {
        List<string[]> rows = Csv.Read(path);
        if (rows.Count == 0 || !rows[0].SequenceEqual(ReportHeader)) throw new InvalidDataException("결과 CSV 헤더가 지원 계약과 다릅니다: " + path);
        var result = new Dictionary<ComparisonKey, List<ReportItem>>();
        for (int index = 1; index < rows.Count; index++)
        {
            string[] row = rows[index];
            if (row.Length != ReportHeader.Length) throw new InvalidDataException($"결과 CSV {index + 1}행 열 수가 올바르지 않습니다.");
            var key = new ComparisonKey(row[0], row[3], row[4], row[5]);
            if (!result.TryGetValue(key, out List<ReportItem>? items)) result[key] = items = new List<ReportItem>();
            items.Add(new ReportItem(row[1]));
        }
        return result;
    }

    private static Dictionary<string, string> ReadManifest(string path)
    {
        List<string[]> rows = Csv.Read(path);
        if (rows.Count == 0 || rows[0].Length != 2 || rows[0][0] != "키" || rows[0][1] != "값")
            throw new InvalidDataException("실행 manifest 헤더가 올바르지 않습니다: " + path);
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (string[] row in rows.Skip(1))
        {
            if (row.Length != 2 || string.IsNullOrEmpty(row[0]) || !result.TryAdd(row[0], row[1]))
                throw new InvalidDataException("실행 manifest에 잘못되거나 중복된 키가 있습니다: " + path);
        }
        foreach (string key in ConditionKeys.Concat(new[] { "결과_CSV_파일", "결과_CSV_SHA256" }))
            if (!result.ContainsKey(key)) throw new InvalidDataException("실행 manifest에 " + key + "가 없습니다: " + path);
        return result;
    }

    private static void VerifyReportBinding(IReadOnlyDictionary<string, string> manifest, string reportPath, string frozenReportHash, string manifestPath)
    {
        string recordedFile = Get(manifest, "결과_CSV_파일");
        string recordedHash = Get(manifest, "결과_CSV_SHA256");
        if (!string.Equals(recordedFile, Csv.SpreadsheetText(Path.GetFileName(reportPath)), StringComparison.Ordinal) ||
            recordedHash.Length != 64 || !string.Equals(recordedHash, frozenReportHash, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("결과 CSV가 실행 manifest의 파일명/SHA-256과 일치하지 않아 비교할 수 없습니다: " + manifestPath);
    }

    private static void EnsureUnchanged(IReadOnlyList<string> paths, IReadOnlyList<string> hashes)
    {
        for (int index = 0; index < paths.Count; index++)
            if (!string.Equals(RunManifest.Hash(paths[index]), hashes[index], StringComparison.Ordinal))
                throw new IOException("비교 중 입력 파일이 변경되었습니다. 다시 실행하십시오.");
    }

    private static void Write(string path, IEnumerable<RunComparisonRow> rows)
    {
        var csv = new List<string[]> { new[] { "비교상태", "규칙", "내역ID", "검산키", "단위", "이전상태", "현재상태", "설명" } };
        csv.AddRange(rows.Select(row => new[] { row.Status, row.Rule, row.LineId, row.QtoId, row.Unit, row.PreviousStatus, row.CurrentStatus, row.Message }
            .Select(Csv.SpreadsheetText).ToArray()));
        Csv.Write(path, csv);
    }

    private static string RequiredFile(string path, string label)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException(label + " 경로가 없습니다.");
        string fullPath = Path.GetFullPath(path);
        if (!File.Exists(fullPath)) throw new FileNotFoundException(label + " 파일을 찾을 수 없습니다.", fullPath);
        return fullPath;
    }

    private static string Get(IReadOnlyDictionary<string, string> values, string key) => values.TryGetValue(key, out string? value) ? value : "";
    private static string Display(string value) => string.IsNullOrEmpty(value) ? "(없음)" : value;
    private readonly record struct ComparisonKey(string Rule, string LineId, string QtoId, string Unit);
    private sealed record ReportItem(string Status);
}
