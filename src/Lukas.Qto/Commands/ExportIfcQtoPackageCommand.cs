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
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class ExportIfcQtoPackageCommand : IExternalCommand
    {
        private const string IfcConfiguration = "DEFAULT IFCExportOptions (not user-selected; Windows/Revit verification required)";

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            try
            {
                Document doc = commandData.Application.ActiveUIDocument.Document;
                var dialog = new FileSaveDialog("IFC files (*.ifc)|*.ifc")
                {
                    Title = "한길시스템 - IFC·QTO 패키지 위치",
                    InitialFileName = (string.IsNullOrEmpty(doc.Title) ? "model" : doc.Title) + ".ifc"
                };
                if (dialog.Show() != ItemSelectionDialogResult.Confirmed) return Result.Cancelled;

                string selected = ModelPathUtils.ConvertModelPathToUserVisiblePath(dialog.GetSelectedModelPath());
                string parent = Path.GetDirectoryName(selected);
                string baseName = Path.GetFileNameWithoutExtension(selected);
                if (string.IsNullOrEmpty(parent) || string.IsNullOrEmpty(baseName) || !Directory.Exists(parent))
                {
                    message = "패키지를 저장할 수 있는 폴더와 이름을 선택하십시오.";
                    return Result.Failed;
                }

                string packagePath;
                Result result = CreatePackage(
                    doc,
                    parent,
                    baseName,
                    DateTime.UtcNow,
                    commandData.Application.Application.VersionNumber,
                    out packagePath,
                    out message);
                if (result == Result.Succeeded)
                    TaskDialog.Show("한길시스템", "IFC·QTO 패키지 생성 완료:\n" + packagePath);
                return result;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                return Result.Failed;
            }
        }

        internal static Result CreatePackage(
            Document doc,
            string parent,
            string baseName,
            DateTime exportedAtUtc,
            string revitVersion,
            out string packagePath,
            out string error)
        {
            string stamp = exportedAtUtc.ToUniversalTime().ToString("yyyyMMdd_HHmmss", CultureInfo.InvariantCulture);
            string finalPath = Path.Combine(parent, baseName + "_" + stamp);
            string partialPath = finalPath + "." + Guid.NewGuid().ToString("N") + ".partial";
            packagePath = partialPath;
            error = null;

            if (Directory.Exists(finalPath) || File.Exists(finalPath))
            {
                error = "같은 이름의 패키지가 이미 있습니다: " + finalPath;
                return Result.Failed;
            }

            Directory.CreateDirectory(partialPath);
            string ifcHash = "";
            string qtoHash = "";
            string elementLedgerHash = "";
            int rowCount = 0;
            int elementCount = 0;
            int elementLedgerRowCount = 0;
            try
            {
                string ifcPath = Path.Combine(partialPath, "model.ifc");
                string qtoPath = Path.Combine(partialPath, "qto.csv");
                string elementLedgerPath = Path.Combine(partialPath, "element-ledger.csv");
                string exportError;
                if (!ExportIfcCommand.Export(doc, partialPath, "model.ifc", out exportError))
                    throw new InvalidOperationException(exportError);
                RequireFile(ifcPath, "IFC");
                ifcHash = Sha256(ifcPath);

                List<QtoRow> rows = QuantityExtractor.Extract(doc);
                if (rows.Count == 0)
                    throw new InvalidDataException("집계 대상이 없어 검산 가능한 QTO 패키지를 만들 수 없습니다.");
                if (rows.Any(r => r.Count < 0 || r.ElementIds == null || r.ElementIds.Count != r.Count))
                    throw new InvalidDataException("QTO 행의 수량과 요소ID 개수가 일치하지 않습니다.");
                CsvWriter.Write(qtoPath, rows);
                RequireFile(qtoPath, "QTO");

                qtoHash = Sha256(qtoPath);
                rowCount = rows.Count;
                elementCount = rows.Sum(r => r.Count);

                List<ElementQuantityLedgerRow> elementRows = ElementQuantityExtractor.Extract(doc);
                if (elementRows.Count == 0)
                    throw new InvalidDataException("요소별 수량 원장이 비어 있어 추적 가능한 QTO 패키지를 만들 수 없습니다.");
                var qtoElementIds = new HashSet<string>(rows.SelectMany(r => r.ElementIds).Select(id => ElementQuantityLedger.CanonicalElementId(id.ToString(CultureInfo.InvariantCulture))), StringComparer.Ordinal);
                var ledgerElementIds = new HashSet<string>(elementRows.Select(r => ElementQuantityLedger.CanonicalElementId(r.ElementId)), StringComparer.Ordinal);
                if (elementRows.Count != elementCount || qtoElementIds.Count != elementCount || !qtoElementIds.SetEquals(ledgerElementIds))
                    throw new InvalidDataException("QTO 요소ID와 요소별 수량 원장의 요소ID 집합 또는 개수가 일치하지 않습니다.");
                ElementQuantityLedger.Write(elementLedgerPath, elementRows);
                RequireFile(elementLedgerPath, "요소별 수량 원장");
                elementLedgerHash = Sha256(elementLedgerPath);
                IReadOnlyList<ElementQuantityLedgerRow> verifiedElementRows = ElementQuantityLedger.Read(elementLedgerPath);
                string verifiedElementLedgerHash = Sha256(elementLedgerPath);
                if (!string.Equals(elementLedgerHash, verifiedElementLedgerHash, StringComparison.OrdinalIgnoreCase) ||
                    verifiedElementRows.Count != elementRows.Count)
                    throw new InvalidDataException("요소별 수량 원장의 SHA-256 또는 행 수 재검증에 실패했습니다.");
                elementLedgerRowCount = verifiedElementRows.Count;
                WriteManifest(
                    partialPath,
                    exportedAtUtc,
                    revitVersion,
                    doc.Title,
                    ifcHash,
                    qtoHash,
                    rowCount,
                    elementCount,
                    elementLedgerHash,
                    elementLedgerRowCount,
                    "COMPLETE",
                    "");

                Directory.Move(partialPath, finalPath);
                packagePath = finalPath;
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                if (Directory.Exists(partialPath))
                {
                    try
                    {
                        WriteManifest(partialPath, exportedAtUtc, revitVersion, doc.Title, ifcHash, qtoHash, rowCount, elementCount, elementLedgerHash, elementLedgerRowCount, "FAILED", error);
                    }
                    catch (Exception manifestException)
                    {
                        error += " 실패 manifest도 저장하지 못했습니다: " + manifestException.Message;
                    }
                }
                return Result.Failed;
            }
        }

        private static void RequireFile(string path, string label)
        {
            if (!File.Exists(path) || new FileInfo(path).Length == 0)
                throw new InvalidDataException(label + " 파일이 생성되지 않았거나 비어 있습니다.");
        }

        private static string Sha256(string path)
        {
            using (var stream = File.OpenRead(path))
            using (var sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "");
        }

        private static void WriteManifest(
            string folder,
            DateTime exportedAtUtc,
            string revitVersion,
            string documentTitle,
            string ifcHash,
            string qtoHash,
            int rowCount,
            int elementCount,
            string elementLedgerHash,
            int elementLedgerRowCount,
            string status,
            string failureReason)
        {
            string version = typeof(ExportIfcQtoPackageCommand).Assembly.GetName().Version.ToString();
            string header = "product_version,exported_at_utc,revit_version,document_title,ifc_configuration,ifc_file,ifc_sha256,qto_file,qto_sha256,qto_row_count,element_count,element_ledger_file,element_ledger_sha256,element_ledger_row_count,status,failure_reason";
            string[] values =
            {
                version,
                exportedAtUtc.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture),
                revitVersion,
                Csv.SpreadsheetText(documentTitle),
                IfcConfiguration,
                "model.ifc",
                ifcHash,
                "qto.csv",
                qtoHash,
                rowCount.ToString(CultureInfo.InvariantCulture),
                elementCount.ToString(CultureInfo.InvariantCulture),
                "element-ledger.csv",
                elementLedgerHash,
                elementLedgerRowCount.ToString(CultureInfo.InvariantCulture),
                status,
                Csv.SpreadsheetText(failureReason)
            };
            File.WriteAllText(
                Path.Combine(folder, "export-manifest.csv"),
                header + Environment.NewLine + string.Join(",", values.Select(Escape)) + Environment.NewLine,
                new UTF8Encoding(true));
        }

        private static string Escape(string value)
        {
            if (value == null) return "";
            if (value.IndexOfAny(new[] { ',', '"', '\n', '\r' }) < 0) return value;
            return "\"" + value.Replace("\"", "\"\"") + "\"";
        }
    }
}
