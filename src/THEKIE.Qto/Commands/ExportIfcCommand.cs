using System;
using System.IO;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace THEKIE.Qto.Commands
{
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class ExportIfcCommand : IExternalCommand
    {
        internal static bool Export(Document doc, string folder, string name, out string error)
        {
            error = null;
            using (var options = new IFCExportOptions())
            using (var transaction = new Transaction(doc, "Lukas QTO IFC 내보내기"))
            {
                transaction.Start();
                if (!doc.Export(folder, name, options))
                {
                    transaction.RollBack();
                    error = "Revit이 IFC 파일을 생성하지 못했습니다.";
                    return false;
                }
                transaction.Commit();
                return true;
            }
        }

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            try
            {
                Document doc = commandData.Application.ActiveUIDocument.Document;
                var dialog = new FileSaveDialog("IFC files (*.ifc)|*.ifc")
                {
                    Title = "Lukas QTO - IFC 내보내기",
                    InitialFileName = (string.IsNullOrEmpty(doc.Title) ? "model" : doc.Title) + ".ifc"
                };

                if (dialog.Show() != ItemSelectionDialogResult.Confirmed)
                    return Result.Cancelled;

                string path = ModelPathUtils.ConvertModelPathToUserVisiblePath(dialog.GetSelectedModelPath());
                string folder = Path.GetDirectoryName(path);
                string name = Path.GetFileName(path);
                if (string.IsNullOrEmpty(folder) || string.IsNullOrEmpty(name) || !Directory.Exists(folder))
                {
                    message = "IFC를 저장할 수 있는 폴더와 파일명을 선택하십시오.";
                    return Result.Failed;
                }

                if (!Export(doc, folder, name, out message)) return Result.Failed;

                TaskDialog.Show("Lukas QTO", "IFC 내보내기 완료:\n" + path);
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
