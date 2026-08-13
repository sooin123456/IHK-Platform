using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using THEKIE.Qto.Core;

namespace THEKIE.Qto.Commands
{
    [Transaction(TransactionMode.ReadOnly)]
    [Regeneration(RegenerationOption.Manual)]
    public class ExtractQuantitiesCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            try
            {
                Document doc = commandData.Application.ActiveUIDocument.Document;

                List<QtoRow> rows = QuantityExtractor.Extract(doc);
                string baseName = string.IsNullOrEmpty(doc.Title) ? "model" : doc.Title;
                string outPath = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
                    baseName + "_QTO_" + DateTime.Now.ToString("yyyyMMdd_HHmmssfff") + ".csv");

                CsvWriter.Write(outPath, rows);

                var dlg = new TaskDialog("Lukas QTO")
                {
                    MainInstruction = rows.Count == 0 ? "집계 대상 없음 — 헤더 CSV 저장 완료" : "수량 산출 완료",
                    MainContent =
                        "집계 행: " + rows.Count + "\n" +
                        "대상 요소: " + rows.Sum(r => r.Count) + "\n" +
                        "총 체적: " + Math.Round(rows.Sum(r => r.VolumeM3), 3) + " m3\n\n" +
                        outPath,
                    CommonButtons = TaskDialogCommonButtons.Close
                };
                dlg.Show();

                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                return Result.Failed;
            }
        }
    }
}
