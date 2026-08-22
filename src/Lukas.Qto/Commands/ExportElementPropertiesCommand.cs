using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Lukas.Qto.Core;

namespace Lukas.Qto.Commands
{
    /// <summary>요소별 이름·체적·길이·높이의 원시값만 별도 CSV로 내보낸다.</summary>
    [Transaction(TransactionMode.ReadOnly)]
    [Regeneration(RegenerationOption.Manual)]
    public class ExportElementPropertiesCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            try
            {
                Document document = commandData.Application.ActiveUIDocument.Document;
                RevitExtractionScope scope;
                if (!TryChooseScope(out scope)) return Result.Cancelled;
                var dialog = new FileSaveDialog("CSV files (*.csv)|*.csv")
                {
                    Title = "한길시스템 - 요소 Properties CSV 위치",
                    InitialFileName = "element-ledger.csv"
                };
                if (dialog.Show() != ItemSelectionDialogResult.Confirmed) return Result.Cancelled;
                string path = ModelPathUtils.ConvertModelPathToUserVisiblePath(dialog.GetSelectedModelPath());
                string parent = string.IsNullOrWhiteSpace(path) ? "" : Path.GetDirectoryName(Path.GetFullPath(path));
                if (string.IsNullOrWhiteSpace(path) || string.IsNullOrWhiteSpace(parent) || !Directory.Exists(parent) || !string.Equals(Path.GetExtension(path), ".csv", StringComparison.OrdinalIgnoreCase))
                {
                    message = "기존 폴더 안의 .csv 파일명을 선택하십시오.";
                    return Result.Failed;
                }
                string evidencePath = path + ".evidence.json";
                if (File.Exists(evidencePath) || Directory.Exists(evidencePath))
                {
                    message = "같은 이름의 Properties evidence JSON이 이미 있습니다: " + evidencePath;
                    return Result.Failed;
                }
                var counts = new RevitExtractionCounts();
                List<ElementQuantityLedgerRow> rows = ElementQuantityExtractor.Extract(document, scope,
                    commandData.Application.ActiveUIDocument.ActiveView,
                    commandData.Application.ActiveUIDocument.Selection.GetElementIds(), counts);
                if (rows.Count == 0)
                {
                    message = "모델 요소가 없어 Properties CSV를 만들 수 없습니다.";
                    return Result.Failed;
                }
                ElementQuantityLedger.Write(path, rows);
                try
                {
                    WriteEvidence(evidencePath, commandData.Application.Application.VersionNumber, commandData.Application.Application.VersionBuild,
                        scope, counts, rows.Count, path);
                }
                catch
                {
                    // The CSV is newly published by this invocation. Do not leave a
                    // Properties result that lacks its required scope evidence.
                    if (File.Exists(path)) File.Delete(path);
                    throw;
                }
                TaskDialog.Show("한길시스템", "Properties 추출 완료:\n" + path + "\n" + evidencePath +
                    "\n\n범위: " + scope +
                    "\n물리 요소: " + rows.Count +
                    "\n보조 객체 제외: " + counts.ExcludedNonQuantityCount +
                    "\n링크 제외: " + counts.ExcludedLinkInstanceCount +
                    "\n체적 값 있음: " + rows.Count(row => row.VolumeState != ElementVolumeState.MISSING) +
                    "\n길이 값 있음: " + rows.Count(row => row.LengthState != ElementVolumeState.MISSING) +
                    "\n높이 값 있음: " + rows.Count(row => row.HeightState != ElementVolumeState.MISSING) +
                    "\n\nZERO(실제 0)와 MISSING(값 없음)은 구분되어 기록됩니다.");
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                return Result.Failed;
            }
        }

        private static bool TryChooseScope(out RevitExtractionScope scope)
        {
            var dialog = new TaskDialog("한길시스템 - Properties 추출 범위") { MainInstruction = "Revit Properties 추출 범위를 선택하십시오.", MainContent = "링크 모델은 어떤 범위에서도 제외됩니다. 선택 범위는 현재 선택한 host 요소만, 활성 뷰 범위는 현재 뷰의 host 요소만, 전체는 현재 host 모델만 읽습니다." };
            dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "현재 선택", "선택한 host 요소만 원시 Properties로 내보냅니다.");
            dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink2, "활성 뷰", "현재 활성 뷰에서 보이는 host 요소만 내보냅니다.");
            dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink3, "전체 host 모델", "현재 RVT 문서의 host 모델 요소 전체를 내보냅니다. 링크는 제외합니다.");
            TaskDialogResult result = dialog.Show();
            if (result == TaskDialogResult.CommandLink1) { scope = RevitExtractionScope.Selection; return true; }
            if (result == TaskDialogResult.CommandLink2) { scope = RevitExtractionScope.ActiveView; return true; }
            if (result == TaskDialogResult.CommandLink3) { scope = RevitExtractionScope.EntireHostModel; return true; }
            scope = RevitExtractionScope.EntireHostModel; return false;
        }

        private static void WriteEvidence(string evidencePath, string version, string build, RevitExtractionScope scope,
            RevitExtractionCounts counts, int rowCount, string csvPath)
        {
            string json = "{\n" +
                "  \"schema_version\": \"revit-properties-evidence-v2\",\n" +
                "  \"exported_at_utc\": \"" + DateTime.UtcNow.ToString("o") + "\",\n" +
                "  \"revit_version\": \"" + Json(version) + "\",\n" +
                "  \"revit_build\": \"" + Json(build) + "\",\n" +
                "  \"scope\": \"" + scope + "\",\n" +
                "  \"physical_category_filter\": \"built-in-category-physical-v1\",\n" +
                "  \"counts\": { \"candidate\": " + counts.CandidateCount + ", \"eligible_host_model\": " + counts.EligibleHostModelCount +
                ", \"excluded_link_instances\": " + counts.ExcludedLinkInstanceCount + ", \"excluded_non_model\": " + counts.ExcludedNonModelCount +
                ", \"excluded_non_quantity\": " + counts.ExcludedNonQuantityCount +
                ", \"missing_selection_ids\": " + counts.MissingSelectionIdCount + ", \"csv_rows\": " + rowCount + " },\n" +
                "  \"csv_file\": \"" + Json(Path.GetFileName(csvPath)) + "\",\n" +
                "  \"csv_sha256\": \"" + Sha256(csvPath) + "\"\n}" + Environment.NewLine;
            string temp = evidencePath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try { File.WriteAllText(temp, json, new UTF8Encoding(false)); File.Move(temp, evidencePath); }
            finally { if (File.Exists(temp)) File.Delete(temp); }
        }

        private static string Sha256(string path) { using (var stream = File.OpenRead(path)) using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", ""); }
        private static string Json(string value) { return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n"); }
    }
}
