using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Lukas.Qto.Core;

namespace Lukas.Qto.Commands
{
    [Transaction(TransactionMode.ReadOnly)]
    [Regeneration(RegenerationOption.Manual)]
    public class ExportFormworkFaceLedgerCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            try
            {
                Document doc = commandData.Application.ActiveUIDocument.Document;
                var dialog = new FileSaveDialog("CSV files (*.csv)|*.csv") { Title = "한길시스템 - 거푸집 Face 원장 위치", InitialFileName = "formwork-face-ledger.csv" };
                if (dialog.Show() != ItemSelectionDialogResult.Confirmed) return Result.Cancelled;
                string path = ModelPathUtils.ConvertModelPathToUserVisiblePath(dialog.GetSelectedModelPath());
                Result result = CreateLedger(doc, path, DateTime.UtcNow, commandData.Application.Application.VersionNumber, out string manifestPath, out message);
                if (result == Result.Succeeded) TaskDialog.Show("한길시스템", "거푸집 Face 원장 생성 완료:\n" + path + "\nSHA manifest:\n" + manifestPath + "\n\n모든 face는 경계·개구부·공제 근거 승인 전 REVIEW입니다.");
                return result;
            }
            catch (Exception ex) { message = ex.Message; return Result.Failed; }
        }

        internal static Result CreateLedger(Document document, string ledgerPath, DateTime exportedAtUtc, string revitVersion, out string manifestPath, out string error)
        {
            manifestPath = null; error = null;
            if (document == null || string.IsNullOrWhiteSpace(ledgerPath)) { error = "문서와 원장 경로가 필요합니다."; return Result.Failed; }
            string fullLedgerPath;
            try { fullLedgerPath = Path.GetFullPath(ledgerPath); }
            catch (Exception ex) { error = ex.Message; return Result.Failed; }
            string parent = Path.GetDirectoryName(fullLedgerPath);
            if (string.IsNullOrWhiteSpace(parent) || !Directory.Exists(parent) || !string.Equals(Path.GetExtension(fullLedgerPath), ".csv", StringComparison.OrdinalIgnoreCase))
            { error = "기존 폴더 안의 .csv 원장 경로를 선택하십시오."; return Result.Failed; }
            manifestPath = Path.Combine(parent, Path.GetFileNameWithoutExtension(fullLedgerPath) + ".manifest.csv");
            if (File.Exists(fullLedgerPath) || Directory.Exists(fullLedgerPath) || File.Exists(manifestPath) || Directory.Exists(manifestPath))
            { error = "거푸집 face 원장 또는 manifest가 이미 있어 덮어쓰지 않습니다."; return Result.Failed; }
            string token = Guid.NewGuid().ToString("N");
            string stagingLedger = Path.Combine(parent, "." + Path.GetFileName(fullLedgerPath) + "." + token + ".tmp");
            string stagingManifest = Path.Combine(parent, "." + Path.GetFileName(manifestPath) + "." + token + ".tmp");
            bool movedLedger = false;
            try
            {
                List<FormworkFaceRow> rows = FormworkFaceExtractor.Extract(document);
                if (rows.Count == 0) throw new InvalidDataException("solid face가 없어 거푸집 face 원장을 만들 수 없습니다.");
                FormworkFaceExtractor.WriteLedger(stagingLedger, rows);
                RequireFile(stagingLedger, "거푸집 face 원장");
                string ledgerHash = Sha256(stagingLedger);
                string canonicalHash = FormworkTakeoff.ComputeLedgerHash(rows);
                WriteManifest(stagingManifest, exportedAtUtc, revitVersion, Path.GetFileName(fullLedgerPath), ledgerHash, canonicalHash, rows.Count);
                RequireFile(stagingManifest, "거푸집 face manifest");
                File.Move(stagingLedger, fullLedgerPath); movedLedger = true;
                File.Move(stagingManifest, manifestPath);
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                if (movedLedger) { try { File.Delete(fullLedgerPath); } catch { error += " 원장 복구 삭제에 실패했습니다: " + fullLedgerPath; } }
                manifestPath = null;
                return Result.Failed;
            }
            finally
            {
                try { if (File.Exists(stagingLedger)) File.Delete(stagingLedger); } catch { }
                try { if (File.Exists(stagingManifest)) File.Delete(stagingManifest); } catch { }
            }
        }

        private static void WriteManifest(string path, DateTime exportedAtUtc, string revitVersion, string ledgerFile, string ledgerHash, string canonicalHash, int rowCount)
        {
            string[] header = { "product_version", "exported_at_utc", "revit_version", "ledger_file", "ledger_sha256", "canonical_geometry_ledger_sha256", "face_row_count", "status" };
            string[] values = { Assembly.GetExecutingAssembly().GetName().Version.ToString(), exportedAtUtc.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture), revitVersion ?? "", ledgerFile, ledgerHash, canonicalHash, rowCount.ToString(CultureInfo.InvariantCulture), "REVIEW" };
            Csv.Write(path, new[] { header, values.Select(Escape).ToArray() });
        }
        private static string Escape(string value) { return Csv.SpreadsheetText(value ?? ""); }
        private static void RequireFile(string path, string label) { if (!File.Exists(path) || new FileInfo(path).Length == 0) throw new InvalidDataException(label + " 파일이 생성되지 않았거나 비어 있습니다."); }
        private static string Sha256(string path) { using (var stream = File.OpenRead(path)) using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", ""); }
    }
}
